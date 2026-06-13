import type Database from 'better-sqlite3';
import { AppError, type User } from '../types.js';
import { getJurisdictionRule } from './jurisdictions.js';

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
export function assertCanBet(_db: Database.Database, user: User, now = new Date()): void {
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
export function depositsLast24h(db: Database.Database, userId: string): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total
         FROM transactions
        WHERE user_id = ? AND type = 'deposit'
          AND created_at >= datetime('now', '-1 day')`,
    )
    .get(userId) as { total: number };
  return row.total;
}

/** Pérdida neta (stake - payouts) en las últimas 24h (minor units, positiva = pérdida). */
export function netLossLast24h(db: Database.Database, userId: string): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN type = 'bet_stake' THEN -amount
                                WHEN type = 'bet_payout' THEN -amount
                                ELSE 0 END), 0) AS net
         FROM transactions
        WHERE user_id = ? AND type IN ('bet_stake','bet_payout')
          AND created_at >= datetime('now', '-1 day')`,
    )
    .get(userId) as { net: number };
  // amount es negativo para stake (carga) y positivo para payout (abono);
  // net = stake - payout => pérdida neta positiva.
  return row.net;
}

export function assertDepositWithinLimit(db: Database.Database, user: User, amount: number): void {
  const already = depositsLast24h(db, user.id);
  if (already + amount > user.daily_deposit_limit) {
    throw new AppError(
      403,
      'deposit_limit_exceeded',
      `El depósito supera su límite diario. Disponible hoy: ${Math.max(0, user.daily_deposit_limit - already)} (minor units).`,
    );
  }
}

export function assertLossLimitNotExceeded(db: Database.Database, user: User, additionalStake: number): void {
  if (user.daily_loss_limit == null) return;
  const currentNetLoss = netLossLast24h(db, user.id);
  if (currentNetLoss + additionalStake > user.daily_loss_limit) {
    throw new AppError(
      403,
      'loss_limit_exceeded',
      'La apuesta superaría su límite de pérdida diaria autoconfigurado.',
    );
  }
}
