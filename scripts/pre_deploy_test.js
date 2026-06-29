/**
 * Suite de pruebas antes de subir la API al entorno de desarrollo/producción.
 *
 * Uso:
 *   npm run test              → env + BD + Wompi + API (si el servidor responde)
 *   npm run test -- --skip-api  → solo checks offline (sin servidor)
 *   npm run test -- --require-api → falla si la API no está levantada
 *
 * Variables opcionales:
 *   TEST_API_URL=http://localhost:3001/api
 *   TEST_LOGIN_EMAIL=admin@demo.local.com
 *   TEST_LOGIN_PASSWORD=admin1234
 */
import dotenv from 'dotenv';
dotenv.config();

const args = process.argv.slice(2);
const skipApi = args.includes('--skip-api');
const requireApi = args.includes('--require-api');

const BASE = (process.env.TEST_API_URL || 'http://localhost:3001/api').replace(/\/$/, '');
const LOGIN_EMAIL = process.env.TEST_LOGIN_EMAIL || 'admin@demo.local.com';
const LOGIN_PASSWORD = process.env.TEST_LOGIN_PASSWORD || 'admin1234';

const REQUIRED_ENV = ['DB_NAME', 'DB_USER', 'DB_PASS', 'DB_HOST', 'JWT_SECRET'];
const WOMPI_ENV = ['WOMPI_PUBLIC_KEY', 'WOMPI_PRIVATE_KEY', 'WOMPI_INTEGRITY_SECRET'];
const SHIPPING_COLUMNS = [
    'estado_pago',
    'wompi_transaction_id',
    'wompi_reference',
    'pago_expira_at',
    'numero_guia',
    'nombre_empaquetadora',
    'fecha_despacho'
];

const results = [];

