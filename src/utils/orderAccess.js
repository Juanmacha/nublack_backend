import { Op } from 'sequelize';
import { Solicitud, DetalleSolicitud, Usuario } from '../models/index.js';

/**
 * Busca un pedido por número o id.
 * - Admin: cualquier pedido.
 * - Usuario autenticado: pedidos de ese usuario o con su correo.
 * - Sin sesión + allowPublicOrderLookup: por número (checkout/pago invitado reciente).
 */
export const findOrderForAccess = async (orderRef, usuarioId, {
    asAdmin = false,
    allowPublicOrderLookup = false,
    userEmail = null
} = {}) => {
    const include = [{ model: DetalleSolicitud, as: 'detalles' }];

    let resolvedEmail = userEmail;
    if (!resolvedEmail && usuarioId) {
        const user = await Usuario.findByPk(usuarioId, { attributes: ['email'] });
        resolvedEmail = user?.email || null;
    }

    const buildWhere = (extra = {}) => {
        if (asAdmin || allowPublicOrderLookup) return extra;
        if (usuarioId || resolvedEmail) {
            const orCond = [];
            if (usuarioId) orCond.push({ usuario_id: usuarioId });
            if (resolvedEmail) orCond.push({ correo_electronico: resolvedEmail });
            return { ...extra, [Op.or]: orCond };
        }
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
