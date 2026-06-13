# Despliegue en Railway — paso a paso

Esta guía despliega **Bet Mundial 2026** en [Railway](https://railway.app) como
**un único servicio**: el servidor Express sirve la API, el WebSocket y la SPA
desde el mismo dominio (sin CORS entre servicios ni red interna que configurar),
con un **Volume** para persistir la base de datos SQLite.

Railway detecta automáticamente el `Dockerfile` y el `railway.json` de la raíz.

---

## Requisitos previos

- Cuenta en Railway (https://railway.app) con el plan que permita Volúmenes.
- El repositorio `kermit-o/betMundial2026` en GitHub (rama `main`).

---

## Opción A — Panel web (recomendada)

### 1. Crear el proyecto
1. Railway → **New Project** → **Deploy from GitHub repo**.
2. Autoriza Railway en GitHub y elige `kermit-o/betMundial2026`.
3. Railway detecta el `Dockerfile` raíz (`railway.json` fija el builder y el
   healthcheck en `/healthz`). Deja que cree el servicio; **cancela el primer
   deploy o déjalo fallar**: aún faltan variables y el volumen.

### 2. Añadir el Volume (persistencia de la BD)
1. En el servicio → pestaña **Variables/Settings** → **Volumes** → **New Volume**.
2. **Mount path**: `/data`
3. Guarda. (La BD vivirá en `/data/bet.db`, fuera del sistema de archivos efímero.)

### 3. Configurar las variables de entorno
En el servicio → **Variables** → añade:

| Variable | Valor | Notas |
|----------|-------|-------|
| `NODE_ENV` | `production` | Activa validación y HSTS |
| `JWT_SECRET` | *(cadena aleatoria ≥ 32 caracteres)* | Genera una; ver abajo |
| `PAYMENTS_WEBHOOK_SECRET` | *(cadena aleatoria)* | Distinta del valor sandbox |
| `CORS_ORIGINS` | `https://TU-DOMINIO.up.railway.app` | Ver paso 5; actualízala con tu dominio real |
| `DATABASE_PATH` | `/data/bet.db` | Debe apuntar al Volume |
| `TRUST_PROXY` | `1` | Railway está detrás de un proxy |
| `ALLOWED_JURISDICTIONS` | `ES,MX,CO,PE,AR,CL,UK,MT` | Ajusta a tus mercados |
| `LOG_LEVEL` | `info` | opcional |

> **No definas `PORT`**: Railway lo inyecta automáticamente y la app lo respeta.

Para generar `JWT_SECRET` localmente:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

> ⚠️ El arranque **falla a propósito** (`assertProductionConfig`) si `JWT_SECRET`
> es débil, falta `PAYMENTS_WEBHOOK_SECRET` o `CORS_ORIGINS` es `*` o está vacío.

### 4. Generar el dominio público
1. Servicio → **Settings** → **Networking** → **Generate Domain**.
2. Copia el dominio (p. ej. `betmundial-production.up.railway.app`).
3. Vuelve a **Variables** y pon ese dominio en `CORS_ORIGINS`
   (con `https://`). Railway redeplegará.

### 5. Desplegar y verificar
1. Espera a que el deploy termine (el primero compila el binario nativo, ~2-4 min).
2. Comprueba la salud:
   ```bash
   curl https://TU-DOMINIO.up.railway.app/healthz     # {"status":"ok"}
   curl https://TU-DOMINIO.up.railway.app/readyz      # {"status":"ready"}
   curl https://TU-DOMINIO.up.railway.app/metrics     # métricas Prometheus
   ```
3. Abre `https://TU-DOMINIO.up.railway.app/` en el navegador: debe cargar la
   plataforma. Las cuotas en vivo (WebSocket) funcionan en el mismo dominio.

### 6. Acceso de administración
La BD se siembra automáticamente en el primer arranque con un usuario admin:
`admin@betmundial2026.test` / `Admin1234!`.
**Cambia esa contraseña inmediatamente** (o elimina el usuario y crea uno propio)
antes de usarlo de verdad.

---

## Opción B — Railway CLI

```bash
npm i -g @railway/cli
railway login
railway init                      # crea/enlaza el proyecto
railway up                        # build & deploy con el Dockerfile raíz

# Variables (repite por cada una):
railway variables --set NODE_ENV=production
railway variables --set JWT_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")"
railway variables --set PAYMENTS_WEBHOOK_SECRET="$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")"
railway variables --set DATABASE_PATH=/data/bet.db
railway variables --set TRUST_PROXY=1
railway variables --set ALLOWED_JURISDICTIONS=ES,MX,CO,PE,AR,CL,UK,MT

# Volume y dominio se crean desde el panel (Settings → Volumes / Networking),
# y luego: railway variables --set CORS_ORIGINS=https://TU-DOMINIO.up.railway.app
```

---

## Notas de operación

- **Persistencia**: sin el Volume en `/data`, la BD se reinicia en cada deploy.
- **Escalado**: SQLite + rate limit en memoria sirven para **una réplica**. Para
  escalar horizontalmente, migra a PostgreSQL y Redis (ver `PRODUCTION.md §6`).
- **Logs**: salida JSON estructurada visible en la pestaña *Deployments → Logs*.
- **Healthcheck**: Railway usa `/healthz` (definido en `railway.json`) para marcar
  el deploy como sano antes de enrutar tráfico.
- **Despliegue continuo**: con el repo conectado, cada push a `main` redespliega.
- **Pagos/KYC**: siguen en modo *sandbox*. Para producción real, implementa los
  proveedores (`PaymentProvider`/`KycProvider`) y revisa el checklist de
  `PRODUCTION.md §7`, incluida la licencia regulatoria.
