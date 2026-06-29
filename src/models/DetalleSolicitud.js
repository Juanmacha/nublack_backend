import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const DetalleSolicitud = sequelize.define('DetalleSolicitud', {
    id_detalle: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    solicitud_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: 'solicitudes',
            key: 'id_solicitud'
        }
    },
    producto_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: 'productos',
            key: 'id_producto'
        }
    },
    nombre_producto: {
        type: DataTypes.STRING(150),
        allowNull: false
    },
    descripcion_producto: {
        type: DataTypes.TEXT
    },
    imagen_producto: {
        type: DataTypes.TEXT
    },
    cantidad: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    talla: {
        type: DataTypes.STRING(50)
    },
    precio_unitario: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false
    },
    subtotal: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false
    },
    created_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    }
}, {
    tableName: 'detalles_solicitud',
    timestamps: false
});

export default DetalleSolicitud;
