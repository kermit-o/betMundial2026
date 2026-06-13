# ⚽ Bet Mundial 2026

Plataforma web de apuestas deportivas para la **Copa Mundial 2026**, diseñada con
cuatro prioridades de producto:

| Pilar | Cómo se aborda |
|-------|----------------|
| **Estabilidad** | Operaciones financieras atómicas (transacciones PostgreSQL), validación de entrada con Zod en todos los endpoints, manejo de errores centralizado, apagado controlado (graceful shutdown) y suite de pruebas automatizadas. |
| **Cumplimiento normativo** | Motor de reglas por jurisdicción (edad mínima, moneda, impuestos, límites), verificación KYC, bloqueo geográfico, juego responsable (límites de depósito/pérdida, autoexclusión) y registro de auditoría inmutable. |
| **Baja latencia** | PostgreSQL con *connection pooling* y consultas parametrizadas, cuotas en memoria y **push de cuotas en vivo por WebSocket** (sin polling). |
| **Protección antifraude** | Rate limiting por IP (ámbitos separados), control de velocidad de apuestas, *risk scoring* multiseñal (stake, cuotas extremas, multicuenta por IP, cuentas nuevas), detección AML de transacciones grandes y bloqueo automático de apuestas de alto riesgo. |

### Funcionalidades de producto

- **Apuestas simples y combinadas (acumuladas)**: boletos de 1 a 12 selecciones,
  con cuota total = producto de cuotas y regla anti‑correlación (no se combinan
  dos selecciones del mismo partido). Las anuladas (*void*) cuentan como cuota 1.
- **Cash‑out**: cierre anticipado de apuestas abiertas a valor justo según las
  cuotas en vivo, con margen del operador.
- **Panel de administración** (rol admin): liquidar partidos, suspender/abrir
  mercados, tablero de banderas de fraude, registro de auditoría, gestión de
  usuarios y forzado de KYC, con métricas de exposición.
- **Proveedores pluggable**: interfaces `PaymentProvider` y `KycProvider` con
  implementación *sandbox* intercambiable. Depósitos idempotentes y webhooks
  de pago firmados.
- **Seguridad y juego responsable**: verificación de email, restablecimiento de
  contraseña, **MFA (TOTP)**, *reality checks* de sesión y límites con
  enfriamiento de 24h en las subidas.

> ⚠️ **Aviso**: proyecto de demostración técnica. El motor de pagos, la pasarela
> bancaria y la verificación KYC están **simulados**. Antes de operar dinero real
> se requiere licencia del regulador competente (p. ej. DGOJ en España, UKGC, MGA),
> integración con proveedores KYC/AML reales y auditoría de seguridad.

---

## Arquitectura

Monorepo con dos *workspaces* npm:

```
betMundial2026/
├── server/                 # API REST + WebSocket (Node 22, TypeScript, Express)
│   ├── src/
│   │   ├── config.ts           # Configuración tipada desde entorno
│   │   ├── app.ts / index.ts    # App Express y arranque (HTTP + WS + shutdown)
│   │   ├── db/                  # Esquema PostgreSQL, adaptador async (pg), seed
│   │   ├── auth/                # Registro, login, JWT
│   │   ├── compliance/          # Jurisdicciones, KYC, edad, límites responsables
│   │   ├── fraud/               # Risk scoring, velocity, AML, flags
│   │   ├── wallet/              # Cartera, ledger atómico, transacciones
│   │   ├── betting/             # Catálogo, colocación de apuestas, liquidación
│   │   ├── realtime/            # Motor de cuotas en vivo (WebSocket)
│   │   ├── middleware/          # Auth, rate limit, errores
│   │   └── routes/              # Endpoints + validación Zod
│   └── tests/                  # Vitest (unitarias + e2e con Supertest)
└── web/                    # SPA (React 18 + Vite + TypeScript)
    └── src/
        ├── api.ts               # Cliente HTTP tipado
        ├── useLiveOdds.ts        # Hook WebSocket de cuotas en vivo
        └── components/           # Partidos, boleto, cartera, cuenta, apuestas
```

### Modelo de datos (resumen)

`users` · `wallets` · `transactions` (ledger) · `payment_intents` · `kyc_cases` ·
`auth_tokens` · `teams` · `matches` · `markets` · `selections` · `bets` ·
`bet_legs` · `audit_log` · `fraud_flags`.

Todos los importes se almacenan en **minor units** (céntimos, `BIGINT`) para evitar
errores de coma flotante en operaciones monetarias.

---

## Puesta en marcha

### Requisitos
- Node.js ≥ 20 (probado en 22)
- npm ≥ 10
- PostgreSQL ≥ 14 (local o gestionado). La forma más rápida: `docker compose up db`.

### Instalación y arranque (desarrollo)

```bash
cp .env.example .env          # define DATABASE_URL, secretos y reglas
npm install                   # instala los dos workspaces
npm run seed                  # aplica el esquema + datos del Mundial 2026 + admin
npm run dev                   # API en :4000 y web en :5173 (con proxy)
```

El esquema se crea de forma idempotente al conectar; `DATABASE_URL` por defecto
apunta a `postgresql://bet:betpass@localhost:5432/betmundial`.

- Web: http://localhost:5173
- API: http://localhost:4000/api
- WebSocket de cuotas: ws://localhost:4000/ws/odds

**Usuario administrador de demostración** (para liquidar partidos):
`admin@betmundial2026.test` / `Admin1234!`

### Producción (build)

```bash
npm run build                 # compila server (dist/) y web (web/dist/)
npm start                     # arranca la API compilada
```

