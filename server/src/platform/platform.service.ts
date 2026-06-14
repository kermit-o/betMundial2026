import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { nanoid } from 'nanoid';
import { config } from '../config.js';
import type { Db, Executor } from '../db/index.js';
import { AppError, type PlatformAdmin, type PlatformAuth } from '../types.js';
import { nowIso } from '../utils/time.js';

const BCRYPT_ROUNDS = 10;

export function issuePlatformToken(admin: { id: string; email: string }): string {
  const payload: PlatformAuth = { id: admin.id, email: admin.email, scope: 'platform' };
  return jwt.sign(payload, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

export function verifyPlatformToken(token: string): PlatformAuth {
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as jwt.JwtPayload & Partial<PlatformAuth>;
    if (decoded.scope !== 'platform' || !decoded.id || !decoded.email) {
      throw new Error('not a platform token');
    }
    return { id: decoded.id, email: decoded.email, scope: 'platform' };
  } catch {
    throw new AppError(401, 'invalid_token', 'Sesión de plataforma inválida o expirada.');
  }
}

export async function platformLogin(db: Db, email: string, password: string): Promise<{ token: string; admin: { id: string; email: string } }> {
  const admin = await db.oneOrNone<PlatformAdmin>(
    `SELECT * FROM platform_admins WHERE email = $1`,
    [email.toLowerCase()],
  );
  const ok = admin
    ? bcrypt.compareSync(password, admin.password_hash)
    : bcrypt.compareSync(password, '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidi');
  if (!admin || !ok) {
    throw new AppError(401, 'invalid_credentials', 'Credenciales incorrectas.');
  }
  return { token: issuePlatformToken(admin), admin: { id: admin.id, email: admin.email } };
}

/** Crea o rota el super-admin de plataforma desde la configuración (en arranque). */
export async function ensurePlatformAdmin(db: Db): Promise<void> {
  const prod = config.env === 'production';
  let email = config.platformAdminEmail.trim();
  let password = config.platformAdminPassword;

  if (!email || !password) {
    if (prod) {
      console.warn('[seed] PLATFORM_ADMIN_EMAIL/PASSWORD no configurados: no se crea el super-admin de plataforma.');
      return;
    }
    email = email || 'super@platform.test';
    password = password || 'Super1234!';
    console.warn(`[seed] Super-admin de plataforma (solo desarrollo): ${email} / ${password}`);
  }
  if (prod && password.length < 8) {
    throw new Error('PLATFORM_ADMIN_PASSWORD debe tener al menos 8 caracteres en producción.');
  }

  const normalized = email.toLowerCase();
  const hash = bcrypt.hashSync(password, BCRYPT_ROUNDS);
  const found = await db.oneOrNone<{ id: string }>(`SELECT id FROM platform_admins WHERE email = $1`, [normalized]);
  if (found) {
    await db.none(`UPDATE platform_admins SET password_hash = $2 WHERE id = $1`, [found.id, hash]);
    return;
  }
  await db.none(
    `INSERT INTO platform_admins (id, email, password_hash, full_name, created_at) VALUES ($1,$2,$3,$4,$5)`,
    [nanoid(), normalized, hash, 'Super Admin', nowIso()],
  );
}

export interface Operator {
  id: string;
  name: string;
  slug: string;
  status: string;
  branding: string | null;
  created_at: string;
}

export async function listOperators(db: Executor): Promise<Operator[]> {
  return db.query<Operator>(`SELECT * FROM operators ORDER BY created_at`);
}

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

export async function createOperator(db: Db, name: string, slug: string): Promise<Operator> {
  const cleanSlug = slug.trim().toLowerCase();
  if (!SLUG_RE.test(cleanSlug)) {
    throw new AppError(400, 'invalid_slug', 'El slug debe ser minúsculas, números y guiones (3-32).');
  }
  const exists = await db.oneOrNone(`SELECT 1 FROM operators WHERE slug = $1`, [cleanSlug]);
  if (exists) throw new AppError(409, 'slug_taken', 'Ya existe un operador con ese slug.');

  const op: Operator = {
    id: 'op_' + nanoid(12),
    name: name.trim(),
    slug: cleanSlug,
    status: 'active',
    branding: null,
    created_at: nowIso(),
  };
  await db.none(
    `INSERT INTO operators (id, name, slug, status, branding, created_at) VALUES ($1,$2,$3,$4,$5,$6)`,
    [op.id, op.name, op.slug, op.status, op.branding, op.created_at],
  );
  return op;
}

/** Resuelve un operador por slug (subdominio). Devuelve null si no existe. */
export async function findOperatorBySlug(db: Executor, slug: string): Promise<Operator | undefined> {
  return db.oneOrNone<Operator>(`SELECT * FROM operators WHERE slug = $1`, [slug.toLowerCase()]);
}
