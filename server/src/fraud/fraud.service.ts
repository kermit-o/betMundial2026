import { nanoid } from 'nanoid';
import { config } from '../config.js';
import type { Executor } from '../db/index.js';
import { AppError, type User } from '../types.js';
import { audit } from '../utils/audit.js';
import { isoAgo, nowIso } from '../utils/time.js';

export type Severity = 'low' | 'medium' | 'high';

export async function raiseFlag(
  db: Executor,
  userId: string | null,
  type: string,
  severity: Severity,
  detail: unknown,
): Promise<void> {
  await db.none(
    `INSERT INTO fraud_flags (id, user_id, type, severity, detail, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
    [nanoid(), userId, type, severity, JSON.stringify(detail), nowIso()],
  );
  await audit(db, 'fraud_flag', { userId, detail: { type, severity, detail } });
}

/** Nº de apuestas del usuario en el último minuto. */
async function betsLastMinute(db: Executor, userId: string): Promise<number> {
  const row = await db.oneOrNone<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM bets WHERE user_id = $1 AND placed_at >= $2`,
    [userId, isoAgo(60_000)],
  );
  return row?.n ?? 0;
}

/** Cuentas distintas que comparten la IP de registro (señal de multicuenta). */
async function accountsSharingIp(db: Executor, ip: string | null, excludeUserId: string): Promise<number> {
  if (!ip) return 0;
  const row = await db.oneOrNone<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM users WHERE signup_ip = $1 AND id != $2`,
    [ip, excludeUserId],
  );
  return row?.n ?? 0;
}

export interface BetRiskContext {
  user: User;
  stake: number;
  odds: number;
  maxStake: number;
  ip: string | null;
}

export interface RiskAssessment {
  score: number; // 0..100
  reasons: string[];
}

/**
 * Evalúa el riesgo de una apuesta combinando varias señales. Devuelve una
 * puntuación 0..100. El llamador decide aceptar, marcar o bloquear.
 */
export async function assessBetRisk(db: Executor, ctx: BetRiskContext): Promise<RiskAssessment> {
  const reasons: string[] = [];
  let score = 0;

  // 1. Velocity: ráfaga de apuestas en poco tiempo.
  const recent = await betsLastMinute(db, ctx.user.id);
  if (recent >= config.fraudMaxBetsPerMinute) {
    score += 40;
    reasons.push(`velocity_alta:${recent}_apuestas/min`);
  } else if (recent >= config.fraudMaxBetsPerMinute / 2) {
    score += 15;
    reasons.push(`velocity_media:${recent}_apuestas/min`);
  }

  // 2. Stake cercano o superior al máximo permitido.
  if (ctx.stake >= ctx.maxStake) {
    score += 25;
    reasons.push('stake_en_limite');
  } else if (ctx.stake >= ctx.maxStake * 0.8) {
    score += 10;
    reasons.push('stake_alto');
  }

  // 3. Cuotas extremas (posible explotación de error de pricing / arbitraje).
  if (ctx.odds >= 50) {
    score += 15;
    reasons.push('cuota_extrema');
  }

  // 4. Multicuenta: varias cuentas con la misma IP de registro.
  const shared = await accountsSharingIp(db, ctx.ip, ctx.user.id);
  if (shared >= 3) {
    score += 25;
    reasons.push(`multicuenta_ip:${shared}`);
  } else if (shared >= 1) {
    score += 10;
    reasons.push(`ip_compartida:${shared}`);
  }

  // 5. Cuenta muy reciente apostando fuerte (cuentas "mula").
  const accountAgeMs = Date.now() - new Date(ctx.user.created_at).getTime();
  if (accountAgeMs < 10 * 60 * 1000 && ctx.stake >= ctx.maxStake * 0.5) {
    score += 15;
    reasons.push('cuenta_nueva_stake_alto');
  }

  return { score: Math.min(100, score), reasons };
}

/** Umbral por encima del cual una apuesta se rechaza directamente. */
export const HARD_BLOCK_THRESHOLD = 80;

export async function enforceBetRisk(db: Executor, ctx: BetRiskContext): Promise<RiskAssessment> {
  const assessment = await assessBetRisk(db, ctx);
  if (assessment.score >= HARD_BLOCK_THRESHOLD) {
    await raiseFlag(db, ctx.user.id, 'bet_blocked', 'high', assessment);
    throw new AppError(
      403,
      'bet_blocked_risk',
      'La apuesta ha sido bloqueada por el sistema antifraude. Contacte con soporte.',
    );
  }
  if (assessment.score >= 40) {
    await raiseFlag(db, ctx.user.id, 'bet_high_risk', 'medium', assessment);
  }
  return assessment;
}

/** Detección AML: transacciones grandes que requieren revisión. */
export async function screenTransaction(
  db: Executor,
  userId: string,
  type: string,
  amount: number,
): Promise<void> {
  if (Math.abs(amount) >= config.amlLargeTxThreshold) {
    await raiseFlag(db, userId, 'aml_large_transaction', 'high', { type, amount });
  }
}
