import type Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import { AppError, type User } from '../types.js';
import { audit } from '../utils/audit.js';
import { getKycProvider } from '../payments/index.js';

/**
 * Verificación KYC a través del proveedor configurado (sandbox por defecto).
 * Registra un caso KYC y actualiza el estado del usuario.
 */
export function submitKyc(
  db: Database.Database,
  user: User,
  payload: { documentType: string; documentNumber: string; fullNameOnDocument: string },
  ip: string | null,
): { kyc_status: User['kyc_status'] } {
  if (user.kyc_status === 'verified') return { kyc_status: 'verified' };

  const provider = getKycProvider();
  const result = provider.submit({
    userId: user.id,
    documentType: payload.documentType,
    documentNumber: payload.documentNumber,
    fullNameOnDocument: payload.fullNameOnDocument,
    expectedName: user.full_name,
  });

  const run = db.transaction(() => {
    db.prepare(
      `INSERT INTO kyc_cases (id, user_id, provider, status, reference) VALUES (?, ?, ?, ?, ?)`,
    ).run(nanoid(), user.id, provider.name, result.status, result.reference);
    db.prepare(`UPDATE users SET kyc_status = ? WHERE id = ?`).run(result.status, user.id);
    audit(db, 'kyc_submission', {
      userId: user.id,
      detail: { provider: provider.name, documentType: payload.documentType, result: result.status },
      ip,
    });
  });
  run();
  return { kyc_status: result.status };
}

const LIMIT_INCREASE_DELAY_MS = 24 * 60 * 60 * 1000;

/**
 * Cambio de límite de depósito. Reducir es inmediato (más seguro); aumentar se
 * programa con enfriamiento de 24h para evitar decisiones impulsivas (requisito
 * habitual de juego responsable).
 */
export function setDepositLimit(db: Database.Database, user: User, newLimit: number, ip: string | null): { applied: boolean; effectiveAt?: string } {
  if (newLimit < 0) throw new AppError(400, 'invalid_limit', 'El límite debe ser positivo.');
  if (newLimit <= user.daily_deposit_limit) {
    db.prepare(`UPDATE users SET daily_deposit_limit = ?, pending_deposit_limit = NULL, pending_deposit_effective = NULL WHERE id = ?`).run(newLimit, user.id);
    audit(db, 'set_deposit_limit', { userId: user.id, detail: { from: user.daily_deposit_limit, to: newLimit, immediate: true }, ip });
    return { applied: true };
  }
  const effectiveAt = new Date(Date.now() + LIMIT_INCREASE_DELAY_MS).toISOString();
  db.prepare(`UPDATE users SET pending_deposit_limit = ?, pending_deposit_effective = ? WHERE id = ?`).run(newLimit, effectiveAt, user.id);
  audit(db, 'set_deposit_limit', { userId: user.id, detail: { from: user.daily_deposit_limit, to: newLimit, effectiveAt }, ip });
  return { applied: false, effectiveAt };
}

export function setLossLimit(db: Database.Database, user: User, newLimit: number | null, ip: string | null): { applied: boolean; effectiveAt?: string } {
  if (newLimit != null && newLimit < 0) throw new AppError(400, 'invalid_limit', 'El límite debe ser positivo.');
  const stricter = newLimit == null ? false : user.daily_loss_limit == null ? false : newLimit <= user.daily_loss_limit;
  // Reducir (o establecer por primera vez) es inmediato; aflojar/quitar espera.
  const immediate = newLimit != null && (user.daily_loss_limit == null || stricter);
  if (immediate) {
    db.prepare(`UPDATE users SET daily_loss_limit = ?, pending_loss_limit = NULL, pending_loss_effective = NULL WHERE id = ?`).run(newLimit, user.id);
    audit(db, 'set_loss_limit', { userId: user.id, detail: { to: newLimit, immediate: true }, ip });
    return { applied: true };
  }
  const effectiveAt = new Date(Date.now() + LIMIT_INCREASE_DELAY_MS).toISOString();
  db.prepare(`UPDATE users SET pending_loss_limit = ?, pending_loss_effective = ? WHERE id = ?`).run(newLimit, effectiveAt, user.id);
  audit(db, 'set_loss_limit', { userId: user.id, detail: { to: newLimit, effectiveAt }, ip });
  return { applied: false, effectiveAt };
}

/**
 * Promueve límites pendientes cuyo periodo de enfriamiento ya venció.
 * Se invoca al cargar el usuario para que los cambios surtan efecto a tiempo.
 */
export function applyPendingLimits(db: Database.Database, user: User): User {
  const now = Date.now();
  let changed = false;
  if (user.pending_deposit_effective && new Date(user.pending_deposit_effective).getTime() <= now) {
    db.prepare(`UPDATE users SET daily_deposit_limit = ?, pending_deposit_limit = NULL, pending_deposit_effective = NULL WHERE id = ?`).run(user.pending_deposit_limit, user.id);
    user.daily_deposit_limit = user.pending_deposit_limit!;
    user.pending_deposit_limit = null;
    user.pending_deposit_effective = null;
    changed = true;
  }
  if (user.pending_loss_effective && new Date(user.pending_loss_effective).getTime() <= now) {
    db.prepare(`UPDATE users SET daily_loss_limit = ?, pending_loss_limit = NULL, pending_loss_effective = NULL WHERE id = ?`).run(user.pending_loss_limit, user.id);
    user.daily_loss_limit = user.pending_loss_limit;
    user.pending_loss_limit = null;
    user.pending_loss_effective = null;
    changed = true;
  }
  if (changed) audit(db, 'pending_limits_applied', { userId: user.id });
  return user;
}

/** Autoexclusión: bloquea apuestas durante N días (juego responsable). */
export function selfExclude(db: Database.Database, user: User, days: number, ip: string | null): { until: string } {
  if (!Number.isInteger(days) || days < 1 || days > 3650) {
    throw new AppError(400, 'invalid_period', 'El periodo de autoexclusión debe estar entre 1 y 3650 días.');
  }
  const until = new Date(Date.now() + days * 86_400_000).toISOString();
  db.prepare(`UPDATE users SET self_excluded_until = ? WHERE id = ?`).run(until, user.id);
  audit(db, 'self_exclusion', { userId: user.id, detail: { days, until }, ip });
  return { until };
}

/**
 * "Reality check": resumen de la actividad reciente (última hora) para mostrar
 * al usuario cuánto tiempo lleva jugando y cuánto ha apostado/ganado.
 */
export function realityCheck(db: Database.Database, userId: string): {
  windowMinutes: number;
  betsCount: number;
  totalStaked: number;
  netResult: number;
} {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(stake),0) AS staked
         FROM bets WHERE user_id = ? AND placed_at >= datetime('now','-1 hour')`,
    )
    .get(userId) as { n: number; staked: number };
  const net = db
    .prepare(
      `SELECT COALESCE(SUM(amount),0) AS net FROM transactions
        WHERE user_id = ? AND type IN ('bet_stake','bet_payout','cashout','refund')
          AND created_at >= datetime('now','-1 hour')`,
    )
    .get(userId) as { net: number };
  return { windowMinutes: 60, betsCount: row.n, totalStaked: row.staked, netResult: net.net };
}

/** Vista pública del perfil (sin secretos). */
export function publicProfile(user: User) {
  const { password_hash, mfa_secret, ...rest } = user;
  void password_hash;
  void mfa_secret;
  return rest;
}
