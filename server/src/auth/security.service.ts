import type Database from 'better-sqlite3';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import { AppError, type User } from '../types.js';
import { audit } from '../utils/audit.js';
import { findUserByEmail } from './users.repo.js';
import { generateSecret, otpauthUrl, verifyTotp } from './totp.js';

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function createToken(db: Database.Database, userId: string, type: string, ttlMinutes: number): string {
  const raw = crypto.randomBytes(24).toString('base64url');
  const expires = new Date(Date.now() + ttlMinutes * 60_000).toISOString();
  db.prepare(
    `INSERT INTO auth_tokens (id, user_id, type, token_hash, expires_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(nanoid(), userId, type, sha256(raw), expires);
  return raw;
}

function consumeToken(db: Database.Database, type: string, raw: string): string {
  const row = db
    .prepare(`SELECT * FROM auth_tokens WHERE token_hash = ? AND type = ?`)
    .get(sha256(raw), type) as { id: string; user_id: string; expires_at: string; used_at: string | null } | undefined;
  if (!row || row.used_at) throw new AppError(400, 'invalid_token', 'Token inválido o ya utilizado.');
  if (new Date(row.expires_at).getTime() < Date.now()) throw new AppError(400, 'expired_token', 'El token ha expirado.');
  db.prepare(`UPDATE auth_tokens SET used_at = datetime('now') WHERE id = ?`).run(row.id);
  return row.user_id;
}

// --- Verificación de email ---

export function requestEmailVerification(db: Database.Database, user: User): { token: string } {
  const token = createToken(db, user.id, 'email_verify', 60 * 24);
  audit(db, 'email_verification_requested', { userId: user.id });
  // En producción se enviaría por email; aquí se devuelve para la demo.
  return { token };
}

export function verifyEmail(db: Database.Database, raw: string): void {
  const userId = consumeToken(db, 'email_verify', raw);
  db.prepare(`UPDATE users SET email_verified = 1 WHERE id = ?`).run(userId);
  audit(db, 'email_verified', { userId });
}

// --- Restablecimiento de contraseña ---

export function requestPasswordReset(db: Database.Database, email: string): { token: string | null } {
  const user = findUserByEmail(db, email);
  // No revelamos si el email existe (anti-enumeración).
  if (!user) return { token: null };
  const token = createToken(db, user.id, 'password_reset', 30);
  audit(db, 'password_reset_requested', { userId: user.id });
  return { token };
}

export function resetPassword(db: Database.Database, raw: string, newPassword: string): void {
  if (newPassword.length < 8) throw new AppError(400, 'weak_password', 'La contraseña debe tener al menos 8 caracteres.');
  const userId = consumeToken(db, 'password_reset', raw);
  db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(bcrypt.hashSync(newPassword, 10), userId);
  // Invalida cualquier otro token de reset pendiente del usuario.
  db.prepare(`UPDATE auth_tokens SET used_at = datetime('now') WHERE user_id = ? AND type = 'password_reset' AND used_at IS NULL`).run(userId);
  audit(db, 'password_reset', { userId });
}

// --- MFA (TOTP) ---

export function setupMfa(db: Database.Database, user: User): { secret: string; otpauthUrl: string } {
  if (user.mfa_enabled) throw new AppError(409, 'mfa_already_enabled', 'El MFA ya está activado.');
  const secret = generateSecret();
  // Guardamos el secreto pero aún no activamos hasta confirmar un código.
  db.prepare(`UPDATE users SET mfa_secret = ? WHERE id = ?`).run(secret, user.id);
  audit(db, 'mfa_setup', { userId: user.id });
  return { secret, otpauthUrl: otpauthUrl(secret, user.email) };
}

export function enableMfa(db: Database.Database, user: User, code: string): void {
  if (!user.mfa_secret) throw new AppError(400, 'mfa_not_setup', 'Primero debe iniciar la configuración de MFA.');
  if (!verifyTotp(user.mfa_secret, code)) throw new AppError(400, 'mfa_invalid', 'Código MFA incorrecto.');
  db.prepare(`UPDATE users SET mfa_enabled = 1 WHERE id = ?`).run(user.id);
  audit(db, 'mfa_enabled', { userId: user.id });
}

export function disableMfa(db: Database.Database, user: User, code: string): void {
  if (!user.mfa_enabled || !user.mfa_secret) return;
  if (!verifyTotp(user.mfa_secret, code)) throw new AppError(400, 'mfa_invalid', 'Código MFA incorrecto.');
  db.prepare(`UPDATE users SET mfa_enabled = 0, mfa_secret = NULL WHERE id = ?`).run(user.id);
  audit(db, 'mfa_disabled', { userId: user.id });
}
