import type Database from 'better-sqlite3';
import type { User } from '../types.js';

export function findUserByEmail(db: Database.Database, email: string): User | undefined {
  return db.prepare(`SELECT * FROM users WHERE email = ?`).get(email.toLowerCase()) as User | undefined;
}

export function findUserById(db: Database.Database, id: string): User | undefined {
  return db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as User | undefined;
}

export function insertUser(db: Database.Database, user: User): void {
  db.prepare(
    `INSERT INTO users (id, email, password_hash, full_name, date_of_birth, jurisdiction,
       currency, role, kyc_status, self_excluded_until, daily_deposit_limit, daily_loss_limit,
       terms_accepted_at, signup_ip, created_at)
     VALUES (@id, @email, @password_hash, @full_name, @date_of_birth, @jurisdiction,
       @currency, @role, @kyc_status, @self_excluded_until, @daily_deposit_limit, @daily_loss_limit,
       @terms_accepted_at, @signup_ip, @created_at)`,
  ).run(user);
}

export function createWallet(db: Database.Database, userId: string, currency: string): void {
  db.prepare(`INSERT INTO wallets (user_id, balance, currency) VALUES (?, 0, ?)`).run(userId, currency);
}
