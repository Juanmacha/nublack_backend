import express from 'express';
import { Solicitud, DetalleSolicitud, Producto, Usuario } from '../models/index.js';
import authMiddleware from '../middleware/authMiddleware.js';
import optionalAuthMiddleware from '../middleware/optionalAuthMiddleware.js';
import isAdmin from '../middleware/isAdmin.js';
import sequelize from '../config/database.js';
import { Transaction } from 'sequelize';
import {
    sendOrderConfirmationEmail,
    sendPendingPaymentEmail,
    notifyOrderStatusChange,
    notifyAdminNewOrder,
} from '../services/emailService.js';
import {
    mapOrder,
    paymentMethodMap,
    statusMapFEtoBE,
    isPasarelaPayment
} from '../utils/orderMapper.js';
import { wompiConfig } from '../config/wompi.js';
import { buildCheckoutConfig, buildWompiReference } from '../services/wompiService.js';
import { restoreOrderStock } from '../services/orderStockService.js';
import { clearUserCart } from '../services/cartService.js';
import { getAvailableStock, decrementProductStock } from '../utils/stockUtils.js';
import { resolveCheckoutCustomer } from '../services/checkoutCustomerService.js';
import { isMetroArea } from '../utils/shippingService.js';
import { expireUnpaidGatewayOrders } from '../services/paymentExpiryService.js';
import { syncPendingGatewayPayments, syncUserPendingGatewayPayments, syncOrderPaymentFromWompi } from '../services/paymentSyncService.js';
import { findOrderForAccess } from '../utils/orderAccess.js';
import { resolveOrderShipping } from '../utils/shippingService.js';
import { Op } from 'sequelize';
import {
    computeServerOrderSubtotal,
    resolveProductUnitPrice,
} from '../utils/orderPricing.js';

const resolveProductImage = (producto) => {
    if (!producto) return '';
    if (producto.imagen) return producto.imagen;
    let imgs = producto.imagenes;
    if (typeof imgs === 'string') {
        try { imgs = JSON.parse(imgs); } catch { imgs = []; }
    }
    if (Array.isArray(imgs) && imgs.length > 0) return imgs[0] || '';
    return '';
};

const router = express.Router();

const REJECTED_PAYMENT_METHODS = ['transferencia', 'Transferencia', 'tarjeta', 'Tarjeta', 'PSE', 'pse'];

