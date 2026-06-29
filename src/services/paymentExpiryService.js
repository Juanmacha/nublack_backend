import { Op } from 'sequelize';
import sequelize from '../config/database.js';
import { Solicitud, DetalleSolicitud } from '../models/index.js';
import { restoreOrderStock } from './orderStockService.js';

const EXPIRY_MOTIVO = 'Pago no completado en el tiempo límite (40 minutos)';

export const expireUnpaidGatewayOrders = async () => {
    const now = new Date();
    const expiredOrders = await Solicitud.findAll({
        where: {
            metodo_pago: 'Pasarela',
            estado_pago: 'pendiente',
            estado: 'pendiente',
            pago_expira_at: { [Op.lt]: now }
        },
        include: [{ model: DetalleSolicitud, as: 'detalles' }]
    });

    if (!expiredOrders.length) return 0;

    let count = 0;
    for (const order of expiredOrders) {
        const t = await sequelize.transaction();
        try {
            await restoreOrderStock(order.detalles, t);
            await order.update({
                estado: 'cancelada',
                estado_pago: 'expirado',
                motivo_rechazo: EXPIRY_MOTIVO
            }, { transaction: t });
            await t.commit();
            count += 1;
            console.log(`[PaymentExpiry] Pedido ${order.numero_pedido} expirado y stock restaurado.`);
        } catch (err) {
            await t.rollback();
            console.error(`[PaymentExpiry] Error expirando pedido ${order.numero_pedido}:`, err.message);
        }
    }

    return count;
};

export const startPaymentExpiryJob = (intervalMs = 5 * 60 * 1000) => {
    expireUnpaidGatewayOrders().catch((err) => {
        console.error('[PaymentExpiry] Error en ejecución inicial:', err.message);
    });

    return setInterval(() => {
        expireUnpaidGatewayOrders().catch((err) => {
            console.error('[PaymentExpiry] Error en job:', err.message);
        });
    }, intervalMs);
};
