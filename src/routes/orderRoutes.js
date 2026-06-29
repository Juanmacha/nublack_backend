import express from 'express';
import { Solicitud, DetalleSolicitud, Producto, Usuario, Carrito } from '../models/index.js';
import authMiddleware from '../middleware/authMiddleware.js';
import isAdmin from '../middleware/isAdmin.js';
import sequelize from '../config/database.js';
import { Transaction } from 'sequelize';
import {
    sendOrderStatusEmail,
    sendOrderConfirmationEmail,
    sendPendingPaymentEmail
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
import { expireUnpaidGatewayOrders } from '../services/paymentExpiryService.js';
import { syncPendingGatewayPayments } from '../services/paymentSyncService.js';

const router = express.Router();

const REJECTED_PAYMENT_METHODS = ['transferencia', 'Transferencia', 'tarjeta', 'Tarjeta', 'PSE', 'pse'];

const createOrder = async (req, res) => {
    const t = await sequelize.transaction();
    let idempotencyKey = null;
    try {
        const usuario_id = req.usuarioId;
        const {
            items = [],
            personalInfo = {},
            deliveryInfo = {},
            paymentInfo = {},
            totals = {}
        } = req.body;

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
            const existing = await Solicitud.findOne({ where: { idempotency_key: idempotencyKey, usuario_id } });
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

        const numero_pedido = 'ORD-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
        const pagoExpiraAt = isPasarela
            ? new Date(Date.now() + wompiConfig.paymentExpiryMinutes * 60 * 1000)
            : null;

        const solicitud = await Solicitud.create({
            numero_pedido,
            usuario_id,
            nombre_cliente: personalInfo.nombre || 'Cliente',
            documento_identificacion: personalInfo.documento || '0000',
            telefono_contacto: personalInfo.telefono || '0000',
            correo_electronico: personalInfo.email,
            direccion_envio: deliveryInfo.direccion || 'No especificada',
            referencia_direccion: deliveryInfo.referencia,
            indicaciones_adicionales: deliveryInfo.indicaciones,
            horario_preferido: deliveryInfo.horario,
            metodo_pago: metodoPagoDb,
            estado_pago: isPasarela ? 'pendiente' : 'no_aplica',
            wompi_reference: isPasarela ? `${buildWompiReference(numero_pedido)}-${Date.now()}` : null,
            pago_expira_at: pagoExpiraAt,
            total: totals.total || 0,
            subtotal: totals.subtotal || 0,
            envio: totals.envio || 0,
            idempotency_key: idempotencyKey || null,
            estado: 'pendiente'
        }, { transaction: t });

        for (const item of items) {
            const prodId = item?.id_producto || item?.id;
            const qty = parseInt(item?.cantidad || item?.quantity || 1, 10) || 1;
            const producto = await Producto.findByPk(prodId, { transaction: t, lock: Transaction.LOCK.UPDATE });
            if (!producto) {
                await t.rollback();
                return res.status(400).json({ message: `Producto ${prodId} no encontrado`, code: 'PRODUCT_NOT_FOUND', item: { id: prodId } });
            }

            let tallasObj = producto.tallas || {};
            if (typeof tallasObj === 'string') {
                try { tallasObj = JSON.parse(tallasObj); } catch (e) { tallasObj = {}; }
            }

            const requestedSize = item?.talla || item?.size || null;
            if (requestedSize && tallasObj && ((Array.isArray(tallasObj) && tallasObj.length > 0) || Object.keys(tallasObj).length > 0)) {
                let availableForSize = 0;
                if (Array.isArray(tallasObj)) {
                    const found = tallasObj.find(tallaItem => String(tallaItem.talla) === String(requestedSize));
                    availableForSize = found ? parseInt(found.stock || 0, 10) : 0;
                } else {
                    availableForSize = parseInt(tallasObj[requestedSize] || 0, 10);
                }

                if (availableForSize < qty) {
                    await t.rollback();
                    return res.status(400).json({
                        message: `Stock insuficiente para ${producto.nombre} talla ${requestedSize}. Disponible: ${availableForSize}, solicitado: ${qty}`,
                        code: 'INSUFFICIENT_STOCK',
                        item: { id: prodId, talla: requestedSize, available: availableForSize, requested: qty }
                    });
                }
            } else if (producto.stock < qty) {
                await t.rollback();
                return res.status(400).json({
                    message: `Stock insuficiente para ${producto.nombre}. Disponible: ${producto.stock}, solicitado: ${qty}`,
                    code: 'INSUFFICIENT_STOCK',
                    item: { id: prodId, available: producto.stock, requested: qty }
                });
            }
        }

        for (const item of items) {
            const quantity = item?.cantidad || item?.quantity || 1;
            const size = item?.talla || item?.size || null;

            await DetalleSolicitud.create({
                solicitud_id: solicitud.id_solicitud,
                producto_id: item?.id_producto || item?.id,
                nombre_producto: item?.nombre || 'Producto',
                descripcion_producto: item?.descripcion || '',
                imagen_producto: item?.imagen || '',
                cantidad: quantity,
                talla: size || 'N/A',
                precio_unitario: item?.precio || 0,
                subtotal: (item?.precio || 0) * quantity
            }, { transaction: t });

            if (size) {
                const prodId = item?.id_producto || item?.id;
                const producto = await Producto.findByPk(prodId, { transaction: t, lock: Transaction.LOCK.UPDATE });
                let tallasObj = producto.tallas || {};
                if (typeof tallasObj === 'string') {
                    try { tallasObj = JSON.parse(tallasObj); } catch (e) { tallasObj = {}; }
                }

                if (Array.isArray(tallasObj)) {
                    const idx = tallasObj.findIndex(tallaItem => String(tallaItem.talla) === String(size));
                    if (idx >= 0) {
                        const availableForSize = parseInt(tallasObj[idx].stock || 0, 10);
                        tallasObj[idx].stock = Math.max(0, availableForSize - quantity);
                    }
                } else {
                    const availableForSize = parseInt(tallasObj[size] || 0, 10);
                    tallasObj[size] = Math.max(0, availableForSize - quantity);
                }

                await producto.update({
                    tallas: tallasObj,
                    stock: Math.max(0, producto.stock - quantity)
                }, { transaction: t });
            } else {
                await Producto.decrement('stock', {
                    by: quantity,
                    where: { id_producto: item.id_producto || item.id },
                    transaction: t
                });
            }
        }

        await t.commit();

        try {
            await Carrito.destroy({ where: { usuario_id } });
        } catch (cartError) {
            console.error('Error al limpiar carrito:', cartError);
        }

        const cliente = await Usuario.findByPk(usuario_id);
        if (cliente) {
            if (isPasarela) {
                sendPendingPaymentEmail(cliente.email, solicitud).catch(err => console.error('Error email pago pendiente:', err));
            } else {
                sendOrderConfirmationEmail(cliente.email, solicitud).catch(err => console.error('Error email confirmación:', err));
            }
        }

        const response = {
            success: true,
            message: isPasarela ? 'Pedido creado. Complete el pago en los próximos 40 minutos.' : 'Pedido creado exitosamente',
            orderId: solicitud.numero_pedido,
            requiresPayment: isPasarela,
            estado_pago: solicitud.estado_pago,
            pago_expira_at: solicitud.pago_expira_at
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
                const existing = await Solicitud.findOne({ where: { idempotency_key: idempotencyKey, usuario_id: req.usuarioId } });
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
        await expireUnpaidGatewayOrders();
        const usuario_id = req.usuarioId;
        const orders = await Solicitud.findAll({
            where: { usuario_id },
            include: [{ model: DetalleSolicitud, as: 'detalles' }],
            order: [['created_at', 'DESC']]
        });
        res.json(orders.map(mapOrder));
    } catch (error) {
        console.error('Get My Orders Error:', error);
        res.status(500).json({ message: 'Error al obtener mis pedidos' });
    }
};

const getOrderById = async (req, res) => {
    try {
        await expireUnpaidGatewayOrders();
        const { id } = req.params;
        const usuario_id = req.usuarioId;

        const order = await Solicitud.findOne({
            where: {
                usuario_id,
                ...( /^\d+$/.test(id) ? { id_solicitud: id } : { numero_pedido: id })
            },
            include: [{ model: DetalleSolicitud, as: 'detalles' }]
        });

        if (!order) {
            return res.status(404).json({ message: 'Pedido no encontrado', code: 'ORDER_NOT_FOUND' });
        }

        res.json(mapOrder(order));
    } catch (error) {
        console.error('Get Order By Id Error:', error);
        res.status(500).json({ message: 'Error al obtener el pedido' });
    }
};

const getAllOrders = async (req, res) => {
    try {
        await expireUnpaidGatewayOrders();
        await syncPendingGatewayPayments(25);
        const orders = await Solicitud.findAll({
            include: [{ model: DetalleSolicitud, as: 'detalles' }],
            order: [['created_at', 'DESC']]
        });
        res.json(orders.map(mapOrder));
    } catch (error) {
        res.status(500).json({ message: 'Error al obtener pedidos' });
    }
};

const updateOrderStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { estado, motivo_rechazo, numero_guia, nombre_empaquetadora } = req.body;

        const dbEstado = statusMapFEtoBE[estado] || estado;

        if (estado === 'en_camino') {
            const guia = (numero_guia || '').trim();
            const empaquetadora = (nombre_empaquetadora || '').trim();

            if (guia.length < 3) {
                return res.status(400).json({
                    message: 'El número de guía es obligatorio (mínimo 3 caracteres) al marcar en camino.',
                    code: 'MISSING_NUMERO_GUIA'
                });
            }
            if (empaquetadora.length < 2) {
                return res.status(400).json({
                    message: 'El nombre de la empaquetadora es obligatorio al marcar en camino.',
                    code: 'MISSING_EMPAQUETADORA'
                });
            }
        }

        const order = await Solicitud.findByPk(id);
        if (!order) return res.status(404).json({ message: 'Pedido no encontrado' });

        if (order.metodo_pago === 'Pasarela' && order.estado_pago !== 'pagado' && dbEstado === 'aceptada') {
            return res.status(400).json({
                message: 'No se puede aprobar un pedido con pasarela sin pago confirmado.',
                code: 'PAYMENT_NOT_CONFIRMED'
            });
        }

        const updateData = { estado: dbEstado, motivo_rechazo };

        if (estado === 'en_camino') {
            updateData.numero_guia = numero_guia.trim();
            updateData.nombre_empaquetadora = nombre_empaquetadora.trim();
            updateData.fecha_despacho = new Date();
        }

        await order.update(updateData);

        const cliente = await Usuario.findByPk(order.usuario_id);
        if (cliente) {
            sendOrderStatusEmail(
                cliente.email,
                order.numero_pedido,
                dbEstado,
                estado === 'en_camino'
                    ? { numero_guia: updateData.numero_guia, nombre_empaquetadora: updateData.nombre_empaquetadora }
                    : {}
            ).catch(err => console.error('Error email estado pedido:', err));
        }

        res.json({
            success: true,
            message: 'Estado del pedido actualizado',
            nuevoEstado: estado,
            numero_guia: order.numero_guia,
            nombre_empaquetadora: order.nombre_empaquetadora,
            fecha_despacho: order.fecha_despacho
        });
    } catch (error) {
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

        const order = await Solicitud.findOne({
            where: { id_solicitud: id, usuario_id },
            include: [{ model: DetalleSolicitud, as: 'detalles' }]
        });

        if (!order) {
            await t.rollback();
            return res.status(404).json({ message: 'Pedido no encontrado o no tienes permiso' });
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

        await order.update({
            estado: 'cancelada',
            motivo_rechazo: motivo || 'Cancelado por el cliente',
            ...(order.metodo_pago === 'Pasarela' && order.estado_pago === 'pendiente'
                ? { estado_pago: 'expirado' }
                : {})
        }, { transaction: t });

        await t.commit();
        res.json({ success: true, message: 'Pedido cancelado exitosamente' });
    } catch (error) {
        await t.rollback();
        console.error('Cancel Order Error:', error);
        res.status(500).json({ message: 'Error al cancelar el pedido' });
    }
};

router.post('/', authMiddleware, createOrder);
router.get('/my-orders', authMiddleware, getMyOrders);
router.get('/all', authMiddleware, isAdmin, getAllOrders);
router.get('/:id', authMiddleware, getOrderById);
router.put('/:id/status', authMiddleware, isAdmin, updateOrderStatus);
router.put('/:id/cancel', authMiddleware, cancelOrder);

export default router;
