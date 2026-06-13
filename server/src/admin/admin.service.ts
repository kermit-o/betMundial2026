import type Database from 'better-sqlite3';
import { AppError } from '../types.js';
import { audit } from '../utils/audit.js';

export function listFraudFlags(db: Database.Database, limit = 100) {
  return db
    .prepare(
      `SELECT f.*, u.email AS user_email
         FROM fraud_flags f LEFT JOIN users u ON u.id = f.user_id
        ORDER BY f.created_at DESC LIMIT ?`,
    )
    .all(limit);
}

export function listAuditLog(db: Database.Database, limit = 150) {
  return db
    .prepare(
      `SELECT a.*, u.email AS user_email
         FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
        ORDER BY a.created_at DESC LIMIT ?`,
    )
    .all(limit);
}

export function listUsers(db: Database.Database, limit = 100) {
  return db
    .prepare(
      `SELECT u.id, u.email, u.full_name, u.jurisdiction, u.role, u.kyc_status, u.email_verified,
              u.mfa_enabled, u.self_excluded_until, u.created_at, w.balance, w.currency
         FROM users u LEFT JOIN wallets w ON w.user_id = u.id
        ORDER BY u.created_at DESC LIMIT ?`,
    )
    .all(limit);
}

export function setMarketStatus(db: Database.Database, marketId: string, status: 'open' | 'suspended', adminId: string) {
  const market = db.prepare(`SELECT status FROM markets WHERE id = ?`).get(marketId) as { status: string } | undefined;
  if (!market) throw new AppError(404, 'market_not_found', 'Mercado no encontrado.');
  if (market.status === 'settled') throw new AppError(409, 'market_settled', 'El mercado ya está liquidado.');
  db.prepare(`UPDATE markets SET status = ? WHERE id = ?`).run(status, marketId);
  audit(db, 'admin_market_status', { userId: adminId, detail: { marketId, status } });
  return { id: marketId, status };
}

export function forceKycStatus(db: Database.Database, userId: string, status: 'verified' | 'rejected' | 'pending', adminId: string) {
  const user = db.prepare(`SELECT id FROM users WHERE id = ?`).get(userId) as { id: string } | undefined;
  if (!user) throw new AppError(404, 'user_not_found', 'Usuario no encontrado.');
  db.prepare(`UPDATE users SET kyc_status = ? WHERE id = ?`).run(status, userId);
  audit(db, 'admin_force_kyc', { userId: adminId, detail: { targetUser: userId, status } });
  return { userId, kyc_status: status };
}

export function adminStats(db: Database.Database) {
  const users = (db.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number }).n;
  const openBets = (db.prepare(`SELECT COUNT(*) AS n FROM bets WHERE status='open'`).get() as { n: number }).n;
  const flags = (db.prepare(`SELECT COUNT(*) AS n FROM fraud_flags`).get() as { n: number }).n;
  const liability = (db.prepare(`SELECT COALESCE(SUM(potential_payout),0) AS s FROM bets WHERE status='open'`).get() as { s: number }).s;
  return { users, openBets, fraudFlags: flags, openLiability: liability };
}