const createOrder = async (req, res) => {
    const t = await sequelize.transaction();
    let idempotencyKey = null;
    try {
        const usuario_id = req.usuarioId || null;
        let accountCreated = false;
        let linkedExistingAccount = false;
        const {
            items = [],
            personalInfo = {},
            deliveryInfo = {},
            paymentInfo = {},
            totals = {}
        } = req.body;

        const customerEmail = (personalInfo.email || '').trim().toLowerCase();
        if (!usuario_id && !customerEmail) {
            await t.rollback();
            return res.status(400).json({
                message: 'El correo electrónico es obligatorio para completar la compra.',
                code: 'EMAIL_REQUIRED'
            });
        }

        let resolvedUserId = usuario_id;
        if (!resolvedUserId) {
            try {
                const customer = await resolveCheckoutCustomer(personalInfo, t);
                resolvedUserId = customer.usuario_id;
                accountCreated = customer.created;
                linkedExistingAccount = customer.existing;
            } catch (customerErr) {
                await t.rollback();
                return res.status(400).json({
                    message: customerErr.message || 'Datos del cliente incompletos',
                    code: customerErr.code || 'INVALID_CUSTOMER_DATA'
                });
            }
        }

        const rawPaymentMethod = (paymentInfo.metodo || '').toString();
        if (REJECTED_PAYMENT_METHODS.includes(rawPaymentMethod)) {
            await t.rollback();
            return res.status(400).json({
                message: 'Método de pago no disponible. Use contra entrega o pasarela Wompi.',
                code: 'INVALID_PAYMENT_METHOD'
            });
        }

        idempotencyKey = req.headers['idempotency-key'] || req.headers['idempotency_key'] || req.body.idempotencyKey || null;
        if (idempotencyKey) {
            const idempotencyWhere = { idempotency_key: idempotencyKey };
            if (usuario_id) idempotencyWhere.usuario_id = usuario_id;
            else if (resolvedUserId) idempotencyWhere.usuario_id = resolvedUserId;
            const existing = await Solicitud.findOne({ where: idempotencyWhere });
            if (existing) {
                await t.rollback();
                return res.status(200).json({
                    success: true,
                    message: 'Pedido ya procesado (idempotency key).',
                    orderId: existing.numero_pedido,
                    requiresPayment: existing.metodo_pago === 'Pasarela' && existing.estado_pago === 'pendiente'
                });
            }
        }

        const metodoPagoDb = paymentMethodMap[rawPaymentMethod] || 'Contra Entrega';
        const isPasarela = isPasarelaPayment(metodoPagoDb);

        if (isPasarela && !wompiConfig.isConfigured()) {
            await t.rollback();
            return res.status(503).json({
                message: 'Pasarela de pago no configurada temporalmente.',
                code: 'WOMPI_NOT_CONFIGURED'
            });
        }

        if (isPasarela) {
            await syncUserPendingGatewayPayments({
                usuarioId: resolvedUserId,
                email: customerEmail || personalInfo.email,
                limit: 5
            });

            const orConditions = [];
            if (resolvedUserId) orConditions.push({ usuario_id: resolvedUserId });
            if (customerEmail) orConditions.push({ correo_electronico: customerEmail });

            if (orConditions.length) {
                const existingPending = await Solicitud.findOne({
                    where: {
                        metodo_pago: 'Pasarela',
                        estado_pago: 'pendiente',
                        estado: 'pendiente',
                        [Op.or]: orConditions
                    },
                    order: [['created_at', 'DESC']]
                });

                if (existingPending) {
                    await t.rollback();
                    return res.status(409).json({
                        message: 'Ya tienes un pago pendiente. Complétalo antes de crear otro pedido con pasarela.',
                        code: 'PENDING_PAYMENT_EXISTS',
                        orderId: existingPending.numero_pedido,
                        pago_expira_at: existingPending.pago_expira_at
                    });
                }
            }
        }

        const numero_pedido = 'ORD-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
        const pagoExpiraAt = isPasarela
            ? new Date(Date.now() + wompiConfig.paymentExpiryMinutes * 60 * 1000)
            : null;

        let shippingTotals;
        try {
            const productIds = items.map((i) => i?.id_producto || i?.id).filter(Boolean);
            const productosForShipping = productIds.length
                ? await Producto.findAll({ where: { id_producto: productIds }, transaction: t })
                : [];
            const productMap = new Map(productosForShipping.map((p) => [p.id_producto, p]));
            const serverSubtotal = computeServerOrderSubtotal(items, productMap);
            shippingTotals = resolveOrderShipping(
                deliveryInfo,
                { ...totals, subtotal: serverSubtotal }
            );
        } catch (shippingErr) {
            await t.rollback();
            return res.status(400).json({
                message: shippingErr.message,
                code: shippingErr.code || 'INVALID_SHIPPING',
            });
        }

        const solicitud = await Solicitud.create({
            numero_pedido,
            usuario_id: resolvedUserId,
            nombre_cliente: personalInfo.nombre || 'Cliente',
            documento_identificacion: personalInfo.documento || '0000',
            telefono_contacto: personalInfo.telefono || '0000',
            correo_electronico: personalInfo.email,
            direccion_envio: deliveryInfo.direccion || 'No especificada',
            departamento: deliveryInfo.departamento || null,
            ciudad: deliveryInfo.ciudad || null,
            referencia_direccion: deliveryInfo.referencia,
            indicaciones_adicionales: deliveryInfo.indicaciones,
            horario_preferido: deliveryInfo.horario,
            transportadora_envio: shippingTotals.transportadora,
            metodo_pago: metodoPagoDb,
            estado_pago: isPasarela ? 'pendiente' : 'no_aplica',
            wompi_reference: isPasarela ? `${buildWompiReference(numero_pedido)}-${Date.now()}` : null,
            pago_expira_at: pagoExpiraAt,
            total: shippingTotals.total,
            subtotal: shippingTotals.subtotal,
            envio: shippingTotals.envio,
            idempotency_key: idempotencyKey || null,
            estado: 'pendiente'
        }, { transaction: t });

        for (const item of items) {
            const prodId = item?.id_producto || item?.id;
            const qty = parseInt(item?.cantidad || item?.quantity || 1, 10) || 1;
            const size = item?.talla || item?.size || null;
            const producto = await Producto.findByPk(prodId, { transaction: t, lock: Transaction.LOCK.UPDATE });
            if (!producto) {
                await t.rollback();
                return res.status(400).json({ message: `Producto ${prodId} no encontrado`, code: 'PRODUCT_NOT_FOUND', item: { id: prodId } });
            }

            const available = getAvailableStock(producto, size);
            if (available < qty) {
                await t.rollback();
                const sizeLabel = size && size !== 'N/A' ? ` talla ${size}` : '';
                return res.status(400).json({
                    message: `Stock insuficiente para ${producto.nombre}${sizeLabel}. Disponible: ${available}, solicitado: ${qty}`,
                    code: 'INSUFFICIENT_STOCK',
                    item: { id: prodId, talla: size || null, available, requested: qty }
                });
            }

            const imagenProducto = resolveProductImage(producto) || item?.imagen || '';
            const unitPrice = resolveProductUnitPrice(producto, item?.precio);

            await DetalleSolicitud.create({
                solicitud_id: solicitud.id_solicitud,
                producto_id: prodId,
                nombre_producto: item?.nombre || producto?.nombre || 'Producto',
                descripcion_producto: item?.descripcion || producto?.descripcion || '',
                imagen_producto: imagenProducto,
                cantidad: qty,
                talla: size || 'N/A',
                precio_unitario: unitPrice,
                subtotal: unitPrice * qty
            }, { transaction: t });

            await decrementProductStock(producto, qty, size, t);
        }

        await t.commit();

        // Pasarela: conservar carrito hasta pago confirmado (webhook/sync).
        // Contra entrega: vaciar al crear el pedido (solo usuarios registrados).
        if (!isPasarela && resolvedUserId) {
            await clearUserCart(resolvedUserId);
        }

        const cliente = resolvedUserId ? await Usuario.findByPk(resolvedUserId) : null;
        const emailDestino = cliente?.email || customerEmail;
        if (emailDestino) {
            if (isPasarela) {
                sendPendingPaymentEmail(emailDestino, solicitud).catch(err => console.error('Error email pago pendiente:', err));
            } else {
                sendOrderConfirmationEmail(emailDestino, solicitud).catch(err => console.error('Error email confirmación:', err));
            }
        }
        notifyAdminNewOrder(solicitud).catch(err => console.error('Error email admin nuevo pedido:', err));

        const response = {
            success: true,
            message: isPasarela ? 'Pedido creado. Complete el pago en los próximos 40 minutos.' : 'Pedido creado exitosamente',
            orderId: solicitud.numero_pedido,
            requiresPayment: isPasarela,
            estado_pago: solicitud.estado_pago,
            pago_expira_at: solicitud.pago_expira_at,
            accountCreated,
            linkedExistingAccount,
            usuario_id: resolvedUserId,
        };

        if (isPasarela) {
            const checkoutFull = buildCheckoutConfig(solicitud);
            const { _debug, ...checkout } = checkoutFull;
            response.checkout = checkout;
            if (_debug) response._debug = _debug;
        }

        res.status(201).json(response);
    } catch (error) {
        await t.rollback();
        console.error('Order Creation Error:', error);
        if (idempotencyKey) {
            try {
                const existing = await Solicitud.findOne({
                    where: usuario_id
                        ? { idempotency_key: idempotencyKey, usuario_id }
                        : { idempotency_key: idempotencyKey }
                });
                if (existing) {
                    return res.status(200).json({ success: true, message: 'Pedido ya procesado (idempotency key).', orderId: existing.numero_pedido });
                }
            } catch (e) {
                console.error('Error idempotency fallback:', e);
            }
        }
        const safeMessage = process.env.NODE_ENV === 'production' ? 'Error al procesar el pedido' : `Error al procesar el pedido: ${error.message}`;
        res.status(500).json({ message: safeMessage, error: error.message });
    }
};

