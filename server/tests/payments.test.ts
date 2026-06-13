import { describe, it, expect } from 'vitest';
import { initiateDeposit, initiatePayout, handleWebhook } from '../src/payments/payments.service.js';
import { SandboxPaymentProvider } from '../src/payments/sandbox.js';
import { getBalance } from '../src/wallet/wallet.service.js';
import { AppError } from '../src/types.js';
import { freshDb, makeUser } from './helpers.js';

describe('pagos pluggable (sandbox)', () => {
  it('acredita un depósito y es idempotente por clave', () => {
    const db = freshDb();
    const user = makeUser(db); // saldo 100.000
    const a = initiateDeposit(db, user, 20_000, 'key-1', null);
    expect(a.intent.status).toBe('completed');
    expect(getBalance(db, user.id)).toBe(120_000);

    // Reintento con la misma clave: no vuelve a acreditar.
    const b = initiateDeposit(db, user, 20_000, 'key-1', null);
    expect(b.intent.id).toBe(a.intent.id);
    expect(getBalance(db, user.id)).toBe(120_000);
  });

  it('respeta el límite de depósito diario', () => {
    const db = freshDb();
    const user = makeUser(db, { daily_deposit_limit: 10_000 });
    expect(() => initiateDeposit(db, user, 20_000, 'k', null)).toThrowError(AppError);
  });

  it('exige KYC para retirar y debita al iniciar el payout', () => {
    const db = freshDb();
    const verified = makeUser(db, { kyc_status: 'verified' });
    initiateDeposit(db, verified, 30_000, 'd1', null);
    const out = initiatePayout(db, verified, 10_000, 'w1', null);
    expect(out.intent.type).toBe('payout');
    expect(getBalance(db, verified.id)).toBe(120_000); // 100k +30k -10k

    const pending = makeUser(db, { kyc_status: 'pending' });
    expect(() => initiatePayout(db, pending, 1_000, 'w2', null)).toThrowError(/KYC/i);
  });

  it('rechaza webhooks con firma inválida y procesa los firmados', () => {
    const db = freshDb();
    const user = makeUser(db);
    const body = JSON.stringify({ providerRef: 'pi_unknown', status: 'completed' });
    expect(() => handleWebhook(db, body, 'firma-mala')).toThrowError(/firma/i);
    // Firmado correctamente (ref desconocida -> ok sin efecto).
    const res = handleWebhook(db, body, SandboxPaymentProvider.sign(body));
    expect(res.ok).toBe(true);
    void user;
  });
});
