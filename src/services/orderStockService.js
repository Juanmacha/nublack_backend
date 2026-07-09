import { Transaction } from 'sequelize';
import { incrementProductStock, decrementProductStock } from '../utils/stockUtils.js';
import { Producto } from '../models/index.js';

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

/** Reserva stock nuevamente cuando un pedido cancelado/expirado se confirma como pagado. */
export const reserveOrderStock = async (detalles, transaction) => {
    for (const item of (detalles || [])) {
        const producto = await Producto.findByPk(item.producto_id, {
            transaction,
            lock: Transaction.LOCK.UPDATE
        });
        if (!producto) continue;
        await decrementProductStock(producto, item.cantidad, item.talla, transaction);
    }
};
