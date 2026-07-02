const WOMPI_BASE_URLS = {
    sandbox: 'https://sandbox.wompi.co/v1',
    production: 'https://production.wompi.co/v1'
};

const env = (process.env.WOMPI_ENV || 'sandbox').toLowerCase();
const isProduction = env === 'production';

const DEFAULT_FRONTEND = (process.env.FRONTEND_URL || 'https://nublack12.com').trim().replace(/\/$/, '');

/** Wompi sandbox devuelve 403 si redirect-url es localhost. */
export const resolveRedirectUrl = () => {
    const configured = (process.env.WOMPI_REDIRECT_URL || '').trim();
    const storeRedirect = configured || `${DEFAULT_FRONTEND}/pago/resultado`;

    const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(storeRedirect);
    if (!isProduction && isLocalhost) {
        const sandboxOverride = (process.env.WOMPI_SANDBOX_REDIRECT_URL || '').trim();
        // URL HTTPS del comercio → Wompi muestra "Volver al comercio" tras pagar.
        return sandboxOverride || `${DEFAULT_FRONTEND}/pago/resultado`;
    }
    return storeRedirect;
};

export const wompiConfig = {
    env,
    isProduction,
    baseUrl: WOMPI_BASE_URLS[isProduction ? 'production' : 'sandbox'],
    publicKey: (process.env.WOMPI_PUBLIC_KEY || '').trim(),
    privateKey: (process.env.WOMPI_PRIVATE_KEY || '').trim(),
    integritySecret: (process.env.WOMPI_INTEGRITY_SECRET || '').trim(),
    eventsSecret: (process.env.WOMPI_EVENTS_SECRET || '').trim(),
    redirectUrl: resolveRedirectUrl(),
    configuredRedirectUrl: (process.env.WOMPI_REDIRECT_URL || '').trim(),
    paymentExpiryMinutes: parseInt(process.env.PAYMENT_EXPIRY_MINUTES || '40', 10),
    isConfigured: () => Boolean(
        (process.env.WOMPI_PUBLIC_KEY || '').trim() &&
        (process.env.WOMPI_INTEGRITY_SECRET || '').trim()
    )
};

export default wompiConfig;
