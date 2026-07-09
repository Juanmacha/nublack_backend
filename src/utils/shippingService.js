/** Área metropolitana: Bello, Medellín, Itagüí, Envigado, Sabaneta, La Estrella */

const METRO_MUNICIPALITIES = new Set([    'bello',
    'medellin',
    'medellín',
    'itagui',
    'itagüí',
    'envigado',
    'sabaneta',
    'la estrella',
    'estrella',
]);

export const METRO_SHIPPING_COST = 15000;
export const FREE_SHIPPING_MIN_SUBTOTAL = 299900;

export const SHIPPING_CARRIERS = [
    { id: 'servientrega', name: 'Servientrega', cost: 18000 },
    { id: 'interrapidisimo', name: 'Interrapidísimo', cost: 16000 },
    { id: 'coordinadora', name: 'Coordinadora', cost: 17000 },
];

const normalizeCity = (value) =>
    String(value || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

export const isMetroArea = (ciudad) => METRO_MUNICIPALITIES.has(normalizeCity(ciudad));

export const qualifiesForFreeShipping = (subtotal) =>
    (parseFloat(subtotal) || 0) >= FREE_SHIPPING_MIN_SUBTOTAL;

export const getCarrierById = (carrierId) =>
    SHIPPING_CARRIERS.find((c) => c.id === carrierId) || null;

export const calculateShipping = ({ subtotal = 0, ciudad, transportadora } = {}) => {
    if (qualifiesForFreeShipping(subtotal)) {
        return {
            envio: 0,
            tipo: 'gratis',
            transportadora: 'Envío gratis (compra ≥ $299.900)',
            requiresCarrier: false,
        };
    }

    const city = String(ciudad || '').trim();
    if (!city) {
        return { envio: 0, tipo: null, transportadora: null, requiresCarrier: false, error: 'CIUDAD_REQUIRED' };
    }

    if (isMetroArea(city)) {
        return {
            envio: METRO_SHIPPING_COST,
            tipo: 'metro',
            transportadora: 'Domicilio Nublack (Área Metropolitana)',
            requiresCarrier: false,
        };
    }

    const carrier = getCarrierById(transportadora);
    if (!carrier) {
        return {
            envio: null,
            tipo: 'transportadora',
            transportadora: null,
            requiresCarrier: true,
            error: 'CARRIER_REQUIRED',
        };
    }

    return {
        envio: carrier.cost,
        tipo: 'transportadora',
        transportadora: carrier.name,
        requiresCarrier: false,
    };
};

export const resolveOrderShipping = (deliveryInfo = {}, totals = {}) => {
    const subtotal = parseFloat(totals.subtotal) || 0;

    const shipping = calculateShipping({
        subtotal,
        ciudad: deliveryInfo.ciudad,
        transportadora: deliveryInfo.transportadora,
    });

    if (shipping.error === 'CIUDAD_REQUIRED') {
        const err = new Error('La ciudad de entrega es obligatoria.');
        err.code = 'MISSING_CITY';
        throw err;
    }

    if (shipping.requiresCarrier) {
        const err = new Error('Selecciona una transportadora para envíos fuera del área metropolitana.');
        err.code = 'CARRIER_REQUIRED';
        throw err;
    }

    const clientEnvio = parseFloat(totals.envio);
    const envio = shipping.envio;
    const total = subtotal + envio;

    if (Number.isFinite(clientEnvio) && Math.abs(clientEnvio - envio) > 1) {
        const err = new Error('El costo de envío no coincide. Actualiza la dirección e intenta de nuevo.');
        err.code = 'SHIPPING_MISMATCH';
        throw err;
    }

    return {
        envio,
        subtotal,
        total,
        tipoEnvio: shipping.tipo,
        transportadora: shipping.transportadora,
    };
};
