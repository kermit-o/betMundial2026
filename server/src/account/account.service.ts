import { nanoid } from 'nanoid';
import type { Db, Executor } from '../db/index.js';
import { AppError, type User } from '../types.js';
import { audit } from '../utils/audit.js';
import { isoAgo, nowIso } from '../utils/time.js';
import { getKycProvider } from '../payments/index.js';

/**
 * Verificación KYC a través del proveedor configurado (sandbox por defecto).
 * Registra un caso KYC y actualiza el estado del usuario.
 */
export async function submitKyc(
  db: Db,
  user: User,
  payload: { documentType: string; documentNumber: string; fullNameOnDocument: string },
  ip: string | null,
): Promise<{ kyc_status: User['kyc_status'] }> {
  if (user.kyc_status === 'verified') return { kyc_status: 'verified' };

  const provider = getKycProvider();
  const result = provider.submit({
    userId: user.id,
    documentType: payload.documentType,
    documentNumber: payload.documentNumber,
    fullNameOnDocument: payload.fullNameOnDocument,
    expectedName: user.full_name,
  });

  await db.tx(async (t) => {
    const now = nowIso();
    await t.none(
      `INSERT INTO kyc_cases (id, user_id, provider, status, reference, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $6)`,
      [nanoid(), user.id, provider.name, result.status, result.reference, now],
    );
    await t.none(`UPDATE users SET kyc_status = $1 WHERE id = $2`, [result.status, user.id]);
    await audit(t, 'kyc_submission', {
      userId: user.id,
      detail: { provider: provider.name, documentType: payload.documentType, result: result.status },
      ip,
    });
  });
  return { kyc_status: result.status };
}

const LIMIT_INCREASE_DELAY_MS = 24 * 60 * 60 * 1000;

/**
 * Cambio de límite de depósito. Reducir es inmediato (más seguro); aumentar se
 * programa con enfriamiento de 24h para evitar decisiones impulsivas (requisito
 * habitual de juego responsable).
 */
export async function setDepositLimit(db: Db, user: User, newLimit: number, ip: string | null): Promise<{ applied: boolean; effectiveAt?: string }> {
  if (newLimit < 0) throw new AppError(400, 'invalid_limit', 'El límite debe ser positivo.');
  if (newLimit <= user.daily_deposit_limit) {
    await db.none(`UPDATE users SET daily_deposit_limit = $1, pending_deposit_limit = NULL, pending_deposit_effective = NULL WHERE id = $2`, [newLimit, user.id]);
    await audit(db, 'set_deposit_limit', { userId: user.id, detail: { from: user.daily_deposit_limit, to: newLimit, immediate: true }, ip });
    return { applied: true };
  }
  const effectiveAt = new Date(Date.now() + LIMIT_INCREASE_DELAY_MS).toISOString();
  await db.none(`UPDATE users SET pending_deposit_limit = $1, pending_deposit_effective = $2 WHERE id = $3`, [newLimit, effectiveAt, user.id]);
  await audit(db, 'set_deposit_limit', { userId: user.id, detail: { from: user.daily_deposit_limit, to: newLimit, effectiveAt }, ip });
  return { applied: false, effectiveAt };
}

export async function setLossLimit(db: Db, user: User, newLimit: number | null, ip: string | null): Promise<{ applied: boolean; effectiveAt?: string }> {
  if (newLimit != null && newLimit < 0) throw new AppError(400, 'invalid_limit', 'El límite debe ser positivo.');
  const stricter = newLimit == null ? false : user.daily_loss_limit == null ? false : newLimit <= user.daily_loss_limit;
  // Reducir (o establecer por primera vez) es inmediato; aflojar/quitar espera.
  const immediate = newLimit != null && (user.daily_loss_limit == null || stricter);
  if (immediate) {
    await db.none(`UPDATE users SET daily_loss_limit = $1, pending_loss_limit = NULL, pending_loss_effective = NULL WHERE id = $2`, [newLimit, user.id]);
    await audit(db, 'set_loss_limit', { userId: user.id, detail: { to: newLimit, immediate: true }, ip });
    return { applied: true };
  }
  const effectiveAt = new Date(Date.now() + LIMIT_INCREASE_DELAY_MS).toISOString();
  await db.none(`UPDATE users SET pending_loss_limit = $1, pending_loss_effective = $2 WHERE id = $3`, [newLimit, effectiveAt, user.id]);
  await audit(db, 'set_loss_limit', { userId: user.id, detail: { to: newLimit, effectiveAt }, ip });
  return { applied: false, effectiveAt };
}

