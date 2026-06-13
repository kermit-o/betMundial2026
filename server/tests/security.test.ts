import { describe, it, expect } from 'vitest';
import { generateSecret, totp, verifyTotp } from '../src/auth/totp.js';
import {
  requestPasswordReset,
  resetPassword,
  requestEmailVerification,
  verifyEmail,
  setupMfa,
  enableMfa,
} from '../src/auth/security.service.js';
import { login } from '../src/auth/auth.service.js';
import { findUserById } from '../src/auth/users.repo.js';
import bcrypt from 'bcryptjs';
import { AppError } from '../src/types.js';
import { freshDb, makeUser } from './helpers.js';

describe('TOTP', () => {
  it('genera y verifica un código válido', () => {
    const secret = generateSecret();
    const code = totp(secret);
    expect(verifyTotp(secret, code)).toBe(true);
    expect(verifyTotp(secret, '000000')).toBe(false);
  });
});

describe('seguridad de cuenta', () => {
  it('restablece la contraseña con token de un solo uso', () => {
    const db = freshDb();
    const user = makeUser(db, { email: 'reset@test.com', password_hash: bcrypt.hashSync('OldPass1!', 8) });
    const { token } = requestPasswordReset(db, 'reset@test.com');
    expect(token).toBeTruthy();
    resetPassword(db, token!, 'NewPass1!');
    const updated = findUserById(db, user.id)!;
    expect(bcrypt.compareSync('NewPass1!', updated.password_hash)).toBe(true);
    // El token no puede reutilizarse.
    expect(() => resetPassword(db, token!, 'Another1!')).toThrowError(AppError);
  });

  it('no revela si el email existe', () => {
    const db = freshDb();
    const res = requestPasswordReset(db, 'noexiste@test.com');
    expect(res.token).toBeNull();
  });

  it('verifica el email mediante token', () => {
    const db = freshDb();
    const user = makeUser(db, { email_verified: 0 });
    const { token } = requestEmailVerification(db, user);
    verifyEmail(db, token);
    expect(findUserById(db, user.id)!.email_verified).toBe(1);
  });

  it('activa MFA y luego exige el código en el login', () => {
    const db = freshDb();
    const user = makeUser(db, { email: 'mfa@test.com', password_hash: bcrypt.hashSync('Password1!', 8) });
    const { secret } = setupMfa(db, user);
    enableMfa(db, findUserById(db, user.id)!, totp(secret));

    // Login sin código -> mfa_required
    try {
      login(db, 'mfa@test.com', 'Password1!', null);
      expect.fail('debería pedir MFA');
    } catch (e) {
      expect((e as AppError).code).toBe('mfa_required');
    }
    // Login con código válido -> ok
    const ok = login(db, 'mfa@test.com', 'Password1!', null, totp(secret));
    expect(ok.token).toBeTruthy();
  });
});
