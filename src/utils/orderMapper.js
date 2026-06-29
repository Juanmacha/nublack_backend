export const statusMapFEtoBE = {
    aprobada: 'aceptada',
    en_camino: 'enviada',
    entregada: 'entregada',
    cancelada: 'cancelada',
    pendiente: 'pendiente'
};

export const statusMapBEtoFE = {
    aceptada: 'aprobada',
    enviada: 'en_camino',
    entregada: 'entregada',
    cancelada: 'cancelada',
    pendiente: 'pendiente'
};

export const paymentMethodMap = {
    contraEntrega: 'Contra Entrega',
    pasarela: 'Pasarela',
    'Contra Entrega': 'Contra Entrega',
    Pasarela: 'Pasarela'
};

export const isPasarelaPayment = (metodoPago) => metodoPago === 'Pasarela';

export const mapOrder = (order) => {
    const rawOrder = order.toJSON ? order.toJSON() : order;
    return {
        ...rawOrder,
        estado: statusMapBEtoFE[rawOrder.estado] || rawOrder.estado,
        seguimiento: rawOrder.estado === 'enviada' || rawOrder.estado === 'entregada'
            ? {
                numero_guia: rawOrder.numero_guia || null,
                nombre_empaquetadora: rawOrder.nombre_empaquetadora || null,
                fecha_despacho: rawOrder.fecha_despacho || null
            }
            : null
    };
};
