import { Producto, Categoria, LogActividad } from '../models/index.js';
import { Op } from 'sequelize';
import { notifyRegisteredClientsNewProduct } from '../services/emailService.js';
import { logActivity } from '../middleware/loggerMiddleware.js';

export const getAllProducts = async (req, res) => {
    try {
        const { cid, min, max, genero } = req.query;

        const where = { estado: 'activo' };

        if (cid && cid !== 'all') where.categoria_id = cid;
        if (genero) where.genero = genero;

        const products = await Producto.findAll({
            where,
            include: [
                { model: Categoria, as: 'categoria', attributes: ['id_categoria', 'nombre'] }
            ]
        });

        res.json({
            success: true,
            data: {
                productos: products
            }
        });

    } catch (error) {
        console.error("Get Products Error:", error);
        res.status(500).json({ message: 'Error al obtener productos' });
    }
};

export const getProductById = async (req, res) => {
    try {
        const { id } = req.params;
        const product = await Producto.findOne({
            where: { id_producto: id },
            include: [
                { model: Categoria, as: 'categoria', attributes: ['nombre'] }
            ]
        });

        if (!product) return res.status(404).json({ message: 'Producto no encontrado' });

        res.json(product);
    } catch (error) {
        res.status(500).json({ message: 'Error servidor' });
    }
};

export const createProduct = async (req, res) => {
    try {
        const { nombre, precio, categoria_id, descripcion, imagen, tallas, imagenes, images, genero } = req.body;
        console.log('Creando producto con datos:', { nombre, precio, categoria_id, totalTallas: tallas?.length });

        // Calcular stock total sumando el stock de cada talla
        let totalStock = 0;
        if (Array.isArray(tallas)) {
            totalStock = tallas.reduce((sum, t) => sum + (parseInt(t.stock) || 0), 0);
        }

        console.log('Calculando stock total:', totalStock);

        const newProduct = await Producto.create({
            nombre,
            precio,
            categoria_id,
            stock: totalStock,
            descripcion,
            imagen: imagen || (Array.isArray(images) ? images[0] : null),
            tallas, // Se guarda como JSON
            imagenes: imagenes || images, // Se guarda como JSON
            genero: genero || 'Unisex',
            estado: 'activo'
        });

        console.log('Producto creado en DB:', newProduct.id_producto);

        // Log Activity
        try {
            await logActivity(req, {
                accion: 'CREAR_PRODUCTO',
                tabla: 'productos',
                registroId: newProduct.id_producto,
                datosNuevos: newProduct.toJSON()
            });
            console.log('Log de actividad registrado');
        } catch (logErr) {
            console.error('Error en logActivity:', logErr);
            // No bloqueamos la respuesta por un error de log
        }

        res.status(201).json({
            success: true,
            message: 'Producto creado exitosamente',
            data: newProduct
        });

        notifyRegisteredClientsNewProduct(newProduct).catch((err) =>
            console.error('[Email] Error notificación novedad producto:', err.message)
        );
    } catch (error) {
        console.error('Create Product Error:', error);
        res.status(500).json({ message: 'Error al crear producto', error: error.message });
    }
};

export const updateProduct = async (req, res) => {
    try {
        const { id } = req.params;
        const product = await Producto.findByPk(id);

        if (!product) return res.status(404).json({ message: 'Producto no encontrado' });

        const { tallas, images, ...otherData } = req.body;

        // Recalcular stock si vienen tallas
        let updateData = { ...req.body };
        if (tallas && Array.isArray(tallas)) {
            updateData.stock = tallas.reduce((sum, t) => sum + (parseInt(t.stock) || 0), 0);
        }

        // Asegurar imágenes
        if (images && Array.isArray(images)) {
            if (!updateData.imagen) updateData.imagen = images[0];
            updateData.imagenes = images;
        }

        const datosAnteriores = product.toJSON();
        await product.update(updateData);

        // Log Activity
        await logActivity(req, {
            accion: 'ACTUALIZAR_PRODUCTO',
            tabla: 'productos',
            registroId: id,
            datosAnteriores,
            datosNuevos: updateData
        });

        res.json({
            success: true,
            message: 'Producto actualizado correctamente',
            data: product
        });
    } catch (error) {
        console.error('Update Product Error:', error);
        res.status(500).json({ message: 'Error al actualizar producto', error: error.message });
    }
};

export const deleteProduct = async (req, res) => {
    try {
        const { id } = req.params;
        const product = await Producto.findByPk(id);

        if (!product) return res.status(404).json({ message: 'Producto no encontrado' });

        const datosAnteriores = product.toJSON();
        // Soft delete: Change status to 'inactivo'
        await product.update({ estado: 'inactivo' });

        // Log Activity
        await logActivity(req, {
            accion: 'ELIMINAR_PRODUCTO_SOFT',
            tabla: 'productos',
            registroId: id,
            datosAnteriores,
            datosNuevos: { estado: 'inactivo' }
        });

        res.json({
            success: true,
            message: 'Producto deshabilitado (marcado como inactivo)'
        });
    } catch (error) {
        console.error('Delete Product Error:', error);
        res.status(500).json({ message: 'Error al eliminar producto' });
    }
};

export const uploadImage = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'No se subió ningún archivo' });
        }

        // Return the relative URL for the frontend
        const imageUrl = `/images/products/${req.file.filename}`;

        res.json({
            success: true,
            imageUrl
        });
    } catch (error) {
        res.status(500).json({ message: 'Error al procesar la imagen' });
    }
};
