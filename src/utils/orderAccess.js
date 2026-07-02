import { Solicitud, DetalleSolicitud } from '../models/index.js';

/**
 * Busca un pedido por número o id.
 * - Admin: cualquier pedido.
 * - Usuario autenticado: pedidos de ese usuario.
 * - Sin sesión + allowPublicOrderLookup: por número (checkout/pago invitado reciente).
 */
export const findOrderForAccess = async (orderRef, usuarioId, { asAdmin = false, allowPublicOrderLookup = false } = {}) => {
    const include = [{ model: DetalleSolicitud, as: 'detalles' }];

    const buildWhere = (extra = {}) => {
        if (asAdmin || allowPublicOrderLookup) return extra;
        if (usuarioId) return { ...extra, usuario_id: usuarioId };
        return { ...extra, usuario_id: null };
    };

    const byNumero = await Solicitud.findOne({
        where: buildWhere({ numero_pedido: orderRef }),
        include
    });
    if (byNumero) return byNumero;

    if (/^\d+$/.test(String(orderRef))) {
        return Solicitud.findOne({
            where: buildWhere({ id_solicitud: orderRef }),
            include
        });
    }

    return null;
};