const getMyOrders = async (req, res) => {
    try {
        const usuario_id = req.usuarioId;
        const user = await Usuario.findByPk(usuario_id, { attributes: ['email'] });
        const userEmail = user?.email || null;

        await syncUserPendingGatewayPayments({ usuarioId: usuario_id, email: userEmail, limit: 15 });

        const orConditions = [{ usuario_id }];
        if (userEmail) orConditions.push({ correo_electronico: userEmail });

        const orders = await Solicitud.findAll({
            where: { [Op.or]: orConditions },
            include: [{ model: DetalleSolicitud, as: 'detalles' }],
            order: [['created_at', 'DESC']]
        });
        res.json(orders.map(mapOrder));
    } catch (error) {
        console.error('Get My Orders Error:', error);
        res.status(500).json({ message: 'Error al obtener mis pedidos' });
    }
};

const getPendingPayments = async (req, res) => {
    try {
        const usuario_id = req.usuarioId;
        if (!usuario_id) {
            return res.status(401).json({ message: 'Autenticación requerida' });
        }

        const user = await Usuario.findByPk(usuario_id, { attributes: ['email'] });
        await syncUserPendingGatewayPayments({ usuarioId: usuario_id, email: user?.email, limit: 10 });

        const orConditions = [{ usuario_id }];
        if (user?.email) orConditions.push({ correo_electronico: user.email });

        const orders = await Solicitud.findAll({
            where: {
                [Op.or]: orConditions,
                metodo_pago: 'Pasarela',
                estado_pago: 'pendiente',
                estado: { [Op.notIn]: ['cancelada', 'entregada'] },
            },
            include: [{ model: DetalleSolicitud, as: 'detalles' }],
            order: [['created_at', 'DESC']],
        });

        res.json(orders.map(mapOrder));
    } catch (error) {
        console.error('Get Pending Payments Error:', error);
        res.status(500).json({ message: 'Error al obtener pagos pendientes' });
    }
};

