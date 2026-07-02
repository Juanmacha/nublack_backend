import { incrementProductStock } from '../utils/stockUtils.js';

export const restoreOrderStock = async (detalles, transaction) => {
    for (const item of (detalles || [])) {
        await incrementProductStock(
            item.producto_id,
            item.cantidad,
            item.talla,
            transaction
        );
    }
};
