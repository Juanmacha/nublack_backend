/** Precio unitario autoritativo desde la base de datos al crear pedidos. */
export const resolveProductUnitPrice = (producto, fallbackPrice = 0) => {
    const parsed = parseFloat(producto?.precio);
    if (Number.isFinite(parsed)) return parsed;
    return parseFloat(fallbackPrice) || 0;
};

export const computeServerOrderSubtotal = (items = [], productosById = new Map()) => {
    let subtotal = 0;
    for (const item of items) {
        const prodId = item?.id_producto || item?.id;
        const producto = productosById.get(Number(prodId)) ?? productosById.get(String(prodId));
        const qty = parseInt(item?.cantidad || item?.quantity || 1, 10) || 1;
        const unitPrice = resolveProductUnitPrice(producto, item?.precio);
        subtotal += unitPrice * qty;
    }
    return subtotal;
};