const getOrderById = async (req, res) => {
    try {
        const { id } = req.params;
        const usuario_id = req.usuarioId;

        const order = await findOrderForAccess(id, usuario_id);
        if (!order) {
            return res.status(404).json({ message: 'Pedido no encontrado', code: 'ORDER_NOT_FOUND' });
        }

        if (order.metodo_pago === 'Pasarela' && order.estado_pago !== 'pagado') {
            await syncOrderPaymentFromWompi(order);
            await order.reload();
        }

        await expireUnpaidGatewayOrders();
        await order.reload();

        res.json(mapOrder(order));
    } catch (error) {
        console.error('Get Order By Id Error:', error);
        res.status(500).json({ message: 'Error al obtener el pedido' });
    }
};

const getAllOrders = async (req, res) => {
    try {
        await syncPendingGatewayPayments(30);

        const limit = Math.min(parseInt(req.query.limit, 10) || 200, 500);
        const orders = await Solicitud.findAll({
            include: [{ model: DetalleSolicitud, as: 'detalles' }],
            order: [['created_at', 'DESC']],
            limit,
        });
        res.json(orders.map(mapOrder));
    } catch (error) {
        res.status(500).json({ message: 'Error al obtener pedidos' });
    }
};

const updateOrderStatus = async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const { id } = req.params;
        let { estado, motivo_rechazo, numero_guia, nombre_empaquetadora } = req.body;

        const dbEstado = statusMapFEtoBE[estado] || estado;

        const order = await Solicitud.findByPk(id, {
            include: [{ model: DetalleSolicitud, as: 'detalles' }],
            transaction: t,
            lock: Transaction.LOCK.UPDATE
        });
        if (!order) {
            await t.rollback();
            return res.status(404).json({ message: 'Pedido no encontrado' });
        }

        if (estado === 'en_camino') {
            const isMetroDelivery = isMetroArea(order.ciudad);

            if (isMetroDelivery) {
                numero_guia = (numero_guia || '').trim() || `LOCAL-${order.numero_pedido}`;
                nombre_empaquetadora = (nombre_empaquetadora || '').trim()
                    || order.transportadora_envio
                    || 'Domicilio Nublack (Área Metropolitana)';
            } else {
                const guia = (numero_guia || '').trim();
                const empaquetadora = (nombre_empaquetadora || '').trim();

                if (guia.length < 3) {
                    await t.rollback();
                    return res.status(400).json({
                        message: 'El número de guía es obligatorio (mínimo 3 caracteres) al marcar en camino.',
                        code: 'MISSING_NUMERO_GUIA'
                    });
                }
                if (empaquetadora.length < 2) {
                    await t.rollback();
                    return res.status(400).json({
                        message: 'El nombre de la empaquetadora es obligatorio al marcar en camino.',
                        code: 'MISSING_EMPAQUETADORA'
                    });
                }
                numero_guia = guia;
                nombre_empaquetadora = empaquetadora;
            }
        }

        if (order.metodo_pago === 'Pasarela' && order.estado_pago !== 'pagado' && dbEstado === 'aceptada') {
            await t.rollback();
            return res.status(400).json({
                message: 'No se puede aprobar un pedido con pasarela sin pago confirmado.',
                code: 'PAYMENT_NOT_CONFIRMED'
            });
        }

        const previousEstado = order.estado;
        const updateData = { estado: dbEstado, motivo_rechazo };

        if (estado === 'en_camino') {
            updateData.numero_guia = String(numero_guia).trim();
            updateData.nombre_empaquetadora = String(nombre_empaquetadora).trim();
            updateData.fecha_despacho = new Date();
        }

        if (dbEstado === 'cancelada' && previousEstado !== 'cancelada') {
            await restoreOrderStock(order.detalles, t);
            if (order.estado_pago === 'pendiente') {
                updateData.estado_pago = 'expirado';
            }
        }

        await order.update(updateData, { transaction: t });
        await t.commit();

        await order.reload();

        const cliente = await Usuario.findByPk(order.usuario_id);
        notifyOrderStatusChange({
            order,
            previousStatus: previousEstado,
            newStatus: dbEstado,
            shippingInfo: estado === 'en_camino'
                ? { numero_guia: updateData.numero_guia, nombre_empaquetadora: updateData.nombre_empaquetadora }
                : {},
            cliente,
        }).catch(err => console.error('Error notificaciones estado pedido:', err));

        res.json({
            success: true,
            message: 'Estado del pedido actualizado',
            nuevoEstado: estado,
            numero_guia: order.numero_guia,
            nombre_empaquetadora: order.nombre_empaquetadora,
            fecha_despacho: order.fecha_despacho
        });
    } catch (error) {
        await t.rollback();
        console.error('Update Order Status Error:', error);
        res.status(500).json({ message: 'Error al actualizar pedido', error: error.message });
    }
};

