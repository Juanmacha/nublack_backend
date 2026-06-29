import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const Solicitud = sequelize.define('Solicitud', {
    id_solicitud: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    numero_pedido: {
        type: DataTypes.STRING(50),
        allowNull: false,
        unique: true
    },
    usuario_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: 'usuarios',
            key: 'id_usuario'
        }
    },
    fecha_solicitud: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    },
    estado: {
        type: DataTypes.ENUM('pendiente', 'aprobada', 'en_camino', 'entregada', 'cancelada', 'aceptada', 'rechazada', 'en_proceso', 'enviada'),
        defaultValue: 'pendiente'
    },
    motivo_rechazo: {
        type: DataTypes.TEXT
    },
    // Información Personal
    nombre_cliente: { type: DataTypes.STRING(100), allowNull: false },
    documento_identificacion: { type: DataTypes.STRING(50), allowNull: false },
    telefono_contacto: { type: DataTypes.STRING(20), allowNull: false },
    correo_electronico: { type: DataTypes.STRING(100) },
    // Información de Entrega
    direccion_envio: { type: DataTypes.STRING(255), allowNull: false },
    referencia_direccion: { type: DataTypes.STRING(255) },
    indicaciones_adicionales: { type: DataTypes.TEXT },
    horario_preferido: { type: DataTypes.STRING(100) },
    // Preferencias y Pago
    metodo_pago: {
        type: DataTypes.ENUM('Contra Entrega', 'Pasarela', 'Tarjeta', 'Transferencia', 'PSE'),
        defaultValue: 'Contra Entrega'
    },
    estado_pago: {
        type: DataTypes.ENUM('pendiente', 'pagado', 'fallido', 'expirado', 'no_aplica'),
        defaultValue: 'no_aplica'
    },
    wompi_transaction_id: { type: DataTypes.STRING(100) },
    wompi_reference: { type: DataTypes.STRING(100) },
    wompi_payment_method_type: { type: DataTypes.STRING(50) },
    fecha_pago: { type: DataTypes.DATE },
    pago_expira_at: { type: DataTypes.DATE },
    total: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    subtotal: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    envio: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
    idempotency_key: { type: DataTypes.STRING(100), unique: true, allowNull: true },
    tiempo_estimado_entrega: { type: DataTypes.STRING(100) },
    numero_guia: { type: DataTypes.STRING(100) },
    nombre_empaquetadora: { type: DataTypes.STRING(150) },
    fecha_despacho: { type: DataTypes.DATE },
    prioridad: {
        type: DataTypes.ENUM('baja', 'normal', 'alta', 'urgente'),
        defaultValue: 'normal'
    },
    notas_internas: { type: DataTypes.TEXT },
    created_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    },
    updated_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    }
}, {
    tableName: 'solicitudes',
    timestamps: false
});

export default Solicitud;
