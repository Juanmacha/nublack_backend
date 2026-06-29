import { Producto } from '../models/index.js';

export const restoreOrderStock = async (detalles, transaction) => {
    for (const item of (detalles || [])) {
        await Producto.increment('stock', {
            by: item.cantidad,
            where: { id_producto: item.producto_id },
            transaction
        });
    }
};
