import crypto from 'crypto';
import { wompiConfig } from '../config/wompi.js';

const isDebug = () => process.env.WOMPI_DEBUG === 'true';

/**
 * Convierte monto en pesos COP a centavos (entero).
 * Evita errores de float con DECIMAL de Sequelize ("104990.00").
 */
export const amountToCents = (amount) => {
    if (amount == null || amount === '') {
        throw new Error('Monto inválido para Wompi');
    }

    const normalized = String(amount).trim().replace(',', '.');
    const match = normalized.match(/^(\d+)(?:\.(\d{1,2}))?$/);

    if (match) {
        const pesos = parseInt(match[1], 10);
        const decimalPart = (match[2] || '').padEnd(2, '0').slice(0, 2);
        const centavos = parseInt(decimalPart, 10);
        const total = pesos * 100 + centavos;
        if (total <= 0) throw new Error('Monto inválido para Wompi');
        return total;
    }

    const numeric = Number(normalized);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        throw new Error('Monto inválido para Wompi');
    }
    return Math.round(numeric * 100);
};

export const buildWompiReference = (numeroPedido) => `NUBLACK-${numeroPedido}`;

/**
 * Firma Wompi: SHA256(reference + amountInCents + currency + integritySecret)
 * Sin separadores. amountInCents debe ser entero en la cadena.
 */
export const buildIntegrityPayload = (reference, amountInCents, currency = 'COP', integritySecret = wompiConfig.integritySecret, expirationTime = null) => {
    const ref = String(reference).trim();
    const cents = Math.trunc(Number(amountInCents));
    const cur = String(currency).trim();
    const secret = String(integritySecret || '').trim();
    const exp = expirationTime ? String(expirationTime).trim() : '';

    if (!ref || !cur || !secret) {
        throw new Error('Datos incompletos para firma de integridad Wompi');
    }
    if (!Number.isFinite(cents) || cents <= 0) {
        throw new Error('amountInCents inválido para firma Wompi');
    }

    const amountString = String(cents);
    const payload = exp
        ? `${ref}${amountString}${cur}${exp}${secret}`
        : `${ref}${amountString}${cur}${secret}`;

    return {
        reference: ref,
        amountInCents: cents,
        amountString,
        currency: cur,
        expirationTime: exp || null,
        payload,
        payloadPreview: exp
            ? `${ref}${amountString}${cur}${exp}***(${secret.length} chars)`
            : `${ref}${amountString}${cur}***(${secret.length} chars)`,
        integritySecretLength: secret.length
    };
};

export const generateIntegritySignature = (reference, amountInCents, currency = 'COP', integritySecret = wompiConfig.integritySecret, expirationTime = null) => {
    const built = buildIntegrityPayload(reference, amountInCents, currency, integritySecret, expirationTime);
    const signature = crypto.createHash('sha256').update(built.payload).digest('hex');

    if (isDebug()) {
        console.log('[Wompi Integrity]', {
            reference: built.reference,
            amountInCents: built.amountInCents,
            currency: built.currency,
            payloadPreview: built.payloadPreview,
            signature,
            integritySecretLength: built.integritySecretLength
        });
    }

    return signature;
};

export const logCheckoutAudit = (label, order, checkout) => {
    if (!isDebug()) return;

    console.log(`[Wompi Checkout Audit] ${label}`, {
        numero_pedido: order.numero_pedido,
        wompi_reference_db: order.wompi_reference,
        total_raw: order.total,
        total_type: typeof order.total,
        checkout_reference: checkout.reference,
        checkout_amountInCents: checkout.amountInCents,
        reference_match: checkout.reference === (order.wompi_reference || buildWompiReference(order.numero_pedido)),
        signature: checkout.integritySignature,
        signature_widget: checkout.signature
    });
};

export const formatWompiExpirationTime = (date) => {
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
};

/** URL de retorno al comercio (botón "Volver al comercio" en el recibo de Wompi). */
export const buildOrderRedirectUrl = (order) => {
    const base = wompiConfig.redirectUrl;
    if (!base || !order?.numero_pedido) return base;

    try {
        const url = new URL(base);
        url.searchParams.set('orderId', String(order.numero_pedido));
        url.searchParams.set('fromWompi', '1');
        return url.toString();
    } catch {
        const separator = base.includes('?') ? '&' : '?';
        return `${base}${separator}orderId=${encodeURIComponent(order.numero_pedido)}`;
    }
};

export const buildCheckoutUrl = (checkout) => {
    const params = new URLSearchParams({
        'public-key': checkout.publicKey,
        currency: checkout.currency,
        'amount-in-cents': String(checkout.amountInCents),
        reference: checkout.reference,
        'signature:integrity': checkout.integritySignature
    });

    if (checkout.redirectUrl) {
        params.set('redirect-url', checkout.redirectUrl);
    }

    return `https://checkout.wompi.co/p/?${params.toString()}`;
};

