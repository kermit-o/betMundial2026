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

  databasePath: str('DATABASE_PATH', path.resolve(__dirname, '../../data/bet.db')),

  // Cumplimiento normativo
  allowedJurisdictions: list('ALLOWED_JURISDICTIONS', ['ES', 'MX', 'CO', 'PE', 'AR', 'CL', 'UK', 'MT']),
  minAge: int('MIN_AGE', 18),
  defaultDailyDepositLimit: int('DEFAULT_DAILY_DEPOSIT_LIMIT', 50_000),
  defaultMaxStake: int('DEFAULT_MAX_STAKE', 20_000),
  amlLargeTxThreshold: int('AML_LARGE_TX_THRESHOLD', 200_000),

  // Antifraude
  fraudMaxBetsPerMinute: int('FRAUD_MAX_BETS_PER_MINUTE', 20),
  rateLimitPerMinute: int('RATE_LIMIT_PER_MINUTE', 120),
} as const;

export const isProd = config.env === 'production';

if (isProd && config.jwtSecret === 'dev-insecure-secret-change-me') {
  throw new Error('JWT_SECRET debe configurarse explícitamente en producción.');
}
