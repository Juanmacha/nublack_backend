import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';
import bcrypt from 'bcryptjs';

const Usuario = sequelize.define('Usuario', {
    id_usuario: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    nombre: {
        type: DataTypes.STRING(100),
        allowNull: false
    },
    apellido: {
        type: DataTypes.STRING(100),
        allowNull: false
    },
    tipo_documento: {
        type: DataTypes.ENUM('Cédula de Ciudadanía', 'Cédula de extranjería', 'Pasaporte', 'Tarjeta de Identidad'),
        allowNull: false
    },
    documento: {
        type: DataTypes.STRING(50),
        allowNull: false,
        unique: true
    },
    telefono: {
        type: DataTypes.STRING(20),
        allowNull: false
    },
    email: {
        type: DataTypes.STRING(150),
        allowNull: false,
        unique: true
    },
    // Virtual field for raw password
    password: {
        type: DataTypes.VIRTUAL,
        set(value) {
            this.setDataValue('password', value);
        },
        validate: {
            len: [6, 100]
        }
    },
    password_hash: {
        type: DataTypes.STRING(255),
        allowNull: false
    },
    password_salt: {
        type: DataTypes.STRING(255),
        allowNull: false
    },
    reset_password_token: {
        type: DataTypes.STRING(255),
        allowNull: true
    },
    reset_password_expires: {
        type: DataTypes.DATE,
        allowNull: true
    },
    rol: {
        type: DataTypes.ENUM('administrador', 'cliente', 'empleado'),
        defaultValue: 'cliente'
    },
    estado: {
        type: DataTypes.ENUM('activo', 'inactivo', 'suspendido'),
        defaultValue: 'activo'
    },
    created_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    },
    updated_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    }
}, {
    tableName: 'usuarios',
    timestamps: false,
    hooks: {
        beforeCreate: async (usuario) => {
            const plain = usuario.getDataValue('password');
            if (plain) {
                const salt = await bcrypt.genSalt(10);
                usuario.password_hash = await bcrypt.hash(plain, salt);
                usuario.password_salt = salt;
            }
        },
        beforeUpdate: async (usuario) => {
            const plain = usuario.getDataValue('password');
            if (plain) {
                const salt = await bcrypt.genSalt(10);
                usuario.password_hash = await bcrypt.hash(plain, salt);
                usuario.password_salt = salt;
            }
        },
    }
});

// Instance method to compare password
Usuario.prototype.validPassword = async function (password) {
    return await bcrypt.compare(password, this.password_hash);
};

export default Usuario;