export const buildCheckoutConfig = (order) => {
    const reference = String(order.wompi_reference || buildWompiReference(order.numero_pedido)).trim();
    const amountInCents = amountToCents(order.total);
    const currency = 'COP';
    // No incluir expiration-time en firma/checkout: Wompi valida distinto en POST /transactions
    // y provoca "signature: La firma es inválida". La expiración la maneja el backend (40 min).
    const integritySignature = generateIntegritySignature(reference, amountInCents, currency);

    const checkout = {
        publicKey: wompiConfig.publicKey,
        currency,
        amountInCents,
        reference,
        integritySignature,
        signature: { integrity: integritySignature },
        redirectUrl: buildOrderRedirectUrl(order),
        customerEmail: order.correo_electronico || undefined
    };

    checkout.checkoutUrl = buildCheckoutUrl(checkout);

    if (isDebug()) {
        const built = buildIntegrityPayload(reference, amountInCents, currency);
        checkout._debug = {
            total_raw: order.total,
            amountString_used_in_payload: built.amountString,
            payloadPreview: built.payloadPreview,
            integritySecretLength: built.integritySecretLength,
            redirectUrl_effective: checkout.redirectUrl,
            redirectUrl_configured: wompiConfig.configuredRedirectUrl,
            note: 'En sandbox, Wompi rechaza redirect-url localhost (403). Se usa URL alternativa.'
        };
    }

    logCheckoutAudit('buildCheckoutConfig', order, checkout);
    return checkout;
};

export const verifyWebhookChecksum = (eventBody, checksumHeader) => {
    const { signature, timestamp } = eventBody || {};
    if (!signature?.properties || !timestamp || !wompiConfig.eventsSecret) {
        return false;
    }

    const values = signature.properties.map((prop) => {
        const parts = prop.split('.');
        let value = eventBody.data;
        for (const part of parts) {
            value = value?.[part];
        }
        return value ?? '';
    });

    const payload = `${values.join('')}${timestamp}${wompiConfig.eventsSecret}`;
    const calculated = crypto.createHash('sha256').update(payload).digest('hex');
    const received = checksumHeader || signature.checksum;

    return calculated === received;
};

export const mapWompiStatusToPaymentStatus = (wompiStatus) => {
    switch (wompiStatus) {
        case 'APPROVED':
            return 'pagado';
        case 'DECLINED':
        case 'VOIDED':
        case 'ERROR':
            return 'fallido';
        default:
            return 'pendiente';
    }
};

/** Prueba checkout web contra Wompi (diagnóstico). GET puede dar 200 aunque la firma falle en pagos reales. */
export const probeWebCheckout = async (reference, amountInCents, currency = 'COP', expirationTime = null) => {
    const signature = generateIntegritySignature(reference, amountInCents, currency, wompiConfig.integritySecret, expirationTime);
    const params = new URLSearchParams({
        'public-key': wompiConfig.publicKey,
        currency,
        'amount-in-cents': String(amountInCents),
        reference,
        'signature:integrity': signature
    });

    const redirectUrl = wompiConfig.redirectUrl;
    if (redirectUrl) {
        params.set('redirect-url', redirectUrl);
    }
    if (expirationTime) {
        params.set('expiration-time', expirationTime);
    }

    const url = `https://checkout.wompi.co/p/?${params.toString()}`;
    const res = await fetch(url, { redirect: 'manual' });

    return {
        status: res.status,
        ok: res.status !== 403,
        reference,
        amountInCents,
        currency,
        signature,
        urlParamsSent: Object.fromEntries(params.entries())
    };
};

const WOMPI_SANDBOX_BASE = 'https://sandbox.wompi.co/v1';

/**
 * Verificación real de firma: tokeniza tarjeta test y POST /transactions.
 * El GET de checkout puede devolver 200 con firma incorrecta; este test no.
 */
export async function verifyIntegrityWithWompiTransaction(reference, amountInCents = 1000000) {
    const publicKey = wompiConfig.publicKey;
    const privateKey = wompiConfig.privateKey;

    if (!publicKey || !privateKey || !wompiConfig.integritySecret) {
        return { ok: false, error: 'Wompi no configurado' };
    }

    const merchantRes = await fetch(`${WOMPI_SANDBOX_BASE}/merchants/${encodeURIComponent(publicKey)}`);
    const merchant = await merchantRes.json();
    if (!merchantRes.ok) {
        return { ok: false, error: 'No se pudo consultar comercio Wompi', status: merchantRes.status };
    }

    const tokenRes = await fetch(`${WOMPI_SANDBOX_BASE}/tokens/cards`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${publicKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            number: '4242424242424242',
            cvc: '123',
            exp_month: '12',
            exp_year: '29',
            card_holder: 'Test Nublack'
        })
    });
    const tokenBody = await tokenRes.json();
    const cardToken = tokenBody.data?.id;
    if (!tokenRes.ok || !cardToken) {
        return { ok: false, error: 'No se pudo tokenizar tarjeta de prueba', status: tokenRes.status };
    }

    const signature = generateIntegritySignature(reference, amountInCents);
    const txRes = await fetch(`${WOMPI_SANDBOX_BASE}/transactions`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${privateKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            acceptance_token: merchant.data.presigned_acceptance.acceptance_token,
            amount_in_cents: amountInCents,
            currency: 'COP',
            customer_email: 'test@nublack.local',
            reference,
            signature,
            payment_method_type: 'CARD',
            payment_method: {
                type: 'CARD',
                token: cardToken,
                installments: 1
            }
        })
    });
    const txBody = await txRes.json();

    if (txBody.error?.messages?.signature) {
        return {
            ok: false,
            signatureInvalid: true,
            status: txRes.status,
            error: 'La firma es inválida — WOMPI_INTEGRITY_SECRET no coincide con pub_test_ en dashboard'
        };
    }

    if (txRes.status === 201 || txBody.data?.id) {
        return { ok: true, status: txRes.status, transactionStatus: txBody.data?.status };
    }

    return {
        ok: false,
        status: txRes.status,
        error: txBody.error?.type || 'Error desconocido en transacción de prueba',
        messages: txBody.error?.messages
    };
}
