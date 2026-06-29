import express from 'express';
import { Solicitud, DetalleSolicitud, Usuario } from '../models/index.js';
import authMiddleware from '../middleware/authMiddleware.js';
import sequelize from '../config/database.js';
import { wompiConfig } from '../config/wompi.js';
import {
    buildCheckoutConfig,
    buildWompiReference,
    verifyWebhookChecksum,
    mapWompiStatusToPaymentStatus,
    verifyIntegrityWithWompiTransaction
} from '../services/wompiService.js';
import {
    findOrderByWompiReference,
    syncOrderPaymentFromWompi,
    syncPendingGatewayPayments
} from '../services/paymentSyncService.js';
import { expireUnpaidGatewayOrders } from '../services/paymentExpiryService.js';
import { sendOrderConfirmationEmail } from '../services/emailService.js';
import { restoreOrderStock } from '../services/orderStockService.js';
import { clearUserCart } from '../services/cartService.js';
import { mapOrder } from '../utils/orderMapper.js';

const router = express.Router();

const findOrderForUser = async (orderRef, usuarioId) => {
    const where = usuarioId
        ? { usuario_id: usuarioId }
        : {};

    const byNumero = await Solicitud.findOne({
        where: { ...where, numero_pedido: orderRef },
        include: [{ model: DetalleSolicitud, as: 'detalles' }]
    });
    if (byNumero) return byNumero;

    if (/^\d+$/.test(String(orderRef))) {
        return Solicitud.findOne({
            where: { ...where, id_solicitud: orderRef },
            include: [{ model: DetalleSolicitud, as: 'detalles' }]
        });
    }

    return null;
};

const createCheckout = async (req, res) => {
    try {
        if (!wompiConfig.isConfigured()) {
            return res.status(503).json({
                message: 'Pasarela de pago no configurada. Contacte al administrador.',
                code: 'WOMPI_NOT_CONFIGURED'
            });
        }

        await expireUnpaidGatewayOrders();

        const { orderId } = req.body;
        if (!orderId) {
            return res.status(400).json({ message: 'orderId es requerido', code: 'MISSING_ORDER_ID' });
        }

        const order = await findOrderForUser(orderId, req.usuarioId);
        if (!order) {
            return res.status(404).json({ message: 'Pedido no encontrado', code: 'ORDER_NOT_FOUND' });
        }

        if (order.metodo_pago !== 'Pasarela') {
            return res.status(400).json({
                message: 'Este pedido no usa pasarela de pago',
                code: 'NOT_GATEWAY_ORDER'
            });
        }

        if (order.estado_pago === 'pagado') {
            return res.status(400).json({
                message: 'Este pedido ya fue pagado',
                code: 'ALREADY_PAID'
            });
        }

        if (order.estado_pago === 'expirado' || order.estado === 'cancelada') {
            return res.status(400).json({
                message: 'Este pedido expiró o fue cancelado',
                code: 'ORDER_EXPIRED'
            });
        }

        if (order.pago_expira_at && new Date(order.pago_expira_at) < new Date()) {
            await expireUnpaidGatewayOrders();
            return res.status(400).json({
                message: 'El tiempo para pagar este pedido ha expirado (40 minutos)',
                code: 'PAYMENT_EXPIRED'
            });
        }

        // Wompi exige referencia única por intento de transacción
        const reference = `${buildWompiReference(order.numero_pedido)}-${Date.now()}`;
        await order.update({ wompi_reference: reference });
        order.wompi_reference = reference;
        await order.reload();
        const checkoutFull = buildCheckoutConfig(order);
        const { _debug, ...checkout } = checkoutFull;

        let wompiValidation = null;
        if (wompiConfig.env !== 'production') {
            try {
                wompiValidation = await verifyIntegrityWithWompiTransaction(
                    `SIG-VERIFY-${Date.now()}`,
                    checkout.amountInCents
                );
            } catch (probeError) {
                wompiValidation = { ok: false, error: probeError.message };
            }
        }

        if (wompiValidation && !wompiValidation.ok && wompiValidation.signatureInvalid) {
            return res.status(503).json({
                message: 'Secreto de integridad Wompi incorrecto. Actualiza WOMPI_INTEGRITY_SECRET en .env',
                code: 'WOMPI_SIGNATURE_INVALID',
                wompiValidation
            });
        }

        res.json({
            success: true,
            orderId: order.numero_pedido,
            estado_pago: order.estado_pago,
            pago_expira_at: order.pago_expira_at,
            checkout,
            wompiValidation,
            ...(_debug ? { _debug } : {})
        });
    } catch (error) {
        console.error('Wompi Checkout Error:', error);
        res.status(500).json({ message: 'Error al preparar el checkout de pago' });
    }
};

