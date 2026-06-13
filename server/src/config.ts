import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Cargar .env desde la raíz del repo (un nivel por encima de /server).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) throw new Error(`Variable de entorno ${name} no es un entero válido: "${raw}"`);
  return n;
}

function str(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw.trim() === '' ? fallback : raw;
}

function list(name: string, fallback: string[]): string[] {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
}

export const config = {
  env: str('NODE_ENV', 'development'),
  port: int('PORT', 4000),

  jwtSecret: str('JWT_SECRET', 'dev-insecure-secret-change-me'),
  jwtExpiresIn: int('JWT_EXPIRES_IN', 3600),

  databaseUrl: str('DATABASE_URL', 'postgresql://bet:betpass@localhost:5432/betmundial'),
  databasePoolMax: int('DATABASE_POOL_MAX', 10),

  // Cumplimiento normativo
  allowedJurisdictions: list('ALLOWED_JURISDICTIONS', ['ES', 'MX', 'CO', 'PE', 'AR', 'CL', 'UK', 'MT']),
  minAge: int('MIN_AGE', 18),
  defaultDailyDepositLimit: int('DEFAULT_DAILY_DEPOSIT_LIMIT', 50_000),
  defaultMaxStake: int('DEFAULT_MAX_STAKE', 20_000),
  amlLargeTxThreshold: int('AML_LARGE_TX_THRESHOLD', 200_000),

  // Antifraude
  fraudMaxBetsPerMinute: int('FRAUD_MAX_BETS_PER_MINUTE', 20),
  rateLimitPerMinute: int('RATE_LIMIT_PER_MINUTE', 120),

  // Operación / despliegue
  logLevel: str('LOG_LEVEL', 'info'),
  // Orígenes CORS permitidos (coma). '*' o vacío => abierto (sólo dev).
  corsOrigins: (process.env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  // Nº de saltos de proxy de confianza (load balancer). 0 = sin proxy.
  trustProxy: int('TRUST_PROXY', 0),
  metricsEnabled: str('METRICS_ENABLED', 'true') !== 'false',
  paymentsWebhookSecret: str('PAYMENTS_WEBHOOK_SECRET', 'sandbox-webhook-secret'),

  // Bootstrap del administrador: si ambas se definen, el arranque crea o rota el
  // admin con estas credenciales (no hay contraseñas por defecto en producción).
  adminEmail: str('ADMIN_EMAIL', ''),
  adminPassword: process.env.ADMIN_PASSWORD ?? '',
} as const;

export const isProd = config.env === 'production';

/**
 * Validación de arranque: en producción no se permite arrancar con secretos por
 * defecto ni configuraciones inseguras. Falla rápido y con un mensaje claro.
 */
export function assertProductionConfig(): void {
  if (!isProd) return;
  const errors: string[] = [];
  if (config.jwtSecret === 'dev-insecure-secret-change-me' || config.jwtSecret.length < 32) {
    errors.push('JWT_SECRET debe ser un secreto fuerte (>= 32 caracteres) en producción.');
  }
  if (config.paymentsWebhookSecret === 'sandbox-webhook-secret') {
    errors.push('PAYMENTS_WEBHOOK_SECRET debe configurarse explícitamente en producción.');
  }
  if (config.corsOrigins.length === 0 || config.corsOrigins.includes('*')) {
    errors.push('CORS_ORIGINS debe enumerar los orígenes permitidos en producción (no usar "*").');
  }
  if (!process.env.DATABASE_URL) {
    errors.push('DATABASE_URL debe apuntar a la base de datos PostgreSQL de producción.');
  }
  if (errors.length > 0) {
    throw new Error('Configuración de producción inválida:\n - ' + errors.join('\n - '));
  }
  if (!config.adminEmail || !config.adminPassword) {
    // No bloquea el arranque, pero avisa: sin esto no hay administrador seguro.
    process.stderr.write(
      '[config] Aviso: ADMIN_EMAIL/ADMIN_PASSWORD no configurados; no se creará/rotará el administrador.\n',
    );
  }
}
