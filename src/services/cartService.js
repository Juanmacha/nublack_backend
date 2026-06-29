import { Carrito } from '../models/index.js';

/** Vacía el carrito del usuario en BD. Usar solo tras checkout confirmado. */
export const clearUserCart = async (usuarioId) => {
    if (!usuarioId) return;
    try {
        await Carrito.destroy({ where: { usuario_id: usuarioId } });
    } catch (err) {
        console.error('[Cart] Error al limpiar carrito:', err);
    }
};
