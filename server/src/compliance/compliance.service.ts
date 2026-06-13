import type { Executor } from '../db/index.js';
import { AppError, type User } from '../types.js';
import { isoAgo } from '../utils/time.js';
import { getJurisdictionRule } from './jurisdictions.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Edad en años completos a partir de fecha de nacimiento ISO. */
export function ageFromDob(dob: string, now = new Date()): number {
  const birth = new Date(dob + 'T00:00:00Z');
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  const m = now.getUTCMonth() - birth.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < birth.getUTCDate())) age--;
  return age;
}

export function meetsMinAge(dob: string, jurisdiction: string, now = new Date()): boolean {
  const rule = getJurisdictionRule(jurisdiction);
  return ageFromDob(dob, now) >= rule.minAge;
}

export function isSelfExcluded(user: Pick<User, 'self_excluded_until'>, now = new Date()): boolean {
  if (!user.self_excluded_until) return false;
  return new Date(user.self_excluded_until).getTime() > now.getTime();
}

/**
 * Comprobaciones que deben pasar ANTES de aceptar una apuesta con dinero real.
 * Lanza AppError con el motivo concreto si alguna falla.
 */
export function assertCanBet(user: User, now = new Date()): void {
  if (isSelfExcluded(user, now)) {
    throw new AppError(403, 'self_excluded', 'Cuenta en periodo de autoexclusión; no se pueden realizar apuestas.');
  }
  const rule = getJurisdictionRule(user.jurisdiction);
  if (rule.kycRequiredBeforeBetting && user.kyc_status !== 'verified') {
    throw new AppError(403, 'kyc_required', 'Debe completar la verificación de identidad (KYC) antes de apostar.');
  }
  if (!user.terms_accepted_at) {
    throw new AppError(403, 'terms_required', 'Debe aceptar los términos y condiciones antes de apostar.');
  }
  if (!meetsMinAge(user.date_of_birth, user.jurisdiction, now)) {
    throw new AppError(403, 'underage', 'No cumple la edad mínima requerida en su jurisdicción.');
  }
}

/** Importe depositado por el usuario en las últimas 24h (minor units). */
export async function depositsLast24h(db: Executor, userId: string): Promise<number> {
  const row = await db.oneOrNone<{ total: number }>(
    `SELECT COALESCE(SUM(amount), 0) AS total
       FROM transactions
      WHERE user_id = $1 AND type = 'deposit' AND created_at >= $2`,
    [userId, isoAgo(DAY_MS)],
  );
  return row?.total ?? 0;
}

/** Pérdida neta (stake - payouts) en las últimas 24h (minor units, positiva = pérdida). */
export async function netLossLast24h(db: Executor, userId: string): Promise<number> {
  const row = await db.oneOrNone<{ net: number }>(
    `SELECT COALESCE(SUM(CASE WHEN type = 'bet_stake' THEN -amount
                              WHEN type = 'bet_payout' THEN -amount
                              ELSE 0 END), 0) AS net
       FROM transactions
      WHERE user_id = $1 AND type IN ('bet_stake','bet_payout') AND created_at >= $2`,
    [userId, isoAgo(DAY_MS)],
  );
  // amount es negativo para stake (carga) y positivo para payout (abono);
  // net = stake - payout => pérdida neta positiva.
  return row?.net ?? 0;
}

export async function assertDepositWithinLimit(db: Executor, user: User, amount: number): Promise<void> {
  const already = await depositsLast24h(db, user.id);
  if (already + amount > user.daily_deposit_limit) {
    throw new AppError(
      403,
      'deposit_limit_exceeded',
      `El depósito supera su límite diario. Disponible hoy: ${Math.max(0, user.daily_deposit_limit - already)} (minor units).`,
    );
  }
}

export async function assertLossLimitNotExceeded(db: Executor, user: User, additionalStake: number): Promise<void> {
  if (user.daily_loss_limit == null) return;
  const currentNetLoss = await netLossLast24h(db, user.id);
  if (currentNetLoss + additionalStake > user.daily_loss_limit) {
    throw new AppError(
      403,
      'loss_limit_exceeded',
      'La apuesta superaría su límite de pérdida diaria autoconfigurado.',
    );
  }
}
