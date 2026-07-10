import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import { Usuario } from '../models/index.js';
import { resolveWompiChargeAmount, isMetroPasarelaSplitOrder } from './wompiService.js';

dotenv.config();

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    transporter.verify((error) => {
        if (error) {
            console.error('[Email] Error de conexión:', error.message);
        } else {
            console.log('[Email] Servicio listo para enviar mensajes');
        }
    });
} else {
    console.warn('[Email] EMAIL_USER o EMAIL_PASS no configurados — los correos no se enviarán.');
}

const getStoreUrl = () => (process.env.FRONTEND_URL || 'https://nublack12.com').replace(/\/$/, '');

export const isEmailConfigured = () =>
    Boolean(String(process.env.EMAIL_USER || '').trim() && String(process.env.EMAIL_PASS || '').trim());

const getFromAddress = () =>
    process.env.EMAIL_FROM || `"NUBLACK Store" <${process.env.EMAIL_USER}>`;

const resolveAbsoluteImageUrl = (image) => {
    if (!image) return `${getStoreUrl()}/images/hero_bg.jpg`;
    if (/^https?:\/\//i.test(image)) return image;
    return `${getStoreUrl()}${image.startsWith('/') ? image : `/${image}`}`;
};

const safeSendMail = async (mailOptions) => {
    if (!isEmailConfigured()) {
        console.warn('[Email] Omitido (sin configuración):', mailOptions.subject);
        return null;
    }
    try {
        const info = await transporter.sendMail({
            from: getFromAddress(),
            ...mailOptions,
        });
        console.log('[Email] Enviado:', mailOptions.subject, '→', mailOptions.to || mailOptions.bcc);
        return info;
    } catch (err) {
        console.error('[Email] Error al enviar:', mailOptions.subject, err.message);
        throw err;
    }
};

export const getAdminEmails = async () => {
    const fromEnv = String(process.env.ADMIN_EMAIL || process.env.EMAIL_USER || '')
        .split(',')
        .map((e) => e.trim())
        .filter(Boolean);

    try {
        const admins = await Usuario.findAll({
            where: { rol: 'administrador', estado: 'activo' },
            attributes: ['email'],
        });
        const dbEmails = admins.map((a) => a.email).filter(Boolean);
        return [...new Set([...fromEnv, ...dbEmails])];
    } catch (err) {
        console.warn('[Email] No se pudieron cargar admins desde BD:', err.message);
        return fromEnv;
    }
};

export const resolveCustomerEmail = (order, cliente = null) => {
    const email = (cliente?.email || order?.correo_electronico || '').trim().toLowerCase();
    return email || null;
};

const STATUS_LABELS = {
    pendiente: 'Pendiente',
    aceptada: 'Aprobado',
    enviada: 'En camino',
    entregada: 'Entregado',
    cancelada: 'Cancelado',
    rechazada: 'Rechazado',
};

const STATUS_CLIENT_MESSAGES = {
    pendiente: 'fue recibido y está pendiente de revisión.',
    aceptada: 'fue aprobado y se está preparando.',
    enviada: '¡ya va en camino! Tu pedido fue despachado.',
    entregada: 'fue entregado. ¡Esperamos que disfrutes tu compra!',
    cancelada: 'fue cancelado.',
    rechazada: 'fue rechazado. Contáctanos si necesitas más información.',
};

const emailWrapper = (title, bodyHtml) => `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #eee; padding: 24px; color: #111;">
        <div style="text-align: center; margin-bottom: 20px;">
            <strong style="font-size: 1.25rem; letter-spacing: 2px;">NUBLACK</strong>
        </div>
        <h2 style="color: #000; margin-top: 0;">${title}</h2>
        ${bodyHtml}
        <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">
        <p style="color: #666; font-size: 13px; margin: 0;">
            Atentamente,<br>Equipo NUBLACK<br>
            <a href="${getStoreUrl()}" style="color: #000;">${getStoreUrl()}</a>
        </p>
    </div>
`;

/**
 * Send Welcome Email
 */
export const sendWelcomeEmail = async (userEmail, userName) =>
    safeSendMail({
        to: userEmail,
        subject: '¡Bienvenido a NUBLACK!',
        html: emailWrapper(
            `¡Hola ${userName}!`,
            `<p>Bienvenido a la comunidad <strong>NUBLACK</strong>. Estamos felices de que te hayas unido.</p>
            <p>Ahora puedes acceder a las mejores prendas y accesorios exclusivos desde nuestra plataforma.</p>
            <div style="text-align: center; margin-top: 24px;">
                <a href="${getStoreUrl()}" style="background-color: #000; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold;">Ir a la tienda</a>
            </div>`
        ),
    });

export const sendCheckoutAccountEmail = async (userEmail, userName) =>
    safeSendMail({
        to: userEmail,
        subject: 'Tu cuenta NUBLACK — pedido registrado',
        html: emailWrapper(
            `Hola ${userName}`,
            `<p>Registramos tu pedido y creamos una cuenta en <strong>NUBLACK</strong> con este correo.</p>
            <p>Inicia sesión con la contraseña que elegiste al comprar.</p>
            <div style="text-align: center; margin-top: 24px;">
                <a href="${getStoreUrl()}/login" style="background-color: #000; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold;">Iniciar sesión</a>
            </div>`
        ),
    });

export const sendNewProductNotification = async (emails, product) => {
    if (!emails?.length) return null;
    const productData = product?.toJSON ? product.toJSON() : product;
    const precio = Number(productData.precio) || 0;
    const imagen = resolveAbsoluteImageUrl(productData.imagen);
    const productUrl = `${getStoreUrl()}/?producto=${productData.id_producto}`;

    return safeSendMail({
        bcc: emails,
        subject: `Novedad en NUBLACK: ${productData.nombre}`,
        html: emailWrapper(
            '¡Nuevo lanzamiento!',
            `<p>Tenemos algo nuevo para ti en la tienda:</p>
            <div style="text-align: center; margin: 20px 0;">
                <img src="${imagen}" alt="${productData.nombre}" style="max-width: 100%; max-height: 320px; border-radius: 12px; object-fit: contain;">
            </div>
            <h3 style="margin: 0 0 8px;">${productData.nombre}</h3>
            <p style="color: #555;">${productData.descripcion || ''}</p>
            <p style="font-size: 1.1em; font-weight: bold;">Precio: $${precio.toLocaleString('es-CO')} COP</p>
            <div style="text-align: center; margin-top: 24px;">
                <a href="${productUrl}" style="background-color: #000; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold;">Ver producto</a>
            </div>`
        ),
    });
};

/** Notifica a todos los clientes registrados activos (por lotes). */
export const notifyRegisteredClientsNewProduct = async (product) => {
    if (!isEmailConfigured()) {
        console.warn('[Email] Novedad de producto omitida — correo no configurado.');
        return { sent: 0, skipped: true };
    }

    const clientes = await Usuario.findAll({
        where: { rol: 'cliente', estado: 'activo' },
        attributes: ['email'],
    });
    const emails = [...new Set(clientes.map((c) => c.email).filter(Boolean))];
    if (!emails.length) {
        console.log('[Email] Sin clientes registrados para notificar novedad.');
        return { sent: 0 };
    }

    const BATCH_SIZE = 25;
    let sent = 0;
    for (let i = 0; i < emails.length; i += BATCH_SIZE) {
        const batch = emails.slice(i, i + BATCH_SIZE);
        await sendNewProductNotification(batch, product);
        sent += batch.length;
    }
    console.log(`[Email] Novedad "${product.nombre}" enviada a ${sent} clientes.`);
    return { sent };
};

export const sendOrderStatusEmail = async (userEmail, orderNumber, status, shippingInfo = {}) => {
    if (!userEmail) return null;

    const label = STATUS_LABELS[status] || status;
    const message = STATUS_CLIENT_MESSAGES[status] || `cambió a estado: ${label}.`;

    const trackingBlock = status === 'enviada' && shippingInfo.numero_guia
        ? `<div style="background: #f9f9f9; padding: 16px; border-radius: 8px; margin: 16px 0;">
            <p style="margin: 0 0 8px;"><strong>Información de envío</strong></p>
            <p style="margin: 0 0 4px;">Transportadora: ${shippingInfo.nombre_empaquetadora || 'No especificada'}</p>
            <p style="margin: 0;">Número de guía: <strong>${shippingInfo.numero_guia}</strong></p>
           </div>`
        : '';

    return safeSendMail({
        to: userEmail,
        subject: `Actualización de tu pedido ${orderNumber}`,
        html: emailWrapper(
            'Estado de tu pedido',
            `<p>Hola, tu pedido <strong>${orderNumber}</strong> ${message}</p>
            <p>Estado actual: <strong>${label}</strong></p>
            ${trackingBlock}
            <p>Si tienes alguna duda, responde a este correo.</p>`
        ),
    });
};

export const sendAdminOrderStatusEmail = async (adminEmails, order, previousStatus, newStatus, shippingInfo = {}) => {
    if (!adminEmails?.length) return null;

    const prevLabel = STATUS_LABELS[previousStatus] || previousStatus;
    const newLabel = STATUS_LABELS[newStatus] || newStatus;
    const clienteNombre = order.nombre_cliente || 'Cliente';
    const clienteEmail = order.correo_electronico || '—';

    const trackingBlock = newStatus === 'enviada'
        ? `<p>Guía: <strong>${shippingInfo.numero_guia || order.numero_guia || '—'}</strong><br>
           Transportadora: ${shippingInfo.nombre_empaquetadora || order.nombre_empaquetadora || '—'}</p>`
        : '';

    return safeSendMail({
        to: adminEmails[0],
        bcc: adminEmails.length > 1 ? adminEmails.slice(1) : undefined,
        subject: `[Admin] Pedido ${order.numero_pedido} → ${newLabel}`,
        html: emailWrapper(
            'Cambio de estado del pedido',
            `<p><strong>Pedido:</strong> ${order.numero_pedido}</p>
            <p><strong>Cliente:</strong> ${clienteNombre} (${clienteEmail})</p>
            <p><strong>Estado anterior:</strong> ${prevLabel}<br>
               <strong>Estado nuevo:</strong> ${newLabel}</p>
            <p><strong>Total:</strong> $${Number(order.total || 0).toLocaleString('es-CO')} COP</p>
            ${trackingBlock}`
        ),
    });
};

export const sendAdminNewOrderEmail = async (adminEmails, order) => {
    if (!adminEmails?.length) return null;

    return safeSendMail({
        to: adminEmails[0],
        bcc: adminEmails.length > 1 ? adminEmails.slice(1) : undefined,
        subject: `[Admin] Nuevo pedido ${order.numero_pedido}`,
        html: emailWrapper(
            'Nuevo pedido recibido',
            `<p><strong>Pedido:</strong> ${order.numero_pedido}</p>
            <p><strong>Cliente:</strong> ${order.nombre_cliente || '—'}<br>
               <strong>Correo:</strong> ${order.correo_electronico || '—'}</p>
            <p><strong>Total:</strong> $${Number(order.total || 0).toLocaleString('es-CO')} COP</p>
            <p><strong>Método de pago:</strong> ${order.metodo_pago || '—'}</p>
            <p><strong>Estado:</strong> ${STATUS_LABELS[order.estado] || order.estado}</p>`
        ),
    });
};

/** Cliente + admin cuando cambia el estado del pedido. */
export const notifyOrderStatusChange = async ({
    order,
    previousStatus,
    newStatus,
    shippingInfo = {},
    cliente = null,
}) => {
    if (!isEmailConfigured()) return;

    const customerEmail = resolveCustomerEmail(order, cliente);
    const adminEmails = await getAdminEmails();

    const tasks = [];

    if (customerEmail) {
        tasks.push(
            sendOrderStatusEmail(customerEmail, order.numero_pedido, newStatus, shippingInfo)
                .catch((err) => console.error('[Email] Cliente estado pedido:', err.message))
        );
    } else {
        console.warn(`[Email] Sin correo de cliente para pedido ${order.numero_pedido}`);
    }

    if (adminEmails.length) {
        tasks.push(
            sendAdminOrderStatusEmail(adminEmails, order, previousStatus, newStatus, shippingInfo)
                .catch((err) => console.error('[Email] Admin estado pedido:', err.message))
        );
    }

    await Promise.allSettled(tasks);
};

/** Aviso a admin de pedido nuevo. */
export const notifyAdminNewOrder = async (order) => {
    if (!isEmailConfigured()) return;
    const adminEmails = await getAdminEmails();
    if (!adminEmails.length) return;
    await sendAdminNewOrderEmail(adminEmails, order).catch((err) =>
        console.error('[Email] Admin nuevo pedido:', err.message)
    );
};

export const sendPendingPaymentEmail = async (userEmail, order) => {
    const wompiAmount = resolveWompiChargeAmount(order);
    const envioEfectivo = isMetroPasarelaSplitOrder(order) ? (parseFloat(order.envio) || 0) : 0;
    const paymentLines = envioEfectivo > 0
        ? `<p>Productos (Wompi): <strong>$${Number(wompiAmount).toLocaleString('es-CO')} COP</strong></p>
            <p>Domicilio (efectivo al recibir): <strong>$${Number(envioEfectivo).toLocaleString('es-CO')} COP</strong></p>
            <p>Total del pedido: <strong>$${Number(order.total).toLocaleString('es-CO')} COP</strong></p>`
        : `<p>Total a pagar: <strong>$${Number(wompiAmount).toLocaleString('es-CO')} COP</strong></p>`;

    return safeSendMail({
        to: userEmail,
        subject: `Completa el pago de tu pedido ${order.numero_pedido}`,
        html: emailWrapper(
            'Pedido registrado — pendiente de pago',
            `<p>Tu pedido <strong>${order.numero_pedido}</strong> fue creado correctamente.</p>
            ${paymentLines}
            <p>Tienes <strong>40 minutos</strong> para completar el pago de los productos por pasarela Wompi.</p>
            ${envioEfectivo > 0 ? '<p>El costo de domicilio lo pagarás en efectivo cuando recibas tu pedido.</p>' : ''}
            <p>Si no completas el pago a tiempo, el pedido se cancelará automáticamente.</p>
            <div style="text-align: center; margin-top: 24px;">
                <a href="${getStoreUrl()}/carrito" style="background-color: #000; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold;">Completar pago</a>
            </div>`
        ),
    });
};

export const sendPasswordResetEmail = async (userEmail, code) =>
    safeSendMail({
        to: userEmail,
        subject: 'Recuperar contraseña - NUBLACK',
        html: emailWrapper(
            'Recuperación de contraseña',
            `<p>Usa el siguiente código para restablecer tu contraseña:</p>
            <div style="background-color: #f4f4f4; padding: 20px; font-size: 2em; letter-spacing: 5px; font-weight: bold; text-align: center; margin: 20px 0;">
                ${code}
            </div>
            <p>Este código vence en 1 hora.</p>
            <p>Si no solicitaste este cambio, ignora este correo.</p>`
        ),
    });

export const sendOrderConfirmationEmail = async (userEmail, order) =>
    safeSendMail({
        to: userEmail,
        subject: `¡Confirmación de pedido ${order.numero_pedido}!`,
        html: emailWrapper(
            '¡Gracias por tu compra!',
            `<p>Tu pedido <strong>${order.numero_pedido}</strong> ha sido confirmado.</p>
            <p><strong>Dirección de envío:</strong><br>${order.direccion_envio || '—'}</p>
            <p><strong>Total:</strong> $${Number(order.total).toLocaleString('es-CO')} COP</p>
            <p>Te notificaremos cuando el estado de tu pedido cambie.</p>
            <div style="text-align: center; margin-top: 24px;">
                <a href="${getStoreUrl()}/perfil" style="background-color: #000; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold;">Ver mis pedidos</a>
            </div>`
        ),
    });

/** Cliente + admin cuando se confirma el pago pasarela. */
export const notifyPaymentConfirmed = async (order, cliente = null) => {
    const customerEmail = resolveCustomerEmail(order, cliente);
    if (customerEmail) {
        await sendOrderConfirmationEmail(customerEmail, order).catch((err) =>
            console.error('[Email] Confirmación pago cliente:', err.message)
        );
    }
    const adminEmails = await getAdminEmails();
    if (adminEmails.length) {
        await safeSendMail({
            to: adminEmails[0],
            bcc: adminEmails.length > 1 ? adminEmails.slice(1) : undefined,
            subject: `[Admin] Pago confirmado — ${order.numero_pedido}`,
            html: emailWrapper(
                'Pago confirmado',
                `<p>El pedido <strong>${order.numero_pedido}</strong> fue pagado exitosamente.</p>
                <p><strong>Cliente:</strong> ${order.nombre_cliente || '—'} (${order.correo_electronico || '—'})</p>
                <p><strong>Total:</strong> $${Number(order.total).toLocaleString('es-CO')} COP</p>`
            ),
        }).catch((err) => console.error('[Email] Admin pago confirmado:', err.message));
    }
};
