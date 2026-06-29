# Integración Frontend — Wompi y Seguimiento de Envíos

Guía para conectar el frontend NUBLACK con el backend.

**Base URL API (dev):** `http://localhost:3001/api`  
**Base URL API (prod):** `https://tu-backend.com/api`

> **Herramienta de prueba backend (se mantiene):**  
> `http://localhost:3001/test/wompi` — HTML en `scripts/tools/wompi_test_checkout.html`  
> Solo desarrollo (`NODE_ENV !== 'production'`). No reemplaza el frontend real; sirve para probar Wompi sin Vue/React.  
> Generar sesión: `node scripts/tools/test_wompi_flow.js`

---

## Resumen

| Área | Qué hacer en frontend |
|------|------------------------|
| Pagos | Solo **contra entrega** y **pasarela Wompi**. Quitar transferencia/tarjeta/PSE directos |
| Pasarela | Crear pedido → **siempre** llamar checkout → abrir `checkoutUrl` |
| Expiración | Pedidos pasarela sin pagar expiran a **40 min** (`pago_expira_at`) |
| Envío admin | Al marcar **en camino** → obligatorio guía + empaquetadora |
| Cliente | Mostrar bloque `seguimiento` cuando no sea `null` |

---

## Autenticación

Todos los endpoints (salvo webhook) requieren:

```
Authorization: Bearer {accessToken}
```

Token obtenido de `POST /api/auth/login`.

---

# PARTE A — Pasarela Wompi

## A.1 Métodos de pago en checkout

### Enviar en `paymentInfo.metodo`

| Valor | Descripción |
|-------|-------------|
| `contraEntrega` | Pago al recibir |
| `pasarela` | Wompi (tarjeta, PSE, Nequi, etc.) |

### Rechazados (400 `INVALID_PAYMENT_METHOD`)

`transferencia`, `tarjeta`, `PSE`

---

## A.2 Flujo completo pasarela (orden correcto)

```
1. POST /api/orders          → crea pedido (estado_pago: pendiente)
2. POST /api/payments/wompi/checkout  → obtiene checkout FRESCO (referencia nueva)
3. window.location.href = checkout.checkoutUrl   → usuario paga en Wompi
4. Redirect a /pago/resultado?id=... (Wompi)
5. GET /api/payments/status/:orderId  → polling hasta estado_pago: pagado
```

> **Crítico:** No reutilices el `checkout` del paso 1 para pagar.  
> Cada llamada a `/payments/wompi/checkout` genera **referencia y firma nuevas**.  
> Si el usuario cierra Wompi y reintenta → vuelve a llamar el paso 2.

### Recomendado: Web Checkout (redirect)

Usar **`checkout.checkoutUrl`** (URL firmada). Es más estable que el widget embebido.

```javascript
// Tras crear pedido o al pulsar "Pagar"
const res = await fetch(`${API}/payments/wompi/checkout`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`
  },
  body: JSON.stringify({ orderId: numeroPedido })
});
const { checkout, wompiValidation } = await res.json();

if (!res.ok) throw new Error(data.message);

// Opcional en dev: wompiValidation.ok debe ser true
window.location.href = checkout.checkoutUrl;
```

### Alternativa: WidgetCheckout (API JS)

Solo si necesitas modal embebido. Cargar `https://checkout.wompi.co/widget.js` y usar:

```javascript
const checkout = new WidgetCheckout({
  currency: data.checkout.currency,
  amountInCents: data.checkout.amountInCents,
  reference: data.checkout.reference,
  publicKey: data.checkout.publicKey,
  signature: data.checkout.signature, // { integrity: '...' }
  redirectUrl: data.checkout.redirectUrl,
  customerData: data.checkout.customerEmail
    ? { email: data.checkout.customerEmail }
    : undefined
});
checkout.open((result) => { /* consultar status */ });
```

---

## A.3 Crear pedido pasarela

`POST /api/orders`

