export const WOMPI_TEST_PRODUCT_NAME = '[WOMPI-TEST] Pago $1.000';
export const WOMPI_TEST_PRODUCT_PRICE = 1000;
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
