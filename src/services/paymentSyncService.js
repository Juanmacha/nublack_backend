import { Op, Transaction } from 'sequelize';
import sequelize from '../config/database.js';
import { Solicitud, DetalleSolicitud, Usuario } from '../models/index.js';
import { wompiConfig } from '../config/wompi.js';
import {
    buildWompiReference,
    mapWompiStatusToPaymentStatus
} from './wompiService.js';
import { notifyPaymentConfirmed } from './emailService.js';
import { clearUserCart } from './cartService.js';
import { restoreOrderStock, reserveOrderStock } from './orderStockService.js';

/**
 * Referencia Wompi: NUBLACK-{numero_pedido}-{timestamp}
 * Extrae numero_pedido quitando prefijo y sufijo numérico (timestamp).
 */
export const extractNumeroPedidoFromWompiReference = (reference) => {
    if (!reference || typeof reference !== 'string') return null;
    const trimmed = reference.trim();
    if (!trimmed.startsWith('NUBLACK-')) return null;

    const withoutPrefix = trimmed.slice('NUBLACK-'.length);
    const parts = withoutPrefix.split('-');
    const lastPart = parts[parts.length - 1];

    if (parts.length > 1 && /^\d{10,}$/.test(lastPart)) {
        return parts.slice(0, -1).join('-');
    }

    return withoutPrefix;
};

export const findOrderByWompiReference = async (reference) => {
    const include = [{ model: DetalleSolicitud, as: 'detalles' }];

    const exact = await Solicitud.findOne({
        where: { wompi_reference: reference },
        include
    });
    if (exact) return exact;

    const numeroPedido = extractNumeroPedidoFromWompiReference(reference);
    if (!numeroPedido) return null;

    return Solicitud.findOne({
        where: {
            numero_pedido: numeroPedido,
            metodo_pago: 'Pasarela'
        },
        include
    });
};

export const fetchWompiTransactionByReference = async (reference) => {
    if (!wompiConfig.privateKey || !reference) return null;

    const url = `${wompiConfig.baseUrl}/transactions?reference=${encodeURIComponent(reference)}`;
    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${wompiConfig.privateKey}` }
    });

    if (!res.ok) {
        console.warn(`[Wompi Sync] GET transactions?reference=${reference} → ${res.status}`);
        return null;
    }

    const body = await res.json();
    const transactions = body?.data;
    if (!Array.isArray(transactions) || transactions.length === 0) return null;

    return pickBestTransaction(transactions);
};

export const fetchWompiTransactionById = async (transactionId) => {
    if (!wompiConfig.privateKey || !transactionId) return null;

    const url = `${wompiConfig.baseUrl}/transactions/${encodeURIComponent(transactionId)}`;
    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${wompiConfig.privateKey}` }
    });

    if (!res.ok) {
        console.warn(`[Wompi Sync] GET transactions/${transactionId} → ${res.status}`);
        return null;
    }

    const body = await res.json();
    return body?.data || null;
};

const pickBestTransaction = (transactions) => (
    transactions.sort((a, b) => {
        const statusScore = (tx) => {
            if (tx.status === 'APPROVED') return 100;
            if (tx.status === 'PENDING') return 40;
            return 0;
        };
        const scoreDiff = statusScore(b) - statusScore(a);
        if (scoreDiff !== 0) return scoreDiff;

        const ta = new Date(a.finalized_at || a.created_at || 0).getTime();
        const tb = new Date(b.finalized_at || b.created_at || 0).getTime();
        return tb - ta;
    })[0]
);

const transactionMatchesOrder = (order, transaction) => {
    if (!order || !transaction) return false;

    if (transaction.id && order.wompi_transaction_id
        && String(transaction.id) === String(order.wompi_transaction_id)) {
        return true;
    }

    if (transaction.reference && order.wompi_reference
        && transaction.reference === order.wompi_reference) {
        return true;
    }

    if (transaction.reference) {
        const txNumero = extractNumeroPedidoFromWompiReference(transaction.reference);
        if (txNumero && txNumero === order.numero_pedido) return true;
        if (String(transaction.reference).includes(order.numero_pedido)) return true;
    }

    return false;
};