const cancelOrder = async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const { id } = req.params;
        const usuario_id = req.usuarioId;
        const { motivo } = req.body;

        const where = { usuario_id };
        if (/^\d+$/.test(String(id))) {
            where.id_solicitud = id;
        } else {
            where.numero_pedido = id;
        }

        const order = await Solicitud.findOne({
            where,
            include: [{ model: DetalleSolicitud, as: 'detalles' }]
        });

        if (!order) {
            await t.rollback();
            return res.status(404).json({ message: 'Pedido no encontrado o no tienes permiso', code: 'ORDER_NOT_FOUND' });
        }

        if (order.estado !== 'pendiente') {
            await t.rollback();
            return res.status(400).json({ message: 'Solo se pueden cancelar pedidos en estado pendiente' });
        }

        if (order.metodo_pago === 'Pasarela' && order.estado_pago === 'pagado') {
            await t.rollback();
            return res.status(400).json({
                message: 'No se puede cancelar un pedido ya pagado por pasarela. Contacte soporte.',
                code: 'ALREADY_PAID'
            });
        }

        await restoreOrderStock(order.detalles, t);

        const isGatewayPending = isPasarelaPayment(order.metodo_pago) && order.estado_pago === 'pendiente';

        await order.update({
            estado: 'cancelada',
            motivo_rechazo: motivo || 'Cancelado por el cliente',
            ...(isGatewayPending ? { estado_pago: 'expirado' } : {})
        }, { transaction: t });

        await t.commit();
        res.json({ success: true, message: 'Pedido cancelado exitosamente', orderId: order.numero_pedido });
    } catch (error) {
        await t.rollback();
        console.error('Cancel Order Error:', error);
        res.status(500).json({ message: 'Error al cancelar el pedido' });
    }
};

router.post('/', optionalAuthMiddleware, createOrder);
router.get('/my-orders', authMiddleware, getMyOrders);
router.get('/pending-payments', authMiddleware, getPendingPayments);
router.get('/all', authMiddleware, isAdmin, getAllOrders);
router.get('/:id', authMiddleware, getOrderById);
router.put('/:id/status', authMiddleware, isAdmin, updateOrderStatus);
router.put('/:id/cancel', authMiddleware, cancelOrder);

export default router;
