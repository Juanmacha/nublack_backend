import { Op } from 'sequelize';
import { Producto, Categoria } from '../models/index.js';
import { logActivity } from '../middleware/loggerMiddleware.js';
import {
    WOMPI_TEST_PRODUCT_NAME,
    WOMPI_TEST_PRODUCT_PRICE,
    WOMPI_TEST_VARIANTES,
    isWompiTestProduct,
    normalizeWompiTestProductRecord,
} from '../utils/wompiTestProduct.js';

const TEST_PRODUCT_PAYLOAD = {
    nombre: WOMPI_TEST_PRODUCT_NAME,
    precio: WOMPI_TEST_PRODUCT_PRICE,
    precio_original: WOMPI_TEST_PRODUCT_PRICE,
    descripcion: 'Producto interno para probar pagos Wompi en producción. No aparece en el catálogo público. Total fijo $2.000 sin envío.',
    estado: 'activo',
    genero: 'Unisex',
    stock: 999,
    tallas: [{ talla: 'Unica', stock: 999 }],
    variantes: WOMPI_TEST_VARIANTES,
    imagen: '/images/placeholder.png',
    imagenes: ['/images/placeholder.png'],
    rating: 5,
};

const findExistingTestProduct = () => Producto.findOne({
    where: {
        [Op.or]: [
            { nombre: WOMPI_TEST_PRODUCT_NAME },
            { nombre: { [Op.like]: '[WOMPI-TEST]%' } },
        ],
    },
});

const resolveDefaultCategoryId = async () => {
    const category = await Categoria.findOne({ order: [['id_categoria', 'ASC']] });
    return category?.id_categoria || null;
};

export const getWompiTestProduct = async (req, res) => {
    try {
        let product = await findExistingTestProduct();
        if (!product || !isWompiTestProduct(product)) {
            return res.status(404).json({
                message: 'El producto test Wompi aún no fue creado. Créalo desde el panel admin.',
                code: 'WOMPI_TEST_NOT_FOUND',
            });
        }

        product = await normalizeWompiTestProductRecord(product);

        res.json({
            success: true,
            data: product,
        });
    } catch (error) {
        console.error('Get Wompi Test Product Error:', error);
        res.status(500).json({ message: 'Error al obtener producto test Wompi' });
    }
};

export const ensureWompiTestProduct = async (req, res) => {
    try {
        const categoria_id = await resolveDefaultCategoryId();
        let product = await findExistingTestProduct();

        if (product) {
            await product.update({
                ...TEST_PRODUCT_PAYLOAD,
                categoria_id: product.categoria_id || categoria_id,
            });
            // Desactivar duplicados antiguos (p. ej. nombre con $1.000)
            await Producto.update(
                { estado: 'inactivo' },
                {
                    where: {
                        id_producto: { [Op.ne]: product.id_producto },
                        nombre: { [Op.like]: '[WOMPI-TEST]%' },
                    },
                }
            );
        } else {
            product = await Producto.create({
                ...TEST_PRODUCT_PAYLOAD,
                categoria_id,
            });

            try {
                await logActivity(req, {
                    accion: 'CREAR_PRODUCTO_TEST_WOMPI',
                    tabla: 'productos',
                    registroId: product.id_producto,
                    datosNuevos: product.toJSON(),
                });
            } catch (logErr) {
                console.warn('Log producto test Wompi:', logErr.message);
            }
        }

        await product.reload();

        res.json({
            success: true,
            message: product ? 'Producto test Wompi listo' : 'Producto test Wompi creado',
            created: !product.created_at || product.created_at === product.updated_at,
            data: product,
        });
    } catch (error) {
        console.error('Ensure Wompi Test Product Error:', error);
        res.status(500).json({ message: 'Error al crear producto test Wompi', error: error.message });
    }
};