```json
{
  "items": [
    { "id_producto": 1, "nombre": "Camiseta", "cantidad": 1, "talla": "L", "precio": 89990 }
  ],
  "personalInfo": {
    "nombre": "Juan Pérez",
    "documento": "1234567890",
    "telefono": "3001234567",
    "email": "juan@email.com"
  },
  "deliveryInfo": {
    "direccion": "Calle 123 #45-67",
    "referencia": "Edificio azul"
  },
  "paymentInfo": { "metodo": "pasarela" },
  "totals": { "subtotal": 89990, "envio": 15000, "total": 104990 }
}
```

**Response 201 (campos relevantes):**

```json
{
  "success": true,
  "orderId": "ORD-1730123456789-456",
  "requiresPayment": true,
  "estado_pago": "pendiente",
  "pago_expira_at": "2026-06-29T15:40:00.000Z",
  "checkout": { "...": "informativo — volver a pedir en /payments/wompi/checkout" }
}
```

---

## A.4 Obtener checkout para pagar

`POST /api/payments/wompi/checkout`

```json
{ "orderId": "ORD-1730123456789-456" }
```

**Response 200:**

```json
{
  "success": true,
  "orderId": "ORD-1730123456789-456",
  "estado_pago": "pendiente",
  "pago_expira_at": "2026-06-29T15:40:00.000Z",
  "checkout": {
    "publicKey": "pub_test_...",
    "currency": "COP",
    "amountInCents": 10499000,
    "reference": "NUBLACK-ORD-1730123456789-456-1730123456790",
    "integritySignature": "abc123...",
    "signature": { "integrity": "abc123..." },
    "redirectUrl": "https://transaction-redirect.wompi.co/check",
    "customerEmail": "juan@email.com",
    "checkoutUrl": "https://checkout.wompi.co/p/?public-key=...&signature%3Aintegrity=..."
  },
  "wompiValidation": { "ok": true, "status": 201, "transactionStatus": "PENDING" }
}
```

| Campo | Uso |
|-------|-----|
| `amountInCents` | Total en centavos. $104.990 → `10499000` |
| `checkoutUrl` | **Abrir esta URL** para pagar (recomendado) |
| `reference` | Cambia en cada llamada — no cachear |

**Errores checkout:**

| code | HTTP | Acción UI |
|------|------|-----------|
| `PAYMENT_EXPIRED` | 400 | "Tiempo agotado" — pedido cancelado |
| `ALREADY_PAID` | 400 | Mostrar confirmación |
| `ORDER_EXPIRED` | 400 | Pedido cancelado/expirado |
| `WOMPI_SIGNATURE_INVALID` | 503 | Error servidor — contactar admin |
| `WOMPI_NOT_CONFIGURED` | 503 | Pasarela no disponible |

---

## A.5 Página resultado de pago

Ruta frontend sugerida: **`/pago/resultado`**

En `.env` backend: `WOMPI_REDIRECT_URL=https://nublack12.com/pago/resultado`  
En sandbox con localhost, el backend usa redirect de prueba Wompi automáticamente.

Wompi redirige con query param `?id={transaction_id}`. El frontend debe:

1. Leer `orderId` guardado en `sessionStorage` antes de ir a Wompi
2. Consultar estado del **pedido** (no solo el id de transacción Wompi)

`GET /api/payments/status/:orderId`

