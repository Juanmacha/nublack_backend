/**
 * Prueba flujo Wompi sandbox contra el servidor local.
 * Uso: node scripts/tools/test_wompi_flow.js
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BASE = process.env.TEST_API_URL || 'http://localhost:3001/api';
const LOGIN_EMAIL = process.env.TEST_LOGIN_EMAIL || 'admin@demo.local.com';
const LOGIN_PASSWORD = process.env.TEST_LOGIN_PASSWORD || 'admin1234';

async function request(method, path, { token, body } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(`${BASE}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined
    });

    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
}

async function run() {
    console.log('=== PRUEBA WOMPI SANDBOX ===\n');
    console.log(`API: ${BASE}\n`);

    // 1. Login
    console.log('1) Login...');
    const login = await request('POST', '/auth/login', {
        body: { email: LOGIN_EMAIL, password: LOGIN_PASSWORD }
    });
    if (login.status !== 200) {
        console.error('   FALLO login:', login.status, login.data);
        process.exit(1);
    }
    const token = login.data?.data?.accessToken;
    console.log('   OK — token obtenido\n');

    // 2. Producto con stock (respetando stock por talla si aplica)
    console.log('2) Buscar producto con stock...');

    const parseTallas = (raw) => {
        if (!raw) return null;
        if (typeof raw === 'string') {
            try { return JSON.parse(raw); } catch { return null; }
        }
        return raw;
    };

    const pickProductWithStock = (productList) => {
        for (const p of productList) {
            const tallasObj = parseTallas(p.tallas);
            const hasTallas = tallasObj && (
                (Array.isArray(tallasObj) && tallasObj.length > 0) ||
                (typeof tallasObj === 'object' && Object.keys(tallasObj).length > 0)
            );

            if (hasTallas) {
                if (Array.isArray(tallasObj)) {
                    const withStock = tallasObj.find((t) => parseInt(t.stock, 10) > 0);
                    if (withStock) {
                        return { product: p, talla: withStock.talla, stock: parseInt(withStock.stock, 10) };
                    }
                } else {
                    const entry = Object.entries(tallasObj).find(([, s]) => parseInt(s, 10) > 0);
                    if (entry) {
                        return { product: p, talla: entry[0], stock: parseInt(entry[1], 10) };
                    }
                }
                continue;
            }

            if (Number(p.stock) > 0) {
                return { product: p, talla: null, stock: Number(p.stock) };
            }
        }
        return null;
    };

    const products = await request('GET', '/products');
    const list = products.data?.data?.productos || (Array.isArray(products.data) ? products.data : []);
    const picked = pickProductWithStock(list);

    if (!picked) {
        console.error('   FALLO — no hay productos con stock disponible (revisa inventario en BD)');
        process.exit(1);
    }

    const { product, talla, stock } = picked;
    console.log(`   OK — producto #${product.id_producto}: ${product.nombre} (stock: ${stock}${talla ? `, talla: ${talla}` : ''})\n`);

    const price = Number(product.precio) || 50000;
    const envio = 15000;
    const total = price + envio;

    // 3. Crear pedido pasarela
    console.log('3) Crear pedido con pasarela...');
    const orderBody = {
        items: [{
            id_producto: product.id_producto,
            nombre: product.nombre,
            cantidad: 1,
            ...(talla ? { talla } : {}),
            precio: price
        }],
        personalInfo: {
            nombre: 'Cliente Prueba Wompi',
            documento: '1234567890',
            telefono: '3001234567',
            email: LOGIN_EMAIL
        },
        deliveryInfo: {
            direccion: 'Calle Prueba 123',
            referencia: 'Test Wompi'
        },
        paymentInfo: { metodo: 'pasarela' },
        totals: { subtotal: price, envio, total }
    };

    const order = await request('POST', '/orders', { token, body: orderBody });
    if (order.status !== 201) {
        console.error('   FALLO crear pedido:', order.status, order.data);
        process.exit(1);
    }

    const { orderId, requiresPayment, checkout: _initialCheckout, estado_pago, pago_expira_at } = order.data;
    console.log('   OK — pedido:', orderId);
    console.log('   requiresPayment:', requiresPayment);
    console.log('   estado_pago:', estado_pago);
    console.log('   expira:', pago_expira_at);

    if (!_initialCheckout?.publicKey || !_initialCheckout?.integritySignature) {
        console.error('   FALLO — respuesta sin checkout completo');
        process.exit(1);
    }
    console.log('   checkout.reference:', _initialCheckout.reference);
    console.log('   checkout.amountInCents:', _initialCheckout.amountInCents);
    console.log('   checkout.publicKey: pub_test_... (OK)\n');

    // 4. Reintentar checkout
    console.log('4) POST /payments/wompi/checkout...');
    const checkoutRetry = await request('POST', '/payments/wompi/checkout', {
        token,
        body: { orderId }
    });
    if (checkoutRetry.status !== 200) {
        console.error('   FALLO:', checkoutRetry.status, checkoutRetry.data);
        process.exit(1);
    }
    const checkout = checkoutRetry.data.checkout;
    console.log('   OK — checkout re-generado');
    console.log('   reference:', checkout.reference);
    console.log('   wompiValidation:', checkoutRetry.data.wompiValidation);
    console.log('   checkoutUrl:', checkout.checkoutUrl?.slice(0, 80) + '...\n');

    // 5. Estado de pago (debe estar pendiente)
    console.log('5) GET /payments/status/:orderId...');
    const status = await request('GET', `/payments/status/${orderId}`, { token });
    if (status.status !== 200) {
        console.error('   FALLO:', status.status, status.data);
        process.exit(1);
    }
    console.log('   estado_pago:', status.data.payment?.estado_pago);
    console.log('   metodo_pago:', status.data.payment?.metodo_pago);

    if (status.data.payment?.estado_pago !== 'pendiente') {
        console.warn('   AVISO — se esperaba pendiente antes de pagar en widget\n');
    } else {
        console.log('   OK — pendiente de pago (correcto)\n');
    }

    // Resumen para pago manual
    console.log('=== BACKEND OK — SIGUIENTE PASO: PAGAR EN WIDGET ===\n');
    console.log('Abre en el navegador:');
    console.log('  http://localhost:3001/test/wompi');
    console.log('\nO pega estos datos en el widget Wompi:');
    console.log(JSON.stringify({
        orderId,
        ...checkout
    }, null, 2));
    console.log('\nTarjetas de prueba: https://docs.wompi.co/docs/colombia/datos-de-prueba-en-sandbox/');

    const sessionFile = path.join(__dirname, 'wompi_test_session.local.json');
    fs.writeFileSync(sessionFile, JSON.stringify({
        apiUrl: BASE,
        orderId,
        token,
        checkout,
        createdAt: new Date().toISOString()
    }, null, 2));
    console.log(`\nSesión guardada en: ${sessionFile}`);
    console.log('Abre: scripts/tools/wompi_test_checkout.html (pega token y orderId, o recarga tras editar el JSON)');
}

run().catch((err) => {
    console.error('Error:', err.message);
    process.exit(1);
});
