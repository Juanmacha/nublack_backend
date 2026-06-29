# Tutorial: Obtener variables de entorno de Wompi

Guía paso a paso para sacar cada variable que necesita el backend NUBLACK desde el dashboard de **Wompi Developers (Sandbox)** y, más adelante, desde **Producción**.

---

## Antes de empezar

### 1. Crear cuenta en Wompi

1. Entra a **[https://comercios.wompi.co](https://comercios.wompi.co)** (Colombia).
2. Regístrate o inicia sesión como comercio.
3. Completa el registro básico del negocio si te lo piden.

### 2. Activar modo Sandbox (pruebas)

Mientras desarrollas, **no uses producción**. Wompi tiene dos ambientes separados:

| Ambiente | Dinero real | Prefijo de keys |
|----------|-------------|-----------------|
| **Sandbox** (pruebas) | No | `pub_test_`, `prv_test_`, `test_integrity_`, `test_events_` |
| **Producción** | Sí | `pub_prod_`, `prv_prod_`, `prod_integrity_`, `prod_events_` |

**Para activar Sandbox:**

1. En el menú lateral izquierdo, abre **Desarrollo** (o **Desarrolladores**).
2. Entra a **Programadores**.
3. Busca el módulo **Modo de pruebas**.
4. Haz clic en **Ver modo Sandbox** / **Activar modo de pruebas**.
5. Debe aparecer una **barra roja** arriba indicando que estás en Sandbox.

> Cuando veas keys con prefijo `pub_test_` estás en el ambiente correcto para desarrollo.

---

## Dónde están las credenciales en el dashboard

Ruta general (puede variar levemente el nombre del menú):

```
Menú lateral → Desarrollo / Desarrolladores → Programadores
```

Ahí verás secciones como:

- **Llaves del API para integración técnica** → llave pública y privada
- **Secretos para integración técnica** → integridad y eventos
- **URL de Eventos** → webhook (no es variable `.env`, se configura en el panel)

Documentación oficial: [Ambientes y llaves](https://docs.wompi.co/docs/colombia/ambientes-y-llaves/) | [Widget Checkout](https://docs.wompi.co/docs/colombia/widget-checkout-web/) | [Eventos / Webhook](https://docs.wompi.co/docs/colombia/eventos/)

---

## Variable por variable

### `WOMPI_PUBLIC_KEY`

**Qué es:** Llave pública del comercio. El frontend la usa para abrir el widget de pago (el backend también la devuelve en `checkout.publicKey`).

**Dónde sacarla:**

1. Dashboard → **Desarrollo** → **Programadores**
2. Sección **Llaves del API para integración técnica**
3. Copia **Llave pública**

**Cómo debe verse en Sandbox:**

```env
WOMPI_PUBLIC_KEY=pub_test_XXXXXXXXXXXXXXXXXXXXXXXX
```

**Cómo debe verse en Producción (cuando la tengas):**

```env
WOMPI_PUBLIC_KEY=pub_prod_XXXXXXXXXXXXXXXXXXXXXXXX
```

**Regla:** Siempre empieza por `pub_test_` (sandbox) o `pub_prod_` (producción).

---

### `WOMPI_PRIVATE_KEY`

**Qué es:** Llave privada del comercio. Solo va en el **backend**, nunca en el frontend.

**Dónde sacarla:**

1. Misma sección: **Llaves del API para integración técnica**
2. Copia **Llave privada**

**Cómo debe verse:**

```env
WOMPI_PRIVATE_KEY=prv_test_XXXXXXXXXXXXXXXXXXXXXXXX
```

**Nota:** En la integración actual de NUBLACK (Widget/Checkout Web) las keys mínimas obligatorias son la **pública** y el **secreto de integridad**. La privada conviene guardarla igual por si más adelante usas la API directa de Wompi.

---

### `WOMPI_INTEGRITY_SECRET`

**Qué es:** Secreto para generar la **firma de integridad** (`signature:integrity`) que valida que nadie alteró el monto ni la referencia del pago.

**Dónde sacarla:**

1. Dashboard → **Desarrollo** → **Programadores**
2. Sección **Secretos para integración técnica**
3. Copia el valor de **Integridad** (o “Secreto de integridad”)

**Cómo debe verse:**

```env
WOMPI_INTEGRITY_SECRET=test_integrity_XXXXXXXXXXXXXXXXXXXXXXXX
```

En producción:

```env
WOMPI_INTEGRITY_SECRET=prod_integrity_XXXXXXXXXXXXXXXXXXXXXXXX
```

**Importante:** Este secreto **no** es la llave privada ni la pública. Es un valor aparte.

---

### `WOMPI_EVENTS_SECRET`

**Qué es:** Secreto para verificar que los **webhooks** (eventos de pago) vienen realmente de Wompi y no de un atacante.

**Dónde sacarla:**

1. Misma sección: **Secretos para integración técnica**
2. Copia el valor de **Eventos** (o “Secreto de eventos”)

**Cómo debe verse:**

```env
WOMPI_EVENTS_SECRET=test_events_XXXXXXXXXXXXXXXXXXXXXXXX
```

En producción:

```env
WOMPI_EVENTS_SECRET=prod_events_XXXXXXXXXXXXXXXXXXXXXXXX
```

---

### `WOMPI_ENV`

**Qué es:** Le dice al backend qué ambiente usar. **No se saca de Wompi** — la defines tú según las keys que pegaste.

**Valores posibles:**

```env
# Mientras pruebas con pub_test_ / test_integrity_ / test_events_
WOMPI_ENV=sandbox

# Cuando tengas cuenta oficial y keys pub_prod_ / prod_integrity_ / prod_events_
WOMPI_ENV=production
```

**Regla:** Las keys y `WOMPI_ENV` deben coincidir. No mezcles keys de sandbox con `production` ni al revés.

---

### `WOMPI_REDIRECT_URL`

**Qué es:** URL a la que Wompi redirige al cliente **después de pagar** (pantalla de resultado en tu frontend).

**No se saca de Wompi** — la defines tú según tu app.

**Ejemplos:**

```env
# Desarrollo local (Vite/React)
WOMPI_REDIRECT_URL=http://localhost:5173/pago/resultado

# Producción
WOMPI_REDIRECT_URL=https://nublack12.com/pago/resultado
```

**Requisitos:**

- Debe ser una URL **pública** en producción (Wompi no puede redirigir a `localhost` desde un celular real; en local solo sirve en tu PC).
- Crea en el frontend la ruta `/pago/resultado` (ver `docs/FRONTEND_INTEGRATION.md`).

---

### `PAYMENT_EXPIRY_MINUTES`

**Qué es:** Minutos que tiene el cliente para pagar un pedido con pasarela antes de que se cancele solo.

**No viene de Wompi** — es regla de negocio de NUBLACK.

```env
PAYMENT_EXPIRY_MINUTES=40
```

---

## Configurar el Webhook (URL de Eventos)

Esto **no** va en `.env`, se configura en el dashboard de Wompi.

### Sandbox

1. Dashboard → **Desarrollo** → **Programadores**
2. Busca **URL de Eventos** (o configuración de webhooks)
3. Pega la URL de tu backend:

```
https://TU-BACKEND.com/api/payments/wompi/webhook
```

Ejemplo local con túnel (ngrok, localtunnel, etc.):

```
https://abc123.ngrok-free.app/api/payments/wompi/webhook
```

> Wompi **no puede** llamar a `localhost` directamente. Para probar webhooks en local necesitas exponer tu puerto 3001 con un túnel.

### Producción

Repite el mismo paso pero:

- Con el dashboard en **modo Producción** (Sandbox desactivado)
- Con la URL real del backend en Render/servidor

**Sandbox y Producción llevan URLs de eventos distintas** — configura una para cada ambiente.

---

## Ejemplo completo de `.env` (Sandbox)

Pega esto en tu archivo `.env` y reemplaza los `XXXX` con tus valores reales:

```env
# Wompi - Sandbox (Developers)
WOMPI_PUBLIC_KEY=pub_test_XXXXXXXXXXXXXXXXXXXXXXXX
WOMPI_PRIVATE_KEY=prv_test_XXXXXXXXXXXXXXXXXXXXXXXX
WOMPI_INTEGRITY_SECRET=test_integrity_XXXXXXXXXXXXXXXXXXXXXXXX
WOMPI_EVENTS_SECRET=test_events_XXXXXXXXXXXXXXXXXXXXXXXX
WOMPI_ENV=sandbox
WOMPI_REDIRECT_URL=http://localhost:5173/pago/resultado
PAYMENT_EXPIRY_MINUTES=40
```

Reinicia el servidor después de guardar:

```bash
npm run dev
```

Si todo está bien, en consola verás:

```
✅ Wompi configurado (sandbox). Expiración de pago: 40 min.
```

Si falta alguna key:

```
⚠️ Wompi no configurado. Pasarela de pago deshabilitada hasta configurar variables WOMPI_*.
```

---

## Tabla resumen

| Variable `.env` | ¿De dónde sale? | Sección en Wompi | Prefijo Sandbox |
|-----------------|-----------------|------------------|-----------------|
| `WOMPI_PUBLIC_KEY` | Dashboard | Llaves del API → Llave pública | `pub_test_` |
| `WOMPI_PRIVATE_KEY` | Dashboard | Llaves del API → Llave privada | `prv_test_` |
| `WOMPI_INTEGRITY_SECRET` | Dashboard | Secretos → Integridad | `test_integrity_` |
| `WOMPI_EVENTS_SECRET` | Dashboard | Secretos → Eventos | `test_events_` |
| `WOMPI_ENV` | Tú la escribes | — | `sandbox` |
| `WOMPI_REDIRECT_URL` | Tú la escribes | — | URL de tu frontend |
| `PAYMENT_EXPIRY_MINUTES` | Tú la escribes | — | `40` |
| Webhook URL | Dashboard | URL de Eventos | URL de tu backend |

---

## Pasar a Wompi oficial (Producción)

Cuando Wompi apruebe tu comercio para cobrar en vivo:

1. **Desactiva** el modo Sandbox en el dashboard.
2. Ve a **Programadores** en modo Producción.
3. Copia las **nuevas** keys (`pub_prod_`, `prv_prod_`, `prod_integrity_`, `prod_events_`).
4. Actualiza `.env`:

```env
WOMPI_PUBLIC_KEY=pub_prod_...
WOMPI_PRIVATE_KEY=prv_prod_...
WOMPI_INTEGRITY_SECRET=prod_integrity_...
WOMPI_EVENTS_SECRET=prod_events_...
WOMPI_ENV=production
WOMPI_REDIRECT_URL=https://nublack12.com/pago/resultado
```

5. Configura la **URL de Eventos** de producción en el dashboard.
6. Reinicia el backend.

**No hace falta cambiar código** — solo variables y webhook.

---

## Probar que funciona (Sandbox)

### Tarjetas de prueba

Consulta la doc oficial: [Datos de prueba en Sandbox](https://docs.wompi.co/docs/colombia/datos-de-prueba-en-sandbox/)

Wompi publica números de tarjeta de prueba que simulan pago aprobado o rechazado.

### Flujo rápido de prueba

1. Crea un pedido con `"metodo": "pasarela"` → `POST /api/orders`
2. Usa el objeto `checkout` de la respuesta para abrir el widget Wompi
3. Paga con tarjeta de prueba
4. Verifica `GET /api/payments/status/:orderId` → `estado_pago: "pagado"`
5. Revisa logs del backend por `[Wompi Webhook]`

---

## Seguridad — qué NO hacer

| ❌ No hagas | ✅ Haz |
|------------|--------|
| Poner llave privada o secretos en el frontend | Solo `publicKey` va al cliente (viene del backend) |
| Subir `.env` a GitHub | Usa `.env.example` y variables en Render |
| Mezclar keys sandbox con producción | Un juego de keys por ambiente |
| Compartir secretos por WhatsApp/email sin cifrar | Copiar directo al `.env` del servidor |

---

## Problemas comunes

### “Pasarela no configurada” (503)

- Falta `WOMPI_PUBLIC_KEY` o `WOMPI_INTEGRITY_SECRET` en `.env`
- Reinicia el servidor tras editar `.env`

### El pago se completa pero el pedido sigue `pendiente`

- El webhook no llegó al backend
- Revisa que la **URL de Eventos** en Wompi sea correcta
- En local, usa ngrok u otro túnel
- Verifica `WOMPI_EVENTS_SECRET`

### “Checksum inválido” en webhook

- `WOMPI_EVENTS_SECRET` incorrecto o de otro ambiente
- Copia de nuevo el secreto de **Eventos** con Sandbox activo

### Widget no abre / error de firma

- `WOMPI_INTEGRITY_SECRET` incorrecto
- Keys de sandbox mezcladas con `WOMPI_ENV=production`

---

## Enlaces útiles

- [Registro comercios Wompi](https://comercios.wompi.co)
- [Ambientes y llaves](https://docs.wompi.co/docs/colombia/ambientes-y-llaves/)
- [Widget & Checkout Web](https://docs.wompi.co/docs/colombia/widget-checkout-web/)
- [Eventos / Webhooks](https://docs.wompi.co/docs/colombia/eventos/)
- [Integración frontend NUBLACK](./FRONTEND_INTEGRATION.md)
