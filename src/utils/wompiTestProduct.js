export const WOMPI_TEST_PRODUCT_NAME = '[WOMPI-TEST] Pago $2.000';
export const WOMPI_TEST_PRODUCT_PRICE = 2000;
export const WOMPI_TEST_VARIANTES = { wompiTest: true };

export const isWompiTestProduct = (product) => {
    if (!product) return false;

    let variantes = product.variantes;
    if (typeof variantes === 'string') {
        try { variantes = JSON.parse(variantes); } catch { variantes = null; }
    }
    if (variantes?.wompiTest === true) return true;

    const nombre = String(product.nombre || product.nombre_producto || '').trim();
    return nombre.startsWith('[WOMPI-TEST]');
};

export const isWompiTestOrderItem = (item) => {
    if (!item) return false;
    if (item.wompiTest === true || item.es_wompi_test === true) return true;
    return isWompiTestProduct({
        nombre: item.nombre || item.nombre_producto,
        variantes: item.variantes,
    });
};

export const orderItemsAreWompiTestOnly = (items = []) =>
    Array.isArray(items) && items.length > 0 && items.every(isWompiTestOrderItem);

/** Precio autoritativo: test Wompi siempre usa el constante del servidor. */
export const resolveProductUnitPrice = (producto, fallbackPrice = 0) => {
    if (isWompiTestProduct(producto)) return WOMPI_TEST_PRODUCT_PRICE;
    const parsed = parseFloat(producto?.precio);
    return Number.isFinite(parsed) ? parsed : (parseFloat(fallbackPrice) || 0);
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

export const normalizeWompiTestProductRecord = async (product) => {
    if (!product || !isWompiTestProduct(product)) return product;

    const currentPrice = parseFloat(product.precio);
    const needsUpdate = currentPrice !== WOMPI_TEST_PRODUCT_PRICE
        || product.nombre !== WOMPI_TEST_PRODUCT_NAME;

    if (needsUpdate) {
        await product.update({
            nombre: WOMPI_TEST_PRODUCT_NAME,
            precio: WOMPI_TEST_PRODUCT_PRICE,
            precio_original: WOMPI_TEST_PRODUCT_PRICE,
            variantes: WOMPI_TEST_VARIANTES,
        });
        await product.reload();
    }

    return product;
};
