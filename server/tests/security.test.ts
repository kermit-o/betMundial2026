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
  it('restablece la contraseña con token de un solo uso', async () => {
    const db = await freshDb();
    const user = await makeUser(db, { email: 'reset@test.com', password_hash: bcrypt.hashSync('OldPass1!', 8) });
    const { token } = await requestPasswordReset(db, 'reset@test.com');
    expect(token).toBeTruthy();
    await resetPassword(db, token!, 'NewPass1!');
    const updated = (await findUserById(db, user.id))!;
    expect(bcrypt.compareSync('NewPass1!', updated.password_hash)).toBe(true);
    await expect(resetPassword(db, token!, 'Another1!')).rejects.toBeInstanceOf(AppError);
    await db.close();
  });

  it('no revela si el email existe', async () => {
    const db = await freshDb();
    const res = await requestPasswordReset(db, 'noexiste@test.com');
    expect(res.token).toBeNull();
    await db.close();
  });

  it('verifica el email mediante token', async () => {
    const db = await freshDb();
    const user = await makeUser(db, { email_verified: 0 });
    const { token } = await requestEmailVerification(db, user);
    await verifyEmail(db, token);
    expect((await findUserById(db, user.id))!.email_verified).toBe(1);
    await db.close();
  });

  it('activa MFA y luego exige el código en el login', async () => {
    const db = await freshDb();
    const user = await makeUser(db, { email: 'mfa@test.com', password_hash: bcrypt.hashSync('Password1!', 8) });
    const { secret } = await setupMfa(db, user);
    await enableMfa(db, (await findUserById(db, user.id))!, totp(secret));

    try {
      await login(db, 'mfa@test.com', 'Password1!', null);
      expect.fail('debería pedir MFA');
    } catch (e) {
      expect((e as AppError).code).toBe('mfa_required');
    }
    const ok = await login(db, 'mfa@test.com', 'Password1!', null, totp(secret));
    expect(ok.token).toBeTruthy();
    await db.close();
  });
});