### Docker

```bash
docker compose up --build     # API en :4000, web servida en :8080
```

---

## API (resumen)

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| GET  | `/api/health` | — | Estado del servicio |
| GET  | `/api/jurisdictions` | — | Jurisdicciones permitidas y sus reglas |
| POST | `/api/auth/register` | — | Alta (valida edad, jurisdicción, términos) |
| POST | `/api/auth/login` | — | Login, devuelve JWT |
| GET  | `/api/matches` | — | Partidos con mercados y cuotas |
| GET  | `/api/me` | JWT | Perfil + saldo |
| POST | `/api/me/kyc` | JWT | Enviar verificación KYC |
| PUT  | `/api/me/limits/deposit` | JWT | Límite de depósito diario |
| PUT  | `/api/me/limits/loss` | JWT | Límite de pérdida diaria |
| POST | `/api/me/self-exclude` | JWT | Autoexclusión (juego responsable) |
| GET  | `/api/me/reality-check` | JWT | Resumen de actividad de la sesión |
| POST | `/api/me/mfa/setup` · `enable` · `disable` | JWT | Gestión de MFA (TOTP) |
| POST | `/api/me/email/verify-request` | JWT | Solicitar verificación de email |
| POST | `/api/auth/forgot-password` · `reset-password` · `verify-email` | — | Recuperación de cuenta |
| GET  | `/api/wallet` | JWT | Saldo, movimientos y pagos |
| POST | `/api/wallet/deposit` | JWT | Depósito (idempotente, vía proveedor) |
| POST | `/api/wallet/withdraw` | JWT | Retiro (requiere KYC) |
| POST | `/api/webhooks/payments` | firma | Confirmación de pago del proveedor |
| POST | `/api/bets` | JWT | Colocar apuesta simple o combinada |
| GET  | `/api/bets` | JWT | Historial (con patas y valor de cash‑out) |
| POST | `/api/bets/:id/cashout` | JWT | Cash‑out de una apuesta abierta |
| GET  | `/api/admin/stats` · `fraud-flags` · `audit` · `users` | JWT admin | Tableros de administración |
| POST | `/api/admin/matches/:id/settle` | JWT admin | Liquidar partido y pagar premios |
| POST | `/api/admin/markets/:id/status` | JWT admin | Suspender / abrir un mercado |
| POST | `/api/admin/users/:id/kyc` | JWT admin | Forzar estado KYC de un usuario |
| GET  | `/healthz` · `/readyz` | — | Liveness / readiness (orquestadores) |
| GET  | `/metrics` | — | Métricas Prometheus (HTTP + negocio) |

> **Producción**: consulta [`PRODUCTION.md`](./PRODUCTION.md) para el runbook,
> la configuración obligatoria (`assertProductionConfig`), observabilidad y el
> checklist de *go-live*. Plantillas legales en [`docs/legal/`](./docs/legal/).
>
> **Despliegue en Railway**: guía paso a paso en
> [`DEPLOY-RAILWAY.md`](./DEPLOY-RAILWAY.md) (un solo servicio con el `Dockerfile`
> raíz: Express sirve API + WebSocket + SPA, con Volume para la BD).

### Ejemplo: colocar una apuesta (simple o combinada)

```bash
curl -X POST http://localhost:4000/api/bets \
  -H "Authorization: Bearer <JWT>" -H "Content-Type: application/json" \
  -d '{"legs":[{"selectionId":"<id1>","expectedOdds":2.1},{"selectionId":"<id2>","expectedOdds":1.8}],"stake":5000}'
```

`stake` en minor units (5000 = 50,00 €). Una sola pata = apuesta simple; varias =
combinada. `expectedOdds` por pata protege al usuario: si una cuota se ha movido,
el servidor rechaza con `odds_changed` y el cliente revalida.

---

## Controles de cumplimiento y antifraude (detalle)

**Cumplimiento**
- Verificación de edad mínima por jurisdicción antes del alta y de cada apuesta.
- Bloqueo de jurisdicciones no autorizadas (`ALLOWED_JURISDICTIONS`).
- KYC obligatorio antes de apostar/retirar.
- Límite de depósito diario y límite de pérdida diaria autoconfigurables.
- Autoexclusión con periodo configurable.
- Impuesto sobre ganancias por jurisdicción aplicado en la liquidación.
- Auditoría inmutable de toda acción sensible (`audit_log`).

**Antifraude**
- Rate limiting por IP (global y reforzado en auth/cartera/apuestas).
- Control de velocidad de apuestas por usuario.
- *Risk scoring* (0–100) combinando stake, cuotas extremas, multicuenta por IP y
  antigüedad de cuenta; bloqueo automático por encima del umbral.
- Detección AML de transacciones grandes (`fraud_flags`).
- Cuotas bloqueadas al apostar y verificación de movimiento de mercado.

---

## Pruebas

```bash
npm test                      # 24 pruebas: cumplimiento, apuestas, fraude, API e2e
```

---

## Notas de seguridad para producción

- Sustituir `JWT_SECRET` por un secreto fuerte gestionado en un *secrets manager*.
- Servir siempre tras TLS; fijar `Secure`/`SameSite` en cookies si se migran sesiones.
- Reemplazar el rate limiter en memoria por Redis en despliegues multi‑instancia.
- Integrar proveedores reales de KYC/AML y pasarela de pago con conciliación.
- Añadir Redis para rate limiting distribuido y réplicas de lectura de PostgreSQL si se requiere escalado horizontal.
- Revisión de seguridad y *pentest* previos a producción.
