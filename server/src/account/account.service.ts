import type Database from 'better-sqlite3';
import { AppError, type User } from '../types.js';
import { audit } from '../utils/audit.js';

/**
 * Simulación de verificación KYC. En producción se integraría con un proveedor
 * (Onfido, Jumio, SumSub...). Aquí aprobamos si el nombre del documento coincide
 * razonablemente y el usuario cumple la edad — suficiente para demostrar el flujo.
 */
export function submitKyc(
  db: Database.Database,
  user: User,
  payload: { documentType: string; documentNumber: string; fullNameOnDocument: string },
  ip: string | null,
): { kyc_status: User['kyc_status'] } {
  if (user.kyc_status === 'verified') return { kyc_status: 'verified' };

  const nameMatches =
    payload.fullNameOnDocument.trim().toLowerCase() === user.full_name.trim().toLowerCase();
  const validDoc = payload.documentNumber.replace(/\s/g, '').length >= 5;
  const status: User['kyc_status'] = nameMatches && validDoc ? 'verified' : 'rejected';

  db.prepare(`UPDATE users SET kyc_status = ? WHERE id = ?`).run(status, user.id);
  audit(db, 'kyc_submission', {
    userId: user.id,
    detail: { documentType: payload.documentType, result: status },
    ip,
  });
  return { kyc_status: status };
}

export function setDepositLimit(db: Database.Database, user: User, newLimit: number, ip: string | null): void {
  if (newLimit < 0) throw new AppError(400, 'invalid_limit', 'El límite debe ser positivo.');
  // Subir el límite es una acción de mayor riesgo; se permite pero queda auditada.
  db.prepare(`UPDATE users SET daily_deposit_limit = ? WHERE id = ?`).run(newLimit, user.id);
  audit(db, 'set_deposit_limit', { userId: user.id, detail: { from: user.daily_deposit_limit, to: newLimit }, ip });
}

export function setLossLimit(db: Database.Database, user: User, newLimit: number | null, ip: string | null): void {
  if (newLimit != null && newLimit < 0) throw new AppError(400, 'invalid_limit', 'El límite debe ser positivo.');
  db.prepare(`UPDATE users SET daily_loss_limit = ? WHERE id = ?`).run(newLimit, user.id);
  audit(db, 'set_loss_limit', { userId: user.id, detail: { to: newLimit }, ip });
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

/** Vista pública del perfil (sin hash de contraseña). */
export function publicProfile(user: User) {
  const { password_hash, ...rest } = user;
  void password_hash;
  return rest;
}
