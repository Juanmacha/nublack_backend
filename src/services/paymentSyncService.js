import { Op } from 'sequelize';
import { Solicitud, DetalleSolicitud, Usuario } from '../models/index.js';
import { wompiConfig } from '../config/wompi.js';
import {
    buildWompiReference,
    mapWompiStatusToPaymentStatus
} from './wompiService.js';
import { sendOrderConfirmationEmail } from './emailService.js';
import { clearUserCart } from './cartService.js';

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

const pickBestTransaction = (transactions) => (
    transactions.sort((a, b) => {
        const ta = new Date(a.finalized_at || a.created_at || 0).getTime();
        const tb = new Date(b.finalized_at || b.created_at || 0).getTime();
        return tb - ta;
    })[0]
);

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

    await order.update({
        estado_pago: 'pagado',
        fecha_pago: transaction.finalized_at ? new Date(transaction.finalized_at) : new Date(),
        wompi_transaction_id: transaction.id,
        wompi_payment_method_type: transaction.payment_method_type || null,
        wompi_reference: transaction.reference || order.wompi_reference
    });

    const cliente = await Usuario.findByPk(order.usuario_id);
    if (cliente) {
        sendOrderConfirmationEmail(cliente.email, order).catch((err) => {
            console.error('[Wompi Sync] Error email confirmación:', err);
        });
    }

    await clearUserCart(order.usuario_id);

    return { updated: true, estado_pago: 'pagado' };
};

/**
 * Consulta Wompi y actualiza estado_pago si la transacción ya fue aprobada.
 */
export const syncOrderPaymentFromWompi = async (order) => {
    if (!order || order.metodo_pago !== 'Pasarela') {
        return { synced: false, reason: 'not_gateway' };
    }
    if (order.estado_pago === 'pagado') {
        return { synced: false, reason: 'already_paid', estado_pago: 'pagado' };
    }
    if (!wompiConfig.privateKey) {
        return { synced: false, reason: 'wompi_not_configured' };
    }

    const referencesToTry = [order.wompi_reference].filter(Boolean);
    let transaction = null;

    for (const ref of referencesToTry) {
        transaction = await fetchWompiTransactionByReference(ref);
        if (transaction) break;
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

        if (mapped === 'fallido' && order.estado_pago === 'pendiente') {
            await order.update({
                estado_pago: 'fallido',
                wompi_transaction_id: transaction.id,
                wompi_payment_method_type: transaction.payment_method_type || null,
                wompi_reference: transaction.reference || order.wompi_reference
            });
            await order.reload();
            return { synced: true, updated: true, estado_pago: 'fallido', wompi_status: transaction.status };
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
            estado_pago: { [Op.in]: ['pendiente', 'expirado'] }
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