function record(name, ok, detail = '') {
    results.push({ name, ok, detail });
    const icon = ok ? '✅' : '❌';
    console.log(`${icon} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function checkEnv() {
    console.log('\n── 1) Variables de entorno ──');
    let ok = true;

    for (const key of REQUIRED_ENV) {
        const present = Boolean((process.env[key] || '').trim());
        if (!present) {
            record(`ENV ${key}`, false, 'falta o vacía');
            ok = false;
        }
    }
    if (ok) record('ENV base (DB + JWT)', true);

    let wompiOk = true;
    for (const key of WOMPI_ENV) {
        if (!(process.env[key] || '').trim()) {
            record(`ENV ${key}`, false, 'requerida para pasarela');
            wompiOk = false;
        }
    }
    if (wompiOk) record('ENV Wompi', true, process.env.WOMPI_ENV || 'sandbox');

    if (!(process.env.CORS_ORIGIN || '').trim()) {
        record('ENV CORS_ORIGIN', false, 'recomendado para frontend');
    } else {
        record('ENV CORS_ORIGIN', true, process.env.CORS_ORIGIN.split(',')[0].trim());
    }

    return ok && wompiOk;
}

async function checkDatabase() {
    console.log('\n── 2) Base de datos ──');
    const sequelize = (await import('../src/config/database.js')).default;

    try {
        await sequelize.authenticate();
        record('Conexión MySQL', true);
    } catch (err) {
        record('Conexión MySQL', false, err.message);
        return false;
    }

    let schemaOk = true;
    for (const col of SHIPPING_COLUMNS) {
        const [rows] = await sequelize.query(`SHOW COLUMNS FROM solicitudes LIKE '${col}';`);
        if (!rows?.length) {
            record(`Columna solicitudes.${col}`, false, 'ejecuta npm run migrate:wompi');
            schemaOk = false;
        }
    }
    if (schemaOk) record('Esquema Wompi/envío', true, `${SHIPPING_COLUMNS.length} columnas`);

    try {
        const { Usuario, Producto } = await import('../src/models/index.js');
        const admins = await Usuario.count({ where: { rol: 'administrador' } });
        const products = await Producto.count();
        record('Datos mínimos', admins > 0 && products > 0, `${admins} admin(s), ${products} producto(s)`);
        if (admins === 0 || products === 0) schemaOk = false;
    } catch (err) {
        record('Datos mínimos', false, err.message);
        schemaOk = false;
    }

    await sequelize.close();
    return schemaOk;
}

async function checkWompi() {
    console.log('\n── 3) Wompi (firma e integración) ──');
    const { wompiConfig } = await import('../src/config/wompi.js');
    const { verifyIntegrityWithWompiTransaction } = await import('../src/services/wompiService.js');

    if (!wompiConfig.isConfigured()) {
        record('Wompi configurado', false);
        return false;
    }

    const merchantUrl = `${wompiConfig.baseUrl}/merchants/${encodeURIComponent(wompiConfig.publicKey)}`;
    try {
        const mRes = await fetch(merchantUrl);
        record('Merchant API', mRes.ok, `HTTP ${mRes.status}`);
        if (!mRes.ok) return false;
    } catch (err) {
        record('Merchant API', false, err.message);
        return false;
    }

    const txVerify = await verifyIntegrityWithWompiTransaction(`PRE-DEPLOY-${Date.now()}`, 1000000);
    if (txVerify.ok) {
        record('Firma integridad (POST tx 4242)', true, txVerify.transactionStatus || 'OK');
        return true;
    }

    if (txVerify.signatureInvalid) {
        record('Firma integridad', false, 'WOMPI_INTEGRITY_SECRET incorrecto — npm run diagnose:wompi');
    } else {
        record('Firma integridad', false, txVerify.error || JSON.stringify(txVerify.messages));
    }
    return false;
}

async function apiRequest(method, path, { token, body } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${BASE}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15000)
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
}

async function isApiReachable() {
    try {
        const res = await fetch(`${BASE}/products`, { signal: AbortSignal.timeout(3000) });
        return res.status < 500;
    } catch {
        return false;
    }
}

async function checkApi() {
    console.log('\n── 4) API en vivo ──');
    console.log(`   URL: ${BASE}`);

    const reachable = await isApiReachable();
    if (!reachable) {
        if (requireApi) {
            record('Servidor API', false, 'no responde — ejecuta npm run dev');
            return false;
        }
        record('Servidor API', true, 'omitido (no está levantado). Usa --require-api para exigirlo');
        return true;
    }
    record('Servidor API', true, 'responde');

    let ok = true;

    const login = await apiRequest('POST', '/auth/login', {
        body: { email: LOGIN_EMAIL, password: LOGIN_PASSWORD }
    });
    if (login.status !== 200 || !login.data?.data?.accessToken) {
        record('POST /auth/login', false, `${login.status}`);
        return false;
    }
    const token = login.data.data.accessToken;
    record('POST /auth/login', true);

    const products = await apiRequest('GET', '/products');
    const list = products.data?.data?.productos || (Array.isArray(products.data) ? products.data : []);
    if (products.status !== 200 || !list.length) {
        record('GET /products', false, 'sin productos');
        ok = false;
    } else {
        record('GET /products', true, `${list.length} producto(s)`);
    }

    const invalidPay = await apiRequest('POST', '/orders', {
        token,
        body: {
            items: [{ id_producto: 1, nombre: 'Test', cantidad: 1, precio: 1000 }],
            personalInfo: { nombre: 'T', documento: '1', telefono: '300', email: LOGIN_EMAIL },
            deliveryInfo: { direccion: 'Calle 1' },
            paymentInfo: { metodo: 'transferencia' },
            totals: { subtotal: 1000, envio: 0, total: 1000 }
        }
    });
    if (invalidPay.status === 400 && invalidPay.data?.code === 'INVALID_PAYMENT_METHOD') {
        record('Rechazo transferencia', true);
    } else {
        record('Rechazo transferencia', false, `esperado 400 INVALID_PAYMENT_METHOD, got ${invalidPay.status}`);
        ok = false;
    }

    const picked = pickProductWithStock(list);
    if (!picked) {
        record('Flujo pasarela', false, 'sin stock para pedido de prueba');
        return ok;
    }

    const { product, talla } = picked;
    const price = Number(product.precio) || 50000;
    const envio = 15000;
    const total = price + envio;

    const order = await apiRequest('POST', '/orders', {
        token,
        body: {
            items: [{
                id_producto: product.id_producto,
                nombre: product.nombre,
                cantidad: 1,
                ...(talla ? { talla } : {}),
                precio: price
            }],
            personalInfo: {
                nombre: 'Pre-deploy Test',
                documento: '1234567890',
                telefono: '3001234567',
                email: LOGIN_EMAIL
            },
            deliveryInfo: { direccion: 'Calle Test 1', referencia: 'pre-deploy' },
            paymentInfo: { metodo: 'pasarela' },
            totals: { subtotal: price, envio, total }
        }
    });
    if (order.status !== 201) {
        record('POST /orders (pasarela)', false, `${order.status}`);
        return false;
    }
    const { orderId } = order.data;
    record('POST /orders (pasarela)', true, orderId);

    const checkout = await apiRequest('POST', '/payments/wompi/checkout', {
        token,
        body: { orderId }
    });
    if (checkout.status !== 200 || !checkout.data?.checkout?.checkoutUrl) {
        record('POST /payments/wompi/checkout', false, checkout.data?.code || checkout.status);
        ok = false;
    } else {
        const valid = checkout.data.wompiValidation?.ok !== false;
        record('POST /payments/wompi/checkout', valid, checkout.data.checkout.reference?.slice(0, 40) + '...');
        if (!valid) ok = false;
    }

    const status = await apiRequest('GET', `/payments/status/${orderId}`, { token });
    if (status.status === 200 && status.data?.payment?.estado_pago === 'pendiente') {
        record('GET /payments/status', true, 'pendiente');
    } else {
        record('GET /payments/status', false, status.data?.payment?.estado_pago || status.status);
        ok = false;
    }

    const adminOrders = await apiRequest('GET', '/orders/all', { token });
    const target = adminOrders.data?.find?.((o) => o.numero_pedido === orderId)
        || adminOrders.data?.find?.((o) => o.orderId === orderId);
    const idSolicitud = target?.id_solicitud || target?.id;

    if (idSolicitud) {
        const noGuia = await apiRequest('PUT', `/orders/${idSolicitud}/status`, {
            token,
            body: { estado: 'en_camino', numero_guia: 'ab', nombre_empaquetadora: 'X' }
        });
        if (noGuia.status === 400 && noGuia.data?.code === 'MISSING_NUMERO_GUIA') {
            record('Validación guía (en_camino)', true);
        } else {
            record('Validación guía (en_camino)', false, noGuia.data?.code || noGuia.status);
            ok = false;
        }

        const noPayApprove = await apiRequest('PUT', `/orders/${idSolicitud}/status`, {
            token,
            body: { estado: 'aprobada' }
        });
        if (noPayApprove.status === 400 && noPayApprove.data?.code === 'PAYMENT_NOT_CONFIRMED') {
            record('Bloqueo aprobar sin pago', true);
        } else {
            record('Bloqueo aprobar sin pago', false, noPayApprove.data?.code || noPayApprove.status);
            ok = false;
        }
    } else {
        record('Validaciones admin envío/pago', false, 'no se encontró id_solicitud del pedido de prueba');
        ok = false;
    }

    return ok;
}

function parseTallas(raw) {
    if (!raw) return null;
    if (typeof raw === 'string') {
        try { return JSON.parse(raw); } catch { return null; }
    }
    return raw;
}

function pickProductWithStock(productList) {
    for (const p of productList) {
        const tallasObj = parseTallas(p.tallas);
        const hasTallas = tallasObj && (
            (Array.isArray(tallasObj) && tallasObj.length > 0) ||
            (typeof tallasObj === 'object' && Object.keys(tallasObj).length > 0)
        );

        if (hasTallas) {
            if (Array.isArray(tallasObj)) {
                const withStock = tallasObj.find((t) => parseInt(t.stock, 10) > 0);
                if (withStock) return { product: p, talla: withStock.talla };
            } else {
                const entry = Object.entries(tallasObj).find(([, s]) => parseInt(s, 10) > 0);
                if (entry) return { product: p, talla: entry[0] };
            }
            continue;
        }
        if (Number(p.stock) > 0) return { product: p, talla: null };
    }
    return null;
}

async function main() {
    console.log('=== NUBLACK — Pre-deploy test suite ===');
    console.log(`Fecha: ${new Date().toISOString()}`);

    const envOk = await checkEnv();
    const dbOk = envOk ? await checkDatabase() : false;
    const wompiOk = envOk ? await checkWompi() : false;
    let apiOk = true;
    if (!skipApi && envOk) {
        apiOk = await checkApi();
    } else if (skipApi) {
        console.log('\n── 4) API en vivo ──');
        record('Servidor API', true, 'omitido (--skip-api)');
    }

    const failed = results.filter((r) => !r.ok);
    console.log('\n' + '='.repeat(50));
    if (failed.length === 0) {
        console.log('✅ TODO OK — listo para subir al entorno de desarrollo');
        console.log('\nOpcional: pago manual en http://localhost:3001/test/wompi');
        console.log('  (node scripts/tools/test_wompi_flow.js genera la sesión)');
        process.exit(0);
    }

    console.log(`❌ ${failed.length} check(s) fallaron:`);
    failed.forEach((f) => console.log(`   • ${f.name}${f.detail ? `: ${f.detail}` : ''}`));
    console.log('\nAyuda: npm run diagnose:wompi | npm run migrate:wompi | npm run dev');
    process.exit(1);
}

main().catch((err) => {
    console.error('\nError fatal:', err.message);
    process.exit(1);
});