/**
 * Promueve límites pendientes cuyo periodo de enfriamiento ya venció.
 * Se invoca al cargar el usuario para que los cambios surtan efecto a tiempo.
 */
export async function applyPendingLimits(db: Executor, user: User): Promise<User> {
  const now = Date.now();
  if (user.pending_deposit_effective && new Date(user.pending_deposit_effective).getTime() <= now) {
    await db.none(`UPDATE users SET daily_deposit_limit = $1, pending_deposit_limit = NULL, pending_deposit_effective = NULL WHERE id = $2`, [user.pending_deposit_limit, user.id]);
    user.daily_deposit_limit = user.pending_deposit_limit!;
    user.pending_deposit_limit = null;
    user.pending_deposit_effective = null;
  }
  if (user.pending_loss_effective && new Date(user.pending_loss_effective).getTime() <= now) {
    await db.none(`UPDATE users SET daily_loss_limit = $1, pending_loss_limit = NULL, pending_loss_effective = NULL WHERE id = $2`, [user.pending_loss_limit, user.id]);
    user.daily_loss_limit = user.pending_loss_limit;
    user.pending_loss_limit = null;
    user.pending_loss_effective = null;
  }
  return user;
}

/** Autoexclusión: bloquea apuestas durante N días (juego responsable). */
export async function selfExclude(db: Db, user: User, days: number, ip: string | null): Promise<{ until: string }> {
  if (!Number.isInteger(days) || days < 1 || days > 3650) {
    throw new AppError(400, 'invalid_period', 'El periodo de autoexclusión debe estar entre 1 y 3650 días.');
  }
  const until = new Date(Date.now() + days * 86_400_000).toISOString();
  await db.none(`UPDATE users SET self_excluded_until = $1 WHERE id = $2`, [until, user.id]);
  await audit(db, 'self_exclusion', { userId: user.id, detail: { days, until }, ip });
  return { until };
}

/**
 * "Reality check": resumen de la actividad reciente (última hora) para mostrar
 * al usuario cuánto tiempo lleva jugando y cuánto ha apostado/ganado.
 */
export async function realityCheck(db: Executor, userId: string): Promise<{
  windowMinutes: number;
  betsCount: number;
  totalStaked: number;
  netResult: number;
}> {
  const cutoff = isoAgo(60 * 60 * 1000);
  const row = await db.oneOrNone<{ n: number; staked: number }>(
    `SELECT COUNT(*)::int AS n, COALESCE(SUM(stake),0) AS staked
       FROM bets WHERE user_id = $1 AND placed_at >= $2`,
    [userId, cutoff],
  );
  const net = await db.oneOrNone<{ net: number }>(
    `SELECT COALESCE(SUM(amount),0) AS net FROM transactions
      WHERE user_id = $1 AND type IN ('bet_stake','bet_payout','cashout','refund') AND created_at >= $2`,
    [userId, cutoff],
  );
  return { windowMinutes: 60, betsCount: row?.n ?? 0, totalStaked: row?.staked ?? 0, netResult: net?.net ?? 0 };
}

/** Vista pública del perfil (sin secretos). */
export function publicProfile(user: User) {
  const { password_hash, mfa_secret, ...rest } = user;
  void password_hash;
  void mfa_secret;
  return rest;
}
