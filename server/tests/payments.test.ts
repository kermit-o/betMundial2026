import { describe, it, expect } from 'vitest';
import { initiateDeposit, initiatePayout, handleWebhook } from '../src/payments/payments.service.js';
import { SandboxPaymentProvider } from '../src/payments/sandbox.js';
import { getBalance } from '../src/wallet/wallet.service.js';
import { AppError } from '../src/types.js';
import { freshDb, makeUser } from './helpers.js';

describe('pagos pluggable (sandbox)', () => {
  it('acredita un depósito y es idempotente por clave', async () => {
    const db = await freshDb();
    const user = await makeUser(db);
    const a = await initiateDeposit(db, user, 20_000, 'key-1', null);
    expect(a.intent.status).toBe('completed');
    expect(await getBalance(db, user.id)).toBe(120_000);

    const b = await initiateDeposit(db, user, 20_000, 'key-1', null);
    expect(b.intent.id).toBe(a.intent.id);
    expect(await getBalance(db, user.id)).toBe(120_000);
    await db.close();
  });

  it('respeta el límite de depósito diario', async () => {
    const db = await freshDb();
    const user = await makeUser(db, { daily_deposit_limit: 10_000 });
    await expect(initiateDeposit(db, user, 20_000, 'k', null)).rejects.toBeInstanceOf(AppError);
    await db.close();
  });

  it('exige KYC para retirar y debita al iniciar el payout', async () => {
    const db = await freshDb();
    const verified = await makeUser(db, { kyc_status: 'verified' });
    await initiateDeposit(db, verified, 30_000, 'd1', null);
    const out = await initiatePayout(db, verified, 10_000, 'w1', null);
    expect(out.intent.type).toBe('payout');
    expect(await getBalance(db, verified.id)).toBe(120_000);

    const pending = await makeUser(db, { kyc_status: 'pending' });
    await expect(initiatePayout(db, pending, 1_000, 'w2', null)).rejects.toThrowError(/KYC/i);
    await db.close();
  });

  it('rechaza webhooks con firma inválida y procesa los firmados', async () => {
    const db = await freshDb();
    const body = JSON.stringify({ providerRef: 'pi_unknown', status: 'completed' });
    await expect(handleWebhook(db, body, 'firma-mala')).rejects.toThrowError(/firma/i);
    const res = await handleWebhook(db, body, SandboxPaymentProvider.sign(body));
    expect(res.ok).toBe(true);
    await db.close();
  });
});
