import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
dotenv.config();

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// Verify connection
transporter.verify((error, success) => {
    if (error) {
        console.error('Email Service Error:', error);
    } else {
        console.log('Email Service is ready to send messages');
    }
});

/**
 * Send Welcome Email
 */
export const sendWelcomeEmail = async (userEmail, userName) => {
    const mailOptions = {
        from: process.env.EMAIL_FROM,
        to: userEmail,
        subject: '¡Bienvenido a NUBLACK!',
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #eee; padding: 20px;">
                <h1 style="color: #000; text-align: center;">¡Hola ${userName}!</h1>
                <p>Bienvenido a la comunidad <strong>NUBLACK</strong>. Estamos felices de que te hayas unido.</p>
                <p>Ahora puedes acceder a las mejores prendas y accesorios exclusivos desde nuestra plataforma.</p>
                <div style="text-align: center; margin-top: 30px;">
                    <a href="http://localhost:5173" style="background-color: #000; color: #fff; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Ir a la Tienda</a>
                </div>
            </div>
        `
    };
    return transporter.sendMail(mailOptions);
};

/**
 * Send New Product Notification (Mass Email)
 */
export const sendNewProductNotification = async (emails, product) => {
    const mailOptions = {
        from: process.env.EMAIL_FROM,
        bcc: emails, // Use BCC for mass send
        subject: `🔥 ¡Novedad en NUBLACK: ${product.nombre}!`,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #eee; padding: 20px;">
                <h2 style="color: #000;">¡Nuevo Lanzamiento!</h2>
                <p>Tenemos algo nuevo para ti en la tienda:</p>
                <div style="text-align: center; margin-bottom: 20px;">
                    <img src="${product.imagen}" alt="${product.nombre}" style="max-width: 100%; border-radius: 10px;">
                </div>
                <h3>${product.nombre}</h3>
                <p>${product.descripcion}</p>
                <p style="font-size: 1.2em; font-weight: bold;">Precio: $${product.precio.toLocaleString()}</p>
                <div style="text-align: center; margin-top: 30px;">
                    <a href="http://localhost:5173/producto/${product.id_producto}" style="background-color: #000; color: #fff; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Ver Producto</a>
                </div>
            </div>
        `
    };
    return transporter.sendMail(mailOptions);
};

/**
 * Send Order Status Update Email
 */
export const sendOrderStatusEmail = async (userEmail, orderNumber, status, shippingInfo = {}) => {
    const statusMessages = {
        'aceptada': 'ha sido aceptado y se está preparando.',
        'enviada': '¡Ya va en camino! Tu pedido ha sido despachado.',
        'entregada': '¡Entregado! Esperamos que disfrutes tu compra.',
        'rechazada': 'ha sido rechazado. Por favor contáctanos para más información.'
    };

    const message = statusMessages[status] || `ha cambiado a estado: ${status}`;

    const trackingBlock = status === 'enviada' && shippingInfo.numero_guia
        ? `
            <hr>
            <p><strong>Información de envío:</strong></p>
            <p>Empaquetadora: ${shippingInfo.nombre_empaquetadora || 'No especificada'}</p>
            <p>Número de guía: <strong>${shippingInfo.numero_guia}</strong></p>
            <p>Puedes hacer seguimiento de tu envío con la transportadora indicada.</p>
        `
        : '';

    const mailOptions = {
        from: process.env.EMAIL_FROM,
        to: userEmail,
        subject: `Actualización de tu pedido ${orderNumber}`,
        html: `
            <div style="font-family: Arial, sans-serif; border: 1px solid #eee; padding: 20px;">
                <h2>Estado de tu pedido</h2>
                <p>Hola, el estado de tu pedido <strong>${orderNumber}</strong> ${message}</p>
                ${trackingBlock}
                <p>Si tienes alguna duda, puedes responder a este correo.</p>
                <p>Atentamente,<br>Equipo NUBLACK</p>
            </div>
        `
    };
    return transporter.sendMail(mailOptions);
};

export const sendPendingPaymentEmail = async (userEmail, order) => {
    const mailOptions = {
        from: process.env.EMAIL_FROM,
        to: userEmail,
        subject: `Completa el pago de tu pedido ${order.numero_pedido}`,
        html: `
            <div style="font-family: Arial, sans-serif; border: 1px solid #eee; padding: 20px;">
                <h2>Pedido registrado — pendiente de pago</h2>
                <p>Tu pedido <strong>${order.numero_pedido}</strong> fue creado correctamente.</p>
                <p>Total a pagar: <strong>$${Number(order.total).toLocaleString()} COP</strong></p>
                <p>Tienes <strong>40 minutos</strong> para completar el pago por pasarela Wompi.</p>
                <p>Si no completas el pago a tiempo, el pedido se cancelará automáticamente.</p>
                <p>Atentamente,<br>Equipo NUBLACK</p>
            </div>
        `
    };
    return transporter.sendMail(mailOptions);
};

/**
 * Send Password Reset Code
 */
export const sendPasswordResetEmail = async (userEmail, code) => {
    const mailOptions = {
        from: process.env.EMAIL_FROM,
        to: userEmail,
        subject: 'Recuperar contraseña - NUBLACK',
        html: `
            <div style="font-family: Arial, sans-serif; border: 1px solid #eee; padding: 20px; text-align: center;">
                <h2>Recuperación de Contraseña</h2>
                <p>Has solicitado restablecer tu contraseña. Usa el siguiente código para completar el proceso:</p>
                <div style="background-color: #f4f4f4; padding: 20px; font-size: 2em; letter-spacing: 5px; font-weight: bold; margin: 20px 0;">
                    ${code}
                </div>
                <p>Este código vencerá en 1 hora.</p>
                <p>Si no solicitaste este cambio, puedes ignorar este correo.</p>
            </div>
        `
    };
    return transporter.sendMail(mailOptions);
};

/**
 * Send Order Confirmation Email
 */
export const sendOrderConfirmationEmail = async (userEmail, order) => {
    const mailOptions = {
        from: process.env.EMAIL_FROM,
        to: userEmail,
        subject: `¡Confirmación de Pedido ${order.numero_pedido}!`,
        html: `
            <div style="font-family: Arial, sans-serif; border: 1px solid #eee; padding: 20px;">
                <h2 style="color: #28a745;">¡Gracias por tu compra!</h2>
                <p>Tu pedido <strong>${order.numero_pedido}</strong> ha sido recibido con éxito.</p>
                <hr>
                <p><strong>Detalles del Envío:</strong></p>
                <p>${order.direccion_envio}</p>
                <p><strong>Total:</strong> $${order.total.toLocaleString()}</p>
                <br>
                <p>Te notificaremos cuando el estado de tu pedido cambie.</p>
                <p>Atentamente,<br>Equipo NUBLACK</p>
            </div>
        `
    };
    return transporter.sendMail(mailOptions);
};
