import express from 'express';
import { Transaction } from 'sequelize';
import sequelize from '../config/database.js';
import { Carrito, Producto } from '../models/index.js';
import authMiddleware from '../middleware/authMiddleware.js';
import { getAvailableStock } from '../utils/stockUtils.js';

const router = express.Router();

/**
 * Get current user's cart
 */
const getCart = async (req, res) => {
    try {
        const usuario_id = req.usuarioId;
        const cartItems = await Carrito.findAll({
            where: { usuario_id },
            include: [{ model: Producto, as: 'producto' }]
        });
        res.json(cartItems);
    } catch (error) {
        console.error('Get Cart Error:', error);
        res.status(500).json({ message: 'Error al obtener el carrito' });
    }
};

/**
 * Add or Update item in cart
 */
const addToCart = async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const usuario_id = req.usuarioId;
        const { producto_id, cantidad, talla } = req.body;

        const producto = await Producto.findByPk(producto_id, {
            transaction: t,
            lock: Transaction.LOCK.UPDATE
        });
        if (!producto) {
            await t.rollback();
            return res.status(400).json({ message: 'Producto no encontrado', code: 'PRODUCT_NOT_FOUND', item: { id: producto_id } });
        }

        const available = getAvailableStock(producto, talla);
        const isUpdate = !!req.body.isUpdate;
        const cartTalla = talla || 'N/A';

        let cartItem = await Carrito.findOne({
            where: { usuario_id, producto_id, talla: cartTalla },
            transaction: t,
            lock: Transaction.LOCK.UPDATE
        });
        const currentQty = cartItem ? cartItem.cantidad : 0;
        const incomingQty = parseInt(cantidad || 1, 10) || 1;
        const totalRequested = isUpdate ? incomingQty : (currentQty + incomingQty);

        if (totalRequested > available) {
            await t.rollback();
            return res.status(400).json({
                message: 'Stock insuficiente',
                code: 'INSUFFICIENT_STOCK',
                item: { id: producto_id, talla: talla || null, available, requested: totalRequested }
            });
        }

        if (cartItem) {
            cartItem.cantidad = isUpdate ? incomingQty : currentQty + incomingQty;
            await cartItem.save({ transaction: t });
        } else {
            cartItem = await Carrito.create({
                usuario_id,
                producto_id,
                cantidad: incomingQty,
                talla: cartTalla
            }, { transaction: t });
        }

        await t.commit();
        res.json({ success: true, data: cartItem });
    } catch (error) {
        await t.rollback();
        console.error('Add To Cart Error:', error);
        res.status(500).json({ message: 'Error al añadir al carrito' });
    }
};

/**
 * Remove item from cart
 */
const removeFromCart = async (req, res) => {
    try {
        const usuario_id = req.usuarioId;
        const { id } = req.params;

        const deleted = await Carrito.destroy({
            where: { id_carrito: id, usuario_id }
        });

        if (deleted) {
            res.json({ success: true, message: 'Producto eliminado del carrito' });
        } else {
            res.status(404).json({ message: 'Item no encontrado en el carrito' });
        }
    } catch (error) {
        res.status(500).json({ message: 'Error al eliminar del carrito' });
    }
};

const clearCart = async (req, res) => {
    try {
        const usuario_id = req.usuarioId;
        await Carrito.destroy({ where: { usuario_id } });
        res.json({ success: true, message: 'Carrito vaciado' });
    } catch (error) {
        res.status(500).json({ message: 'Error al vaciar el carrito' });
    }
};

router.get('/', authMiddleware, getCart);
router.post('/', authMiddleware, addToCart);
router.delete('/:id', authMiddleware, removeFromCart);
router.delete('/', authMiddleware, clearCart);

export default router;
