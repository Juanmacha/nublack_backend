const WOMPI_BASE_URLS = {
    sandbox: 'https://sandbox.wompi.co/v1',
    production: 'https://production.wompi.co/v1'
};

const env = (process.env.WOMPI_ENV || 'sandbox').toLowerCase();
const isProduction = env === 'production';

/** Wompi sandbox devuelve 403 si redirect-url es localhost. */
export const resolveRedirectUrl = () => {
    const configured = (process.env.WOMPI_REDIRECT_URL || 'http://localhost:5173/pago/resultado').trim();
    if (!configured) return undefined;

    const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(configured);
    if (!isProduction && isLocalhost) {
        return (process.env.WOMPI_SANDBOX_REDIRECT_URL || 'https://transaction-redirect.wompi.co/check').trim();
    }
    return configured;
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
