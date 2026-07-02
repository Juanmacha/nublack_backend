import bcrypt from 'bcryptjs';
import { Usuario } from '../models/index.js';
import { sendWelcomeEmail } from './emailService.js';

const DOC_TYPE_MAP = {
    CC: 'Cédula de Ciudadanía',
    CE: 'Cédula de extranjería',
    TI: 'Tarjeta de Identidad',
    PP: 'Pasaporte',
};

const PASSWORD_REGEX = /^(?=.*[A-Z])(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]).{7,}$/;

const parseDocument = (personalInfo) => {
    if (personalInfo.documentNumber) {
        const typeKey = personalInfo.documentType || 'CC';
        return {
            tipo_documento: DOC_TYPE_MAP[typeKey] || DOC_TYPE_MAP.CC,
            documento: String(personalInfo.documentNumber).trim(),
        };
    }

    const raw = personalInfo.documento || personalInfo.document || '';
    const match = String(raw).match(/^(\w+)\s+(.+)$/);
    if (match) {
        return {
            tipo_documento: DOC_TYPE_MAP[match[1]] || DOC_TYPE_MAP.CC,
            documento: match[2].trim(),
        };
    }

    return {
        tipo_documento: DOC_TYPE_MAP.CC,
        documento: String(raw).trim(),
    };
};

const validateCheckoutPassword = (password) => {
    const plain = (password || '').trim();
    if (!plain) {
        const err = new Error('La contraseña es obligatoria para crear tu cuenta.');
        err.code = 'PASSWORD_REQUIRED';
        throw err;
    }
    if (!PASSWORD_REGEX.test(plain)) {
        const err = new Error('La contraseña debe tener al menos 7 caracteres, una mayúscula y un carácter especial.');
        err.code = 'INVALID_PASSWORD';
        throw err;
    }
    return plain;
};

/**
 * Busca un cliente existente por email/documento o crea uno nuevo
 * con los datos del checkout (compra sin login previo).
 */
export const resolveCheckoutCustomer = async (personalInfo, transaction) => {
    const email = (personalInfo.email || '').trim().toLowerCase();
    const telefono = (personalInfo.telefono || personalInfo.phone || '').trim();
    const firstName = (personalInfo.firstName || '').trim();
    const lastName = (personalInfo.lastName || '').trim();

    let nombre = firstName;
    let apellido = lastName;
    if (!nombre && personalInfo.nombre) {
        const parts = String(personalInfo.nombre).trim().split(/\s+/);
        nombre = parts[0] || 'Cliente';
        apellido = parts.slice(1).join(' ') || 'NUBLACK';
    }
    if (!nombre) nombre = 'Cliente';
    if (!apellido) apellido = 'NUBLACK';

    const { tipo_documento, documento } = parseDocument(personalInfo);

    if (!email) {
        const err = new Error('El correo electrónico es obligatorio.');
        err.code = 'EMAIL_REQUIRED';
        throw err;
    }
    if (!documento) {
        const err = new Error('El documento de identidad es obligatorio.');
        err.code = 'DOCUMENT_REQUIRED';
        throw err;
    }

    let user = await Usuario.findOne({ where: { email }, transaction });
    if (!user) {
        user = await Usuario.findOne({ where: { documento }, transaction });
    }

    if (user) {
        const updates = {};
        if (telefono && user.telefono !== telefono) updates.telefono = telefono;
        if (nombre && user.nombre === 'Cliente' && nombre !== 'Cliente') updates.nombre = nombre;
        if (apellido && user.apellido === 'NUBLACK' && apellido !== 'NUBLACK') updates.apellido = apellido;
        if (Object.keys(updates).length > 0) {
            await user.update(updates, { transaction });
        }
        return { usuario_id: user.id_usuario, created: false, existing: true };
    }

    const plainPassword = validateCheckoutPassword(personalInfo.password);
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(plainPassword, salt);

    const newUser = await Usuario.create({
        nombre,
        apellido,
        tipo_documento,
        documento,
        telefono: telefono || '0000000000',
        email,
        password_hash,
        password_salt: salt,
        rol: 'cliente',
        estado: 'activo',
    }, { transaction });

    sendWelcomeEmail(newUser.email, newUser.nombre).catch((err) => {
        console.error('Error email bienvenida checkout:', err.message);
    });

    return { usuario_id: newUser.id_usuario, created: true, existing: false };
};