/** Busca transacción aprobada por prefijo NUBLACK-{numero_pedido} en movimientos recientes. */
export const fetchWompiTransactionForOrder = async (numeroPedido) => {
    if (!wompiConfig.privateKey || !numeroPedido) return null;

    const prefix = buildWompiReference(numeroPedido);
    const url = `${wompiConfig.baseUrl}/transactions?page=1&page_size=50&order_by=created_at&order=DESC`;

    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${wompiConfig.privateKey}` }
    });

    if (!res.ok) {
        console.warn(`[Wompi Sync] GET transactions list → ${res.status}`);
        return null;
    }

    const body = await res.json();
    const transactions = (body?.data || []).filter(
        (tx) => tx.reference && String(tx.reference).startsWith(prefix)
    );

    if (transactions.length === 0) return null;
    return pickBestTransaction(transactions);
};

const applyApprovedPayment = async (order, transaction) => {
    if (order.estado_pago === 'pagado') {
        return { updated: false, estado_pago: 'pagado' };
    }

    const wasCancelled = order.estado === 'cancelada'
        || order.estado_pago === 'expirado';

    const updateData = {
        estado_pago: 'pagado',
        fecha_pago: transaction.finalized_at ? new Date(transaction.finalized_at) : new Date(),
        wompi_transaction_id: transaction.id,
        wompi_payment_method_type: transaction.payment_method_type || null,
        wompi_reference: transaction.reference || order.wompi_reference
    };

    if (wasCancelled) {
        updateData.estado = 'pendiente';
        updateData.motivo_rechazo = null;
    }

    if (wasCancelled) {
        const t = await sequelize.transaction();
        try {
            const fullOrder = await Solicitud.findByPk(order.id_solicitud, {
                include: [{ model: DetalleSolicitud, as: 'detalles' }],
                transaction: t,
                lock: Transaction.LOCK.UPDATE
            });

            await reserveOrderStock(fullOrder?.detalles || [], t);
            await fullOrder.update(updateData, { transaction: t });
            await t.commit();
            console.log(`[Wompi Sync] Pedido ${order.numero_pedido} restaurado tras pago aprobado (estaba cancelado/expirado).`);
        } catch (err) {
            await t.rollback();
            console.error(`[Wompi Sync] Error reservando stock al restaurar ${order.numero_pedido}:`, err.message);
            await order.update(updateData);
        }
    } else {
        await order.update(updateData);
    }

    if (order.usuario_id) {
        await clearUserCart(order.usuario_id);
    }

    const cliente = order.usuario_id ? await Usuario.findByPk(order.usuario_id) : null;
    notifyPaymentConfirmed(order, cliente).catch((err) => {
        console.error('[Wompi Sync] Error email confirmación:', err);
    });

    return { updated: true, estado_pago: 'pagado' };
};

/**
 * Consulta Wompi y actualiza estado_pago si la transacción ya fue aprobada.
 */
export const syncOrderPaymentFromWompi = async (order, { transactionId = null } = {}) => {
    if (!order || order.metodo_pago !== 'Pasarela') {
        return { synced: false, reason: 'not_gateway' };
    }
    if (order.estado_pago === 'pagado') {
        return { synced: false, reason: 'already_paid', estado_pago: 'pagado' };
    }
    if (!wompiConfig.privateKey) {
        console.warn('[Wompi Sync] WOMPI_PRIVATE_KEY no configurada — no se puede confirmar pago con API.');
        return { synced: false, reason: 'wompi_not_configured' };
    }

    let transaction = null;

    if (transactionId) {
        transaction = await fetchWompiTransactionById(transactionId);
        if (transaction && !transactionMatchesOrder(order, transaction)) {
            console.warn(`[Wompi Sync] Transacción ${transactionId} no coincide con pedido ${order.numero_pedido}`);
            transaction = null;
        }
    }

    const referencesToTry = [order.wompi_reference].filter(Boolean);
    if (!transaction) {
        for (const ref of referencesToTry) {
            transaction = await fetchWompiTransactionByReference(ref);
            if (transaction) break;
        }
    }

    if (!transaction && order.numero_pedido) {
        transaction = await fetchWompiTransactionForOrder(order.numero_pedido);
    }

    if (transaction) {
        const mapped = mapWompiStatusToPaymentStatus(transaction.status);
        if (mapped === 'pagado') {
            const result = await applyApprovedPayment(order, transaction);
            await order.reload();
            return { synced: true, ...result, wompi_status: transaction.status };
        }

        if (mapped === 'pendiente') {
            return {
                synced: true,
                updated: false,
                estado_pago: order.estado_pago,
                wompi_status: transaction.status,
                reason: 'wompi_pending',
            };
        }

        if (mapped === 'fallido' && ['pendiente', 'expirado'].includes(order.estado_pago)) {
            const t = await sequelize.transaction();
            try {
                const fullOrder = await Solicitud.findByPk(order.id_solicitud, {
                    include: [{ model: DetalleSolicitud, as: 'detalles' }],
                    transaction: t,
                    lock: Transaction.LOCK.UPDATE
                });

                if (fullOrder && fullOrder.estado !== 'cancelada') {
                    await restoreOrderStock(fullOrder.detalles, t);
                }

                await fullOrder.update({
                    estado_pago: 'fallido',
                    estado: 'cancelada',
                    motivo_rechazo: 'Pago rechazado por la pasarela',
                    wompi_transaction_id: transaction.id,
                    wompi_payment_method_type: transaction.payment_method_type || null,
                    wompi_reference: transaction.reference || order.wompi_reference
                }, { transaction: t });

                await t.commit();
                await fullOrder.reload();
                return { synced: true, updated: true, estado_pago: 'fallido', wompi_status: transaction.status };
            } catch (err) {
                await t.rollback();
                throw err;
            }
        }
    }

    return { synced: false, reason: 'no_approved_transaction' };
};

/**
 * Sincroniza pedidos pasarela pendientes antes de listar (admin / status).
 */
export const syncPendingGatewayPayments = async (limit = 25) => {
    if (!wompiConfig.privateKey) return { count: 0 };

    const pending = await Solicitud.findAll({
        where: {
            metodo_pago: 'Pasarela',
            estado_pago: { [Op.in]: ['pendiente', 'expirado'] },
            estado: { [Op.in]: ['pendiente', 'cancelada'] }
        },
        order: [['updated_at', 'DESC']],
        limit
    });

    let updated = 0;
    for (const order of pending) {
        try {
            const result = await syncOrderPaymentFromWompi(order);
            if (result.synced && result.updated) updated += 1;
        } catch (err) {
            console.error(`[Wompi Sync] Error pedido ${order.numero_pedido}:`, err.message);
        }
    }

    return { count: pending.length, updated };
};

/** Sincroniza pagos pasarela pendientes de un usuario (por id o correo). */
export const syncUserPendingGatewayPayments = async ({ usuarioId = null, email = null, limit = 10 } = {}) => {
    if (!wompiConfig.privateKey) return { count: 0, updated: 0 };

    const orConditions = [];
    if (usuarioId) orConditions.push({ usuario_id: usuarioId });
    if (email) orConditions.push({ correo_electronico: email });
    if (!orConditions.length) return { count: 0, updated: 0 };

    const pending = await Solicitud.findAll({
        where: {
            metodo_pago: 'Pasarela',
            estado_pago: { [Op.in]: ['pendiente', 'expirado'] },
            estado: { [Op.in]: ['pendiente', 'cancelada'] },
            [Op.or]: orConditions
        },
        order: [['updated_at', 'DESC']],
        limit
    });

    let updated = 0;
    for (const order of pending) {
        try {
            const result = await syncOrderPaymentFromWompi(order);
            if (result.synced && result.updated) updated += 1;
        } catch (err) {
            console.error(`[Wompi Sync] Error pedido usuario ${order.numero_pedido}:`, err.message);
        }
    }

    return { count: pending.length, updated };
};
