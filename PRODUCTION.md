# Guía de producción — Bet Mundial 2026

Runbook de operación y checklist de *go-live*. Complementa al `README.md`.

## 1. Estado de preparación

| Capa | Estado | Notas |
|------|--------|-------|
| Aplicación (apuestas, cartera, cumplimiento, antifraude) | ✅ Listo | Cubierto por pruebas |
| Observabilidad (logs JSON, `/metrics`, `/healthz`, `/readyz`) | ✅ Listo | Prometheus + agregador de logs |
| Endurecimiento de config (fail-fast, CORS allowlist, HSTS, trust proxy) | ✅ Listo | Ver §3 |
| Empaquetado (Docker no-root, healthchecks, CI) | ✅ Listo | `docker compose up` |
| Persistencia (PostgreSQL) | ✅ Listo | Esquema idempotente; pool `pg`; transacciones |
| Pasarela de pago real | ⚠️ Pendiente | Interfaz `PaymentProvider` lista; falta implementación (Stripe/Adyen) |
| KYC/AML real | ⚠️ Pendiente | Interfaz `KycProvider` lista; falta implementación (Onfido/SumSub) |
| Rate limit distribuido (Redis) | ⚠️ Pendiente | Hoy en memoria (1 instancia) |
| Licencia regulatoria | ⛔ Bloqueante | Requisito legal por jurisdicción |

## 2. Variables de entorno obligatorias en producción

El arranque **falla** (`assertProductionConfig`) si no se cumplen:

- `NODE_ENV=production`
- `DATABASE_URL` — cadena de conexión PostgreSQL.
- `JWT_SECRET` — secreto fuerte, ≥ 32 caracteres (usar un *secrets manager*).
- `PAYMENTS_WEBHOOK_SECRET` — distinto del valor sandbox.
- `CORS_ORIGINS` — lista explícita de orígenes (no `*`).
- Recomendado: `TRUST_PROXY=1` tras un balanceador.

## 3. Seguridad

- TLS terminado en el balanceador/ingress; HSTS activo en producción (helmet).
- Cabeceras de seguridad por `helmet`; CORS restringido por allowlist.
- `trust proxy` configurado para que el rate limiting y las señales antifraude
  usen la IP real del cliente.
- Secretos fuera del repositorio (gestor de secretos / variables del orquestador).
- MFA (TOTP) disponible; forzarlo para cuentas de administrador.
- Ejecutar un **pentest** y una revisión de dependencias (`npm audit`) antes del lanzamiento.

## 4. Observabilidad y sondas

- `GET /healthz` — liveness (proceso vivo).
- `GET /readyz` — readiness (comprueba la BD); úsese para el tráfico del LB.
- `GET /metrics` — exposición Prometheus: tráfico HTTP (contador + histograma de
  latencia), errores no controlados y gauges de negocio (usuarios, apuestas
  abiertas, exposición, banderas de fraude, suma de saldos).
- Logs en JSON (una línea por evento) con `reqId` para correlación; enviarlos a un
  agregador (Loki/ELK/CloudWatch).
- Alertas sugeridas: tasa de 5xx, latencia p95, exposición abierta, ratio de
  banderas de fraude, fallos de readiness.

## 5. Despliegue

```bash
# Local / staging con Docker
cp .env.example .env   # define JWT_SECRET, PAYMENTS_WEBHOOK_SECRET, CORS_ORIGINS
docker compose up --build
# API :4000 (healthcheck en /readyz), web :8080
```

Para orquestadores (Kubernetes): usar `/healthz` como *livenessProbe* y `/readyz`
como *readinessProbe*; montar un volumen persistente para la BD; inyectar
secretos desde el gestor de secretos.

## 6. Camino a escala (siguientes pasos)

1. **Redis**: respaldar el rate limiter y la caché de cuotas para múltiples
   instancias del API (hoy el rate limit es en memoria por instancia).
2. **Proveedores reales**: implementar `PaymentProvider` y `KycProvider` (las
   interfaces ya existen) y registrar en el factory de `payments/index.ts`.
3. **Feed deportivo**: integrar cuotas y resultados de un proveedor (Sportradar/
   Genius) y automatizar la liquidación.
4. **Base de datos**: réplicas de lectura, backups y *connection pooling*
   (p.ej. PgBouncer) según la carga del torneo.

## 7. Checklist de go-live

- [ ] Licencia del regulador vigente en cada jurisdicción objetivo.
- [ ] T&C, privacidad (RGPD) y juego responsable publicados (ver `docs/legal/`).
- [ ] `JWT_SECRET`, `PAYMENTS_WEBHOOK_SECRET`, `CORS_ORIGINS` configurados.
- [ ] TLS y cabeceras verificadas; pentest superado.
- [ ] Pasarela de pago y KYC reales integrados y conciliados.
- [ ] Backups de BD y plan de recuperación probados.
- [ ] Monitorización, alertas y *on-call* operativos.
- [ ] Pruebas de carga superadas para el pico esperado del torneo.
