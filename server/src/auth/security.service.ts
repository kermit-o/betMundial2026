import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import type { Db, Executor } from '../db/index.js';
import { AppError, type User } from '../types.js';
import { audit } from '../utils/audit.js';
import { nowIso } from '../utils/time.js';
import { findUserByEmail } from './users.repo.js';
import { generateSecret, otpauthUrl, verifyTotp } from './totp.js';

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

async function createToken(db: Executor, userId: string, type: string, ttlMinutes: number): Promise<string> {
  const raw = crypto.randomBytes(24).toString('base64url');
  const expires = new Date(Date.now() + ttlMinutes * 60_000).toISOString();
  await db.none(
    `INSERT INTO auth_tokens (id, user_id, type, token_hash, expires_at) VALUES ($1, $2, $3, $4, $5)`,
    [nanoid(), userId, type, sha256(raw), expires],
  );
  return raw;
}

async function consumeToken(db: Executor, type: string, raw: string): Promise<string> {
  const row = await db.oneOrNone<{ id: string; user_id: string; expires_at: string; used_at: string | null }>(
    `SELECT * FROM auth_tokens WHERE token_hash = $1 AND type = $2`,
    [sha256(raw), type],
  );
  if (!row || row.used_at) throw new AppError(400, 'invalid_token', 'Token inválido o ya utilizado.');
  if (new Date(row.expires_at).getTime() < Date.now()) throw new AppError(400, 'expired_token', 'El token ha expirado.');
  await db.none(`UPDATE auth_tokens SET used_at = $1 WHERE id = $2`, [nowIso(), row.id]);
  return row.user_id;
}

// --- Verificación de email ---

export async function requestEmailVerification(db: Db, user: User): Promise<{ token: string }> {
  const token = await createToken(db, user.id, 'email_verify', 60 * 24);
  await audit(db, 'email_verification_requested', { userId: user.id });
  return { token };
}

export async function verifyEmail(db: Db, raw: string): Promise<void> {
  const userId = await consumeToken(db, 'email_verify', raw);
  await db.none(`UPDATE users SET email_verified = 1 WHERE id = $1`, [userId]);
  await audit(db, 'email_verified', { userId });
}

// --- Restablecimiento de contraseña ---

export async function requestPasswordReset(db: Db, email: string): Promise<{ token: string | null }> {
  const user = await findUserByEmail(db, email);
  // No revelamos si el email existe (anti-enumeración).
  if (!user) return { token: null };
  const token = await createToken(db, user.id, 'password_reset', 30);
  await audit(db, 'password_reset_requested', { userId: user.id });
  return { token };
}

export async function resetPassword(db: Db, raw: string, newPassword: string): Promise<void> {
  if (newPassword.length < 8) throw new AppError(400, 'weak_password', 'La contraseña debe tener al menos 8 caracteres.');
  const userId = await consumeToken(db, 'password_reset', raw);
  await db.none(`UPDATE users SET password_hash = $1 WHERE id = $2`, [bcrypt.hashSync(newPassword, 10), userId]);
  // Invalida cualquier otro token de reset pendiente del usuario.
  await db.none(`UPDATE auth_tokens SET used_at = $1 WHERE user_id = $2 AND type = 'password_reset' AND used_at IS NULL`, [nowIso(), userId]);
  await audit(db, 'password_reset', { userId });
}

// --- MFA (TOTP) ---

export async function setupMfa(db: Db, user: User): Promise<{ secret: string; otpauthUrl: string }> {
  if (user.mfa_enabled) throw new AppError(409, 'mfa_already_enabled', 'El MFA ya está activado.');
  const secret = generateSecret();
  await db.none(`UPDATE users SET mfa_secret = $1 WHERE id = $2`, [secret, user.id]);
  await audit(db, 'mfa_setup', { userId: user.id });
  return { secret, otpauthUrl: otpauthUrl(secret, user.email) };
}

export async function enableMfa(db: Db, user: User, code: string): Promise<void> {
  if (!user.mfa_secret) throw new AppError(400, 'mfa_not_setup', 'Primero debe iniciar la configuración de MFA.');
  if (!verifyTotp(user.mfa_secret, code)) throw new AppError(400, 'mfa_invalid', 'Código MFA incorrecto.');
  await db.none(`UPDATE users SET mfa_enabled = 1 WHERE id = $1`, [user.id]);
  await audit(db, 'mfa_enabled', { userId: user.id });
}

export async function disableMfa(db: Db, user: User, code: string): Promise<void> {
  if (!user.mfa_enabled || !user.mfa_secret) return;
  if (!verifyTotp(user.mfa_secret, code)) throw new AppError(400, 'mfa_invalid', 'Código MFA incorrecto.');
  await db.none(`UPDATE users SET mfa_enabled = 0, mfa_secret = NULL WHERE id = $1`, [user.id]);
  await audit(db, 'mfa_disabled', { userId: user.id });
}
