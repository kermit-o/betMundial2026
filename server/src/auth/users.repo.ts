import type { Executor } from '../db/index.js';
import type { User } from '../types.js';

export async function findUserByEmail(db: Executor, email: string): Promise<User | undefined> {
  return db.oneOrNone<User>(`SELECT * FROM users WHERE email = $1`, [email.toLowerCase()]);
}

export async function findUserById(db: Executor, id: string): Promise<User | undefined> {
  return db.oneOrNone<User>(`SELECT * FROM users WHERE id = $1`, [id]);
}

export async function insertUser(db: Executor, user: User): Promise<void> {
  await db.none(
    `INSERT INTO users (id, email, password_hash, full_name, date_of_birth, jurisdiction,
       currency, role, kyc_status, email_verified, mfa_enabled, mfa_secret, self_excluded_until,
       daily_deposit_limit, daily_loss_limit, pending_deposit_limit, pending_deposit_effective,
       pending_loss_limit, pending_loss_effective, terms_accepted_at, signup_ip, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
    [
      user.id, user.email, user.password_hash, user.full_name, user.date_of_birth, user.jurisdiction,
      user.currency, user.role, user.kyc_status, user.email_verified, user.mfa_enabled, user.mfa_secret,
      user.self_excluded_until, user.daily_deposit_limit, user.daily_loss_limit, user.pending_deposit_limit,
      user.pending_deposit_effective, user.pending_loss_limit, user.pending_loss_effective,
      user.terms_accepted_at, user.signup_ip, user.created_at,
    ],
  );
}

export async function createWallet(db: Executor, userId: string, currency: string): Promise<void> {
  await db.none(`INSERT INTO wallets (user_id, balance, currency) VALUES ($1, 0, $2)`, [userId, currency]);
}