const getPaymentStatus = async (req, res) => {
    try {
        await expireUnpaidGatewayOrders();

        const { orderId } = req.params;
        const order = await findOrderForUser(orderId, req.usuarioId);
        if (!order) {
            return res.status(404).json({ message: 'Pedido no encontrado', code: 'ORDER_NOT_FOUND' });
        }

        if (order.metodo_pago === 'Pasarela' && order.estado_pago !== 'pagado') {
            await syncOrderPaymentFromWompi(order);
            await order.reload();
        }

        res.json({
            success: true,
            order: mapOrder(order),
            payment: {
                estado_pago: order.estado_pago,
                metodo_pago: order.metodo_pago,
                wompi_transaction_id: order.wompi_transaction_id,
                wompi_payment_method_type: order.wompi_payment_method_type,
                fecha_pago: order.fecha_pago,
                pago_expira_at: order.pago_expira_at
            }
        });
    } catch (error) {
        console.error('Payment Status Error:', error);
        res.status(500).json({ message: 'Error al consultar estado de pago' });
    }
};

const handleWompiWebhook = async (req, res) => {
    try {
        const checksum = req.headers['x-event-checksum'];
        const event = req.body;

        if (!verifyWebhookChecksum(event, checksum)) {
            console.warn('[Wompi Webhook] Checksum inválido — evento ignorado.');
            return res.status(401).json({ message: 'Checksum inválido' });
        }

        if (event.event !== 'transaction.updated') {
            return res.status(200).json({ received: true, ignored: true });
        }

        const transaction = event.data?.transaction;
        if (!transaction?.reference) {
            return res.status(200).json({ received: true, ignored: true });
        }

        const order = await findOrderByWompiReference(transaction.reference);
        if (!order) {
            console.warn(`[Wompi Webhook] Pedido no encontrado para referencia ${transaction.reference}`);
            return res.status(200).json({ received: true, notFound: true });
        }

        const newPaymentStatus = mapWompiStatusToPaymentStatus(transaction.status);
        const updateData = {
            wompi_transaction_id: transaction.id,
            wompi_payment_method_type: transaction.payment_method_type || null
        };

        if (newPaymentStatus === 'pagado' && order.estado_pago !== 'pagado') {
            updateData.estado_pago = 'pagado';
            updateData.fecha_pago = new Date();
            updateData.wompi_reference = transaction.reference || order.wompi_reference;

            await order.update(updateData);

            await clearUserCart(order.usuario_id);

            const cliente = await Usuario.findByPk(order.usuario_id);
            if (cliente) {
                sendOrderConfirmationEmail(cliente.email, order).catch((err) => {
                    console.error('Error email confirmación pago:', err);
                });
            }
        } else if (newPaymentStatus === 'fallido' && order.estado_pago === 'pendiente') {
            const t = await sequelize.transaction();
            try {
                const fullOrder = await Solicitud.findByPk(order.id_solicitud, {
                    include: [{ model: DetalleSolicitud, as: 'detalles' }],
                    transaction: t
                });
                await restoreOrderStock(fullOrder.detalles, t);
                await fullOrder.update({
                    ...updateData,
                    estado_pago: 'fallido',
                    estado: 'cancelada',
                    motivo_rechazo: 'Pago rechazado por la pasarela'
                }, { transaction: t });
                await t.commit();
            } catch (err) {
                await t.rollback();
                throw err;
            }
        } else {
            await order.update(updateData);
        }

        res.status(200).json({ received: true });
    } catch (error) {
        console.error('Wompi Webhook Error:', error);
        res.status(500).json({ message: 'Error procesando webhook' });
    }
};

const syncPaymentForOrder = async (req, res) => {
    try {
        await expireUnpaidGatewayOrders();

        const { orderId } = req.params;
        const asAdmin = req.usuarioRol === 'administrador';
        const order = await findOrderForUser(orderId, asAdmin ? null : req.usuarioId);

        if (!order) {
            return res.status(404).json({ message: 'Pedido no encontrado', code: 'ORDER_NOT_FOUND' });
        }

        const syncResult = await syncOrderPaymentFromWompi(order);
        await order.reload();

        res.json({
            success: true,
            sync: syncResult,
            order: mapOrder(order),
            payment: {
                estado_pago: order.estado_pago,
                wompi_transaction_id: order.wompi_transaction_id,
                fecha_pago: order.fecha_pago
            }
        });
    } catch (error) {
        console.error('Payment Sync Error:', error);
        res.status(500).json({ message: 'Error al sincronizar pago con Wompi' });
    }
};

router.post('/wompi/checkout', authMiddleware, createCheckout);
router.get('/status/:orderId', authMiddleware, getPaymentStatus);
router.post('/sync/:orderId', authMiddleware, syncPaymentForOrder);
router.post('/wompi/webhook', handleWompiWebhook);

export default router;
