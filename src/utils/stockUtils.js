import { Transaction } from 'sequelize';
import { Producto } from '../models/index.js';

export const parseTallasObj = (tallas) => {
    if (!tallas) return {};
    if (typeof tallas === 'string') {
        try {
            return JSON.parse(tallas);
        } catch {
            return {};
        }
    }
    return tallas;
};

export const hasSizedInventory = (tallasObj) => {
    if (!tallasObj) return false;
    if (Array.isArray(tallasObj)) return tallasObj.length > 0;
    if (typeof tallasObj === 'object') return Object.keys(tallasObj).length > 0;
    return false;
};

const normalizeTalla = (talla) => {
    if (talla == null || talla === '') return null;
    const value = String(talla).trim();
    if (!value || value === 'N/A') return null;
    return value;
};

/**
 * Stock disponible para un producto y talla opcional.
 * Si el producto tiene tallas definidas, una talla inválida o ausente devuelve 0.
 */
export const getAvailableStock = (producto, talla) => {
    const tallasObj = parseTallasObj(producto.tallas);
    const sized = hasSizedInventory(tallasObj);
    const normalizedTalla = normalizeTalla(talla);

    if (sized) {
        if (!normalizedTalla) return 0;
        if (Array.isArray(tallasObj)) {
            const found = tallasObj.find((item) => String(item.talla) === String(normalizedTalla));
            return found ? parseInt(found.stock || 0, 10) : 0;
        }
        return parseInt(tallasObj[normalizedTalla] || 0, 10);
    }

    return parseInt(producto.stock || 0, 10);
};

export const decrementProductStock = async (producto, quantity, size, transaction) => {
    const qty = parseInt(quantity, 10) || 1;
    const tallasObj = parseTallasObj(producto.tallas);
    const sized = hasSizedInventory(tallasObj);
    const normalizedSize = normalizeTalla(size);

    if (sized && normalizedSize) {
        if (Array.isArray(tallasObj)) {
            const idx = tallasObj.findIndex((item) => String(item.talla) === String(normalizedSize));
            if (idx >= 0) {
                const availableForSize = parseInt(tallasObj[idx].stock || 0, 10);
                tallasObj[idx].stock = Math.max(0, availableForSize - qty);
            }
        } else {
            const availableForSize = parseInt(tallasObj[normalizedSize] || 0, 10);
            tallasObj[normalizedSize] = Math.max(0, availableForSize - qty);
        }

        await producto.update({
            tallas: tallasObj,
            stock: Math.max(0, parseInt(producto.stock || 0, 10) - qty)
        }, { transaction });
        return;
    }

    await Producto.decrement('stock', {
        by: qty,
        where: { id_producto: producto.id_producto },
        transaction
    });
};

export const incrementProductStock = async (productoId, quantity, size, transaction) => {
    const qty = parseInt(quantity, 10) || 1;
    const producto = await Producto.findByPk(productoId, {
        transaction,
        lock: Transaction.LOCK.UPDATE
    });
    if (!producto) return;

    const tallasObj = parseTallasObj(producto.tallas);
    const sized = hasSizedInventory(tallasObj);
    const normalizedSize = normalizeTalla(size);

    if (sized && normalizedSize) {
        if (Array.isArray(tallasObj)) {
            const idx = tallasObj.findIndex((item) => String(item.talla) === String(normalizedSize));
            if (idx >= 0) {
                tallasObj[idx].stock = parseInt(tallasObj[idx].stock || 0, 10) + qty;
            }
        } else {
            tallasObj[normalizedSize] = parseInt(tallasObj[normalizedSize] || 0, 10) + qty;
        }

        await producto.update({
            tallas: tallasObj,
            stock: parseInt(producto.stock || 0, 10) + qty
        }, { transaction });
        return;
    }

    await Producto.increment('stock', {
        by: qty,
        where: { id_producto: productoId },
        transaction
    });
};