```javascript
async function pollPaymentStatus(orderId, token, maxAttempts = 10) {
  for (let i = 0; i < maxAttempts; i++) {
    const res = await fetch(`${API}/payments/status/${orderId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    const ep = data.payment?.estado_pago;
    if (ep === 'pagado') return { ok: true, data };
    if (ep === 'fallido' || ep === 'expirado') return { ok: false, data };
    await new Promise(r => setTimeout(r, 3000));
  }
  return { ok: false, pending: true };
}
```

**Response ejemplo (`pagado`):**

```json
{
  "success": true,
  "order": {
    "numero_pedido": "ORD-...",
    "estado": "pendiente",
    "estado_pago": "pagado",
    "metodo_pago": "Pasarela",
    "seguimiento": null
  },
  "payment": {
    "estado_pago": "pagado",
    "wompi_transaction_id": "12127263-...",
    "wompi_payment_method_type": "CARD",
    "fecha_pago": "2026-06-29T16:21:25.000Z"
  }
}
```

### Badges `estado_pago`

| Valor | UI |
|-------|-----|
| `no_aplica` | Contra entrega — ocultar badge pago |
| `pendiente` | "Pendiente de pago" + countdown hasta `pago_expira_at` |
| `pagado` | "Pagado ✓" |
| `fallido` | "Pago rechazado" |
| `expirado` | "Tiempo agotado" |

---

## A.6 Contra entrega (sin Wompi)

`POST /api/orders` con `"paymentInfo": { "metodo": "contraEntrega" }`

```json
{
  "requiresPayment": false,
  "estado_pago": "no_aplica"
}
```

Flujo termina ahí — email de confirmación automático.

---

# PARTE B — Seguimiento de envío (en camino)

## B.1 Vista cliente

### Listar pedidos

`GET /api/orders/my-orders`

### Detalle

`GET /api/orders/:id` — `:id` = `numero_pedido` **o** `id_solicitud`

Cuando el pedido está **en camino** o **entregado**, viene `seguimiento`:

```json
{
  "numero_pedido": "ORD-...",
  "estado": "en_camino",
  "estado_pago": "pagado",
  "seguimiento": {
    "numero_guia": "9876543210",
    "nombre_empaquetadora": "Servientrega",
    "fecha_despacho": "2026-07-01T10:00:00.000Z"
  }
}
```

Si `seguimiento === null` → no mostrar bloque de envío.

```jsx
{order.seguimiento && (
  <section>
    <h3>Seguimiento de envío</h3>
    <p>Transportadora: {order.seguimiento.nombre_empaquetadora}</p>
    <p>Guía: {order.seguimiento.numero_guia}</p>
    <p>Despachado: {formatDate(order.seguimiento.fecha_despacho)}</p>
  </section>
)}
```

---

## B.2 Panel admin — marcar en camino

`PUT /api/orders/:id/status`  
**Requiere:** token admin (`isAdmin`)

> **`:id` = `id_solicitud` (numérico)** del listado admin, no `numero_pedido`.  
> Ejemplo: `PUT /api/orders/12/status`

### Request

```json
{
  "estado": "en_camino",
  "numero_guia": "9876543210",
  "nombre_empaquetadora": "Servientrega"
}
```

| Campo | Regla |
|-------|-------|
| `numero_guia` | Obligatorio, mínimo 3 caracteres |
| `nombre_empaquetadora` | Obligatorio, mínimo 2 caracteres (texto libre) |

### Response 200

```json
{
  "success": true,
  "message": "Estado del pedido actualizado",
  "nuevoEstado": "en_camino",
  "numero_guia": "9876543210",
  "nombre_empaquetadora": "Servientrega",
  "fecha_despacho": "2026-07-01T10:00:00.000Z"
}
```

### Errores

| code | Cuándo |
|------|--------|
| `MISSING_NUMERO_GUIA` | Guía vacía o < 3 chars |
| `MISSING_EMPAQUETADORA` | Empaquetadora vacía o < 2 chars |
| `PAYMENT_NOT_CONFIRMED` | Intentar `aprobada` en pasarela sin `estado_pago: pagado` |

### Otros estados admin

```json
{ "estado": "aprobada" }
```

```json
{ "estado": "entregada" }
```

```json
{ "estado": "cancelada", "motivo_rechazo": "Sin stock" }
```

### Flujo admin sugerido (pasarela)

```
pendiente + estado_pago: pagado  →  aprobada  →  en_camino (+ guía)  →  entregada
```

No se puede `aprobada` si pasarela y `estado_pago !== 'pagado'`.

### Listar todos (admin)

`GET /api/orders/all` — incluye `id_solicitud`, `numero_pedido`, `estado_pago`, etc.

---

## B.3 UI admin — modal en camino

```
┌──────────────────────────────────┐
│  Despachar pedido #ORD-...         │
│                                  │
│  Número de guía *                │
│  [________________________]      │
│                                  │
│  Empaquetadora *                 │
│  [________________________]      │
│  Ej: Servientrega, Interrapidísimo│
│                                  │
│  [Cancelar]  [Confirmar envío]   │
└──────────────────────────────────┘
```

Al confirmar:

```javascript
await fetch(`${API}/orders/${order.id_solicitud}/status`, {
  method: 'PUT',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${adminToken}`
  },
  body: JSON.stringify({
    estado: 'en_camino',
    numero_guia: guia.trim(),
    nombre_empaquetadora: empaquetadora.trim()
  })
});
```

El cliente recibe email con guía y empaquetadora.

---

# PARTE C — Plan de pruebas manual

## C.1 Probar pasarela (cliente)

**Opción A — HTML de prueba backend (sin frontend):**

1. `node scripts/tools/test_wompi_flow.js`
2. Abrir **http://localhost:3001/test/wompi** (incógnito)
3. Generar checkout → Ir a pagar → tarjeta `4242...`

**Opción B — Frontend real (Vue/React):**

1. Login cliente
2. Checkout → método **Pasarela**
3. `POST /orders` → guardar `orderId` en `sessionStorage`
4. `POST /payments/wompi/checkout` → abrir `checkout.checkoutUrl`
5. Pagar con `4242 4242 4242 4242`
6. En `/pago/resultado` → polling status → ver `pagado`

## C.2 Probar en camino (admin + cliente)

1. Admin: `GET /orders/all` → elegir pedido pagado (`estado_pago: pagado`)
2. Admin: `PUT /orders/{id_solicitud}/status` → `{ estado: "aprobada" }`
3. Admin: `PUT /orders/{id_solicitud}/status` → en camino + guía + empaquetadora
4. Cliente: `GET /orders/my-orders` → ver `seguimiento` poblado
5. Admin: `PUT` → `{ estado: "entregada" }`

---

# Checklist implementación

### Checkout / Wompi
- [ ] Quitar transferencia del UI
- [ ] Opción pasarela + contra entrega
- [ ] Tras crear pedido pasarela → llamar `/payments/wompi/checkout`
- [ ] Redirigir a `checkout.checkoutUrl`
- [ ] Ruta `/pago/resultado` + polling status
- [ ] Countdown 40 min si `pendiente`
- [ ] Guardar `orderId` antes de ir a Wompi

### Seguimiento
- [ ] Detalle pedido: bloque `seguimiento` si existe
- [ ] Admin: modal guía + empaquetadora al elegir "En camino"
- [ ] Admin: usar `id_solicitud` en URL de status
- [ ] Admin: bloquear aprobar pasarela sin pago confirmado

### Errores
- [ ] Manejar `INVALID_PAYMENT_METHOD`, `PAYMENT_EXPIRED`, `ALREADY_PAID`
- [ ] Manejar `MISSING_NUMERO_GUIA`, `MISSING_EMPAQUETADORA`

---

# Referencia rápida endpoints

| Método | Ruta | Rol | Uso |
|--------|------|-----|-----|
| POST | `/orders` | Cliente | Crear pedido |
| POST | `/payments/wompi/checkout` | Cliente | Obtener URL de pago |
| GET | `/payments/status/:orderId` | Cliente | Estado de pago |
| GET | `/orders/my-orders` | Cliente | Mis pedidos |
| GET | `/orders/:id` | Cliente | Detalle (+ seguimiento) |
| PUT | `/orders/:id/cancel` | Cliente | Cancelar (solo pendiente) |
| GET | `/orders/all` | Admin | Todos los pedidos |
| PUT | `/orders/:id/status` | Admin | Cambiar estado / en camino |

---

# Producción Wompi

1. Keys producción en dashboard (`pub_prod_`, `prod_integrity_`, etc.)
2. Actualizar `.env` backend — ver `docs/WOMPI_ENV_SETUP.md`
3. `WOMPI_REDIRECT_URL=https://nublack12.com/pago/resultado`
4. Webhook: `POST https://tu-backend.com/api/payments/wompi/webhook`
5. `npm run diagnose:wompi` → paso 5 debe ser ✅

**Frontend:** sin cambios si usa `checkout` del backend.
