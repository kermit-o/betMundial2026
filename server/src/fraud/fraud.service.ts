import type Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import { config } from '../config.js';
import { AppError, type User } from '../types.js';
import { audit } from '../utils/audit.js';

export type Severity = 'low' | 'medium' | 'high';

export function raiseFlag(
  db: Database.Database,
  userId: string | null,
  type: string,
  severity: Severity,
  detail: unknown,
): void {
  db.prepare(
    `INSERT INTO fraud_flags (id, user_id, type, severity, detail) VALUES (?, ?, ?, ?, ?)`,
  ).run(nanoid(), userId, type, severity, JSON.stringify(detail));
  audit(db, 'fraud_flag', { userId, detail: { type, severity, detail } });
}

/** Nº de apuestas del usuario en el último minuto. */
function betsLastMinute(db: Database.Database, userId: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM bets
        WHERE user_id = ? AND placed_at >= datetime('now', '-1 minute')`,
    )
    .get(userId) as { n: number };
  return row.n;
}

/** Cuentas distintas que comparten la IP de registro (señal de multicuenta). */
function accountsSharingIp(db: Database.Database, ip: string | null, excludeUserId: string): number {
  if (!ip) return 0;
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM users WHERE signup_ip = ? AND id != ?`)
    .get(ip, excludeUserId) as { n: number };
  return row.n;
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
export function assessBetRisk(db: Database.Database, ctx: BetRiskContext): RiskAssessment {
  const reasons: string[] = [];
  let score = 0;

  // 1. Velocity: ráfaga de apuestas en poco tiempo.
  const recent = betsLastMinute(db, ctx.user.id);
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
  const shared = accountsSharingIp(db, ctx.ip, ctx.user.id);
  if (shared >= 3) {
    score += 25;
    reasons.push(`multicuenta_ip:${shared}`);
  } else if (shared >= 1) {
    score += 10;
    reasons.push(`ip_compartida:${shared}`);
  }

  // 5. Cuenta muy reciente apostando fuerte (cuentas "mula").
  const accountAgeMs = Date.now() - new Date(ctx.user.created_at + 'Z').getTime();
  if (accountAgeMs < 10 * 60 * 1000 && ctx.stake >= ctx.maxStake * 0.5) {
    score += 15;
    reasons.push('cuenta_nueva_stake_alto');
  }

  return { score: Math.min(100, score), reasons };
}

/** Umbral por encima del cual una apuesta se rechaza directamente. */
export const HARD_BLOCK_THRESHOLD = 80;

export function enforceBetRisk(db: Database.Database, ctx: BetRiskContext): RiskAssessment {
  const assessment = assessBetRisk(db, ctx);
  if (assessment.score >= HARD_BLOCK_THRESHOLD) {
    raiseFlag(db, ctx.user.id, 'bet_blocked', 'high', assessment);
    throw new AppError(
      403,
      'bet_blocked_risk',
      'La apuesta ha sido bloqueada por el sistema antifraude. Contacte con soporte.',
    );
  }
  if (assessment.score >= 40) {
    raiseFlag(db, ctx.user.id, 'bet_high_risk', 'medium', assessment);
  }
  return assessment;
}

/** Detección AML: transacciones grandes que requieren revisión. */
export function screenTransaction(
  db: Database.Database,
  userId: string,
  type: string,
  amount: number,
): void {
  if (Math.abs(amount) >= config.amlLargeTxThreshold) {
    raiseFlag(db, userId, 'aml_large_transaction', 'high', { type, amount });
  }
}
