import express from 'express';
import { Op } from 'sequelize';
import { Usuario, Producto, Categoria, Solicitud, DetalleSolicitud } from '../models/index.js';
import authMiddleware from '../middleware/authMiddleware.js';
import isAdmin from '../middleware/isAdmin.js';
import sequelize from '../config/database.js';

const router = express.Router();

const getStats = async (req, res) => {
    try {
        const [usuarios, productos, categorias, solicitudes, detalles] = await Promise.all([
            Usuario.count(),
            Producto.count(),
            Categoria.count(),
            Solicitud.count(),
            DetalleSolicitud.count()
        ]);

        const solicitudesPorEstado = await Solicitud.findAll({
            attributes: ['estado', [sequelize.fn('COUNT', sequelize.col('*')), 'count']],
            group: ['estado']
        });

        // Valor confirmado: pasarela pagada o pedido entregado (contra entrega cobrada)
        const valorTotal = await Solicitud.sum('total', {
            where: {
                estado: { [Op.ne]: 'cancelada' },
                [Op.or]: [
                    { estado_pago: 'pagado' },
                    { estado: 'entregada' }
                ]
            }
        });

        // Format states count
        const states = {
            pendiente: 0,
            aprobada: 0,
            en_camino: 0,
            entregada: 0,
            cancelada: 0
        };

        const statusMapBEtoFE = {
            'aceptada': 'aprobada',
            'enviada': 'en_camino',
            'entregada': 'entregada',
            'cancelada': 'cancelada',
            'pendiente': 'pendiente'
        };

        solicitudesPorEstado.forEach(s => {
            const estadoFE = statusMapBEtoFE[s.estado] || s.estado;
            if (states[estadoFE] !== undefined) {
                states[estadoFE] += parseInt(s.get('count'));
            }
        });

        res.json({
            usuarios,
            productos,
            categorias,
            solicitudes,
            detalles,
            valorTotal: valorTotal || 0,
            solicitudesPendientes: states.pendiente,
            solicitudesAprobadas: states.aprobada,
            solicitudesEnCamino: states.en_camino,
            solicitudesEntregadas: states.entregada
        });
    } catch (error) {
        console.error('Stats Error:', error);
        res.status(500).json({ message: 'Error al obtener estadísticas' });
    }
};

router.get('/', authMiddleware, isAdmin, getStats);

export default router;
