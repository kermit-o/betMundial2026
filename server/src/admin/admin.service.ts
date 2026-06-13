import type { Db, Executor } from '../db/index.js';
import { AppError } from '../types.js';
import { audit } from '../utils/audit.js';

export async function listFraudFlags(db: Executor, limit = 100) {
  return db.query(
    `SELECT f.*, u.email AS user_email
       FROM fraud_flags f LEFT JOIN users u ON u.id = f.user_id
      ORDER BY f.created_at DESC LIMIT $1`,
    [limit],
  );
}

export async function listAuditLog(db: Executor, limit = 150) {
  return db.query(
    `SELECT a.*, u.email AS user_email
       FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
      ORDER BY a.created_at DESC LIMIT $1`,
    [limit],
  );
}

export async function listUsers(db: Executor, limit = 100) {
  return db.query(
    `SELECT u.id, u.email, u.full_name, u.jurisdiction, u.role, u.kyc_status, u.email_verified,
            u.mfa_enabled, u.self_excluded_until, u.created_at, w.balance, w.currency
       FROM users u LEFT JOIN wallets w ON w.user_id = u.id
      ORDER BY u.created_at DESC LIMIT $1`,
    [limit],
  );
}

export async function setMarketStatus(db: Db, marketId: string, status: 'open' | 'suspended', adminId: string) {
  const market = await db.oneOrNone<{ status: string }>(`SELECT status FROM markets WHERE id = $1`, [marketId]);
  if (!market) throw new AppError(404, 'market_not_found', 'Mercado no encontrado.');
  if (market.status === 'settled') throw new AppError(409, 'market_settled', 'El mercado ya está liquidado.');
  await db.none(`UPDATE markets SET status = $1 WHERE id = $2`, [status, marketId]);
  await audit(db, 'admin_market_status', { userId: adminId, detail: { marketId, status } });
  return { id: marketId, status };
}

export async function forceKycStatus(db: Db, userId: string, status: 'verified' | 'rejected' | 'pending', adminId: string) {
  const user = await db.oneOrNone<{ id: string }>(`SELECT id FROM users WHERE id = $1`, [userId]);
  if (!user) throw new AppError(404, 'user_not_found', 'Usuario no encontrado.');
  await db.none(`UPDATE users SET kyc_status = $1 WHERE id = $2`, [status, userId]);
  await audit(db, 'admin_force_kyc', { userId: adminId, detail: { targetUser: userId, status } });
  return { userId, kyc_status: status };
}

export async function adminStats(db: Executor) {
  const get = async (sql: string): Promise<number> => {
    const row = await db.oneOrNone<{ n: number }>(sql);
    return Number(row?.n ?? 0);
  };
  const users = await get(`SELECT COUNT(*)::int AS n FROM users`);
  const openBets = await get(`SELECT COUNT(*)::int AS n FROM bets WHERE status='open'`);
  const fraudFlags = await get(`SELECT COUNT(*)::int AS n FROM fraud_flags`);
  const openLiability = await get(`SELECT COALESCE(SUM(potential_payout),0) AS n FROM bets WHERE status='open'`);
  return { users, openBets, fraudFlags, openLiability };
}
