# Despliegue en Railway — paso a paso

Esta guía despliega **Bet Mundial 2026** en [Railway](https://railway.app) como
**un único servicio web** (el servidor Express sirve la API, el WebSocket y la SPA
desde el mismo dominio) más un servicio gestionado de **PostgreSQL**.

Railway detecta automáticamente el `Dockerfile` y el `railway.json` de la raíz.

---

## Requisitos previos

- Cuenta en Railway (https://railway.app).
- El repositorio `kermit-o/betMundial2026` en GitHub (rama `main`).

---

## Opción A — Panel web (recomendada)

### 1. Crear el proyecto y la base de datos
1. Railway → **New Project** → **Deploy from GitHub repo** → elige `kermit-o/betMundial2026`.
2. En el proyecto → **New** → **Database** → **Add PostgreSQL**. Railway crea un
   servicio Postgres gestionado y expone la variable `DATABASE_URL`.
3. El servicio web detecta el `Dockerfile` raíz. **Deja que el primer deploy falle**
   (faltan variables); las configuramos ahora.

### 2. Configurar las variables del servicio web
En el servicio web → **Variables** → añade:

| Variable | Valor | Notas |
|----------|-------|-------|
| `NODE_ENV` | `production` | Activa validación y HSTS |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | **Referencia** al servicio Postgres |
| `JWT_SECRET` | *(cadena aleatoria ≥ 32 caracteres)* | Ver abajo |
| `PAYMENTS_WEBHOOK_SECRET` | *(cadena aleatoria)* | Distinta del valor sandbox |
| `CORS_ORIGINS` | `https://TU-DOMINIO.up.railway.app` | Ver paso 4 |
| `ADMIN_EMAIL` | `admin@tudominio.com` | Crea/rota el administrador |
| `ADMIN_PASSWORD` | *(contraseña fuerte, ≥ 8)* | Cambiarla y redesplegar la rota |
| `TRUST_PROXY` | `1` | Railway está detrás de un proxy |
| `ALLOWED_JURISDICTIONS` | `ES,MX,CO,PE,AR,CL,UK,MT` | Ajusta a tus mercados |
| `LOG_LEVEL` | `info` | opcional |

> `${{Postgres.DATABASE_URL}}` es una **variable de referencia** de Railway: enlaza
> la URL real del Postgres. Si tu servicio Postgres tiene otro nombre, ajústalo.
>
> **No definas `PORT`**: Railway lo inyecta y la app lo respeta.

Genera `JWT_SECRET` localmente:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

> ⚠️ El arranque **falla a propósito** (`assertProductionConfig`) si `JWT_SECRET`
> es débil, falta `PAYMENTS_WEBHOOK_SECRET`/`DATABASE_URL`, o `CORS_ORIGINS` es `*`/vacío.

### 3. Esquema y datos
No hay que hacer nada manual: al arrancar, la app **crea el esquema** de forma
idempotente y **siembra** los datos del Mundial 2026 y el usuario admin
(`node dist/db/seed.js`). La migración del esquema viaja con la imagen.

### 4. Generar el dominio público
1. Servicio web → **Settings** → **Networking** → **Generate Domain**.
2. Copia el dominio y ponlo en `CORS_ORIGINS` (con `https://`). Railway redeplegará.

### 5. Desplegar y verificar
```bash
curl https://TU-DOMINIO.up.railway.app/healthz     # {"status":"ok"}
curl https://TU-DOMINIO.up.railway.app/readyz      # {"status":"ready"} (comprueba la BD)
curl https://TU-DOMINIO.up.railway.app/metrics     # métricas Prometheus
```
Abre `https://TU-DOMINIO.up.railway.app/` en el navegador: debe cargar la
plataforma. Las cuotas en vivo (WebSocket) funcionan en el mismo dominio.

### 6. Acceso de administración
El administrador se crea a partir de `ADMIN_EMAIL` / `ADMIN_PASSWORD`. En
producción **no hay credenciales por defecto**: define ambas variables y
redespliega para crear el admin (o para **rotar su contraseña** — basta con
cambiar `ADMIN_PASSWORD` y volver a desplegar).

> Si en un despliegue anterior quedó el admin de demostración
> (`admin@betmundial2026.test` / `Admin1234!`), pon `ADMIN_EMAIL=admin@betmundial2026.test`
> y un `ADMIN_PASSWORD` fuerte, y redespliega: rotará esa misma cuenta.

### 7. Pagos con Stripe (opcional)
Por defecto el proveedor es `sandbox` (confirma al instante, ideal para demo).
Para usar Stripe **en modo test**:

1. En Stripe (modo test) copia tu **clave secreta** `sk_test_...`.
2. Crea un endpoint de webhook apuntando a
   `https://TU-DOMINIO.up.railway.app/webhooks/payments`, suscrito a
   `checkout.session.completed` (y `checkout.session.expired`). Copia su
   **signing secret** `whsec_...`.
3. Añade variables en Railway:

   | Variable | Valor |
   |----------|-------|
   | `PAYMENT_PROVIDER` | `stripe` |
   | `STRIPE_SECRET_KEY` | `sk_test_...` |
   | `STRIPE_WEBHOOK_SECRET` | `whsec_...` |
   | `STRIPE_SUCCESS_URL` | `https://TU-DOMINIO.up.railway.app/?deposit=ok` |
   | `STRIPE_CANCEL_URL` | `https://TU-DOMINIO.up.railway.app/?deposit=cancel` |

El depósito abre **Stripe Checkout**; al pagar, el webhook firma y abona el saldo.

> ⚠️ Stripe **prohíbe apuestas con dinero real sin licencia de juego** y aprobación
> previa. Usa claves de test salvo que tengas esa licencia. Los **retiros** quedan
> en `pending`: el pago real a usuarios requiere Stripe Connect/Treasury.

---

## Opción B — Railway CLI

```bash
npm i -g @railway/cli
railway login
railway init
railway add --database postgres        # crea el Postgres gestionado
railway up                             # build & deploy con el Dockerfile raíz

railway variables --set NODE_ENV=production
railway variables --set DATABASE_URL='${{Postgres.DATABASE_URL}}'
railway variables --set JWT_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")"
railway variables --set PAYMENTS_WEBHOOK_SECRET="$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")"
railway variables --set TRUST_PROXY=1
railway variables --set ALLOWED_JURISDICTIONS=ES,MX,CO,PE,AR,CL,UK,MT
# Genera el dominio en el panel y luego:
railway variables --set CORS_ORIGINS=https://TU-DOMINIO.up.railway.app
```

---

## Notas de operación

- **Escalado**: con PostgreSQL puedes escalar el servicio web a varias réplicas.
  El rate limiter es en memoria por instancia; para coherencia entre réplicas,
  respáldalo en Redis (ver `PRODUCTION.md §6`).
- **Backups**: Railway gestiona el Postgres; configura backups/retención.
- **Logs**: salida JSON estructurada en *Deployments → Logs*.
- **Healthcheck**: Railway usa `/healthz` (definido en `railway.json`).
- **Despliegue continuo**: cada push a `main` redespliega.
- **Pagos/KYC**: siguen en modo *sandbox*. Para producción real, implementa los
  proveedores (`PaymentProvider`/`KycProvider`) y revisa `PRODUCTION.md §7`,
  incluida la licencia regulatoria.
