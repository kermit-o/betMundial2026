import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { nanoid } from 'nanoid';
import { config } from '../config.js';
import type { Db } from '../db/index.js';
import { AppError, type AuthUser, type User } from '../types.js';
import { audit } from '../utils/audit.js';
import { nowIso } from '../utils/time.js';
import { meetsMinAge } from '../compliance/compliance.service.js';
import { getJurisdictionRule, isJurisdictionAllowed } from '../compliance/jurisdictions.js';
import { createWallet, findUserByEmail, insertUser } from './users.repo.js';
import { verifyTotp } from './totp.js';

export interface RegisterInput {
  email: string;
  password: string;
  fullName: string;
  dateOfBirth: string;
  jurisdiction: string;
  acceptTerms: boolean;
}

const BCRYPT_ROUNDS = 10;

export async function register(
  db: Db,
  input: RegisterInput,
  ip: string | null,
  operatorId: string,
): Promise<{ user: User; token: string }> {
  const jurisdiction = input.jurisdiction.toUpperCase();

  // --- Cumplimiento: jurisdicción, edad, términos ---
  if (!isJurisdictionAllowed(jurisdiction)) {
    throw new AppError(403, 'jurisdiction_blocked', 'El servicio no está disponible en su jurisdicción.');
  }
  if (!input.acceptTerms) {
    throw new AppError(400, 'terms_required', 'Debe aceptar los términos y condiciones.');
  }
  if (!meetsMinAge(input.dateOfBirth, jurisdiction)) {
    throw new AppError(403, 'underage', 'No cumple la edad mínima requerida en su jurisdicción.');
  }
  if (await findUserByEmail(db, input.email)) {
    throw new AppError(409, 'email_taken', 'Ya existe una cuenta con ese correo.');
  }

  const rule = getJurisdictionRule(jurisdiction);
  const now = nowIso();
  const user: User = {
    id: nanoid(),
    operator_id: operatorId,
    email: input.email.toLowerCase(),
    password_hash: bcrypt.hashSync(input.password, BCRYPT_ROUNDS),
    full_name: input.fullName,
    date_of_birth: input.dateOfBirth,
    jurisdiction,
    currency: rule.currency,
    role: 'user',
    kyc_status: 'pending',
    email_verified: 0,
    mfa_enabled: 0,
    mfa_secret: null,
    self_excluded_until: null,
    daily_deposit_limit: rule.defaultDailyDepositLimit,
    daily_loss_limit: null,
    pending_deposit_limit: null,
    pending_deposit_effective: null,
    pending_loss_limit: null,
    pending_loss_effective: null,
    terms_accepted_at: now,
    signup_ip: ip,
    created_at: now,
  };

  await db.tx(async (t) => {
    await insertUser(t, user);
    await createWallet(t, user.id, user.currency);
    await audit(t, 'register', { userId: user.id, detail: { jurisdiction }, ip });
  });

  return { user, token: issueToken(user) };
}

export async function login(
  db: Db,
  email: string,
  password: string,
  ip: string | null,
  mfaCode?: string,
): Promise<{ user: User; token: string }> {
  const user = await findUserByEmail(db, email);
  // Comparación en tiempo (casi) constante: ejecutamos bcrypt aunque no exista.
  const ok = user
    ? bcrypt.compareSync(password, user.password_hash)
    : bcrypt.compareSync(password, '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidi');
  if (!user || !ok) {
    await audit(db, 'login_failed', { detail: { email }, ip });
    throw new AppError(401, 'invalid_credentials', 'Credenciales incorrectas.');
  }
  // Segundo factor: si el usuario tiene MFA activo, exigir un TOTP válido.
  if (user.mfa_enabled && user.mfa_secret) {
    if (!mfaCode) throw new AppError(401, 'mfa_required', 'Introduzca el código de verificación (MFA).');
    if (!verifyTotp(user.mfa_secret, mfaCode)) {
      await audit(db, 'mfa_failed', { userId: user.id, ip });
      throw new AppError(401, 'mfa_invalid', 'Código MFA incorrecto.');
    }
  }
  await audit(db, 'login', { userId: user.id, ip });
  return { user, token: issueToken(user) };
}

export function issueToken(user: User): string {
  const payload: AuthUser = {
    id: user.id,
    operator_id: user.operator_id,
    email: user.email,
    role: user.role,
    jurisdiction: user.jurisdiction,
  };
  return jwt.sign(payload, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

export function verifyToken(token: string): AuthUser {
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as jwt.JwtPayload & AuthUser;
    return {
      id: decoded.id,
      operator_id: decoded.operator_id,
      email: decoded.email,
      role: decoded.role,
      jurisdiction: decoded.jurisdiction,
    };
  } catch {
    throw new AppError(401, 'invalid_token', 'Sesión inválida o expirada.');
  }
}
