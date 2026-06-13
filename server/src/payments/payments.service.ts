import { nanoid } from 'nanoid';
import type { Db, Executor } from '../db/index.js';
import { AppError, type PaymentIntent, type User } from '../types.js';
import { audit } from '../utils/audit.js';
import { nowIso } from '../utils/time.js';
import { applyLedgerEntry } from '../wallet/wallet.service.js';
import { assertDepositWithinLimit } from '../compliance/compliance.service.js';
import { screenTransaction } from '../fraud/fraud.service.js';
import { getPaymentProvider, type WebhookEvent } from './index.js';

async function findIntentByKey(db: Executor, userId: string, key: string): Promise<PaymentIntent | undefined> {
  return db.oneOrNone<PaymentIntent>(
    `SELECT * FROM payment_intents WHERE user_id = $1 AND idempotency_key = $2`,
    [userId, key],
  );
}

async function insertIntent(db: Executor, intent: PaymentIntent): Promise<void> {
  await db.none(
    `INSERT INTO payment_intents (id, user_id, provider, type, amount, currency, status,
       idempotency_key, provider_ref, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      intent.id, intent.user_id, intent.provider, intent.type, intent.amount, intent.currency,
      intent.status, intent.idempotency_key, intent.provider_ref, intent.created_at, intent.updated_at,
    ],
  );
}

async function balanceOf(db: Executor, userId: string): Promise<number> {
  const row = await db.oneOrNone<{ balance: number }>(`SELECT balance FROM wallets WHERE user_id = $1`, [userId]);
  return row?.balance ?? 0;
}

/**
 * Acreditar un depósito completado en la cartera (una sola vez). Idempotente:
 * comprueba el estado en BD para no acreditar dos veces (webhook + síncrono).
 */
async function creditDeposit(db: Db, intent: PaymentIntent): Promise<void> {
  await db.tx(async (t) => {
    const current = await t.oneOrNone<{ status: string }>(
      `SELECT status FROM payment_intents WHERE id = $1 FOR UPDATE`,
      [intent.id],
    );
    if (!current || current.status === 'completed') return;
    await applyLedgerEntry(t, intent.user_id, 'deposit', intent.amount, intent.id);
    await screenTransaction(t, intent.user_id, 'deposit', intent.amount);
    await t.none(`UPDATE payment_intents SET status='completed', updated_at=$1 WHERE id=$2`, [nowIso(), intent.id]);
    await audit(t, 'deposit_completed', { userId: intent.user_id, detail: { intentId: intent.id, amount: intent.amount } });
  });
}

export interface InitiateResult {
  intent: PaymentIntent;
  balance: number;
}

export async function initiateDeposit(
  db: Db,
  user: User,
  amount: number,
  idempotencyKey: string,
  ip: string | null,
): Promise<InitiateResult> {
  if (amount <= 0) throw new AppError(400, 'invalid_amount', 'El importe debe ser positivo.');

  const existing = await findIntentByKey(db, user.id, idempotencyKey);
  if (existing) return { intent: existing, balance: await balanceOf(db, user.id) };

  await assertDepositWithinLimit(db, user, amount);

  const provider = getPaymentProvider();
  const id = nanoid();
  const now = nowIso();
  const result = provider.createDeposit({ intentId: id, userId: user.id, amount, currency: user.currency });

  const intent: PaymentIntent = {
    id,
    user_id: user.id,
    provider: provider.name,
    type: 'deposit',
    amount,
    currency: user.currency,
    status: 'pending',
    idempotency_key: idempotencyKey,
    provider_ref: result.providerRef,
    created_at: now,
    updated_at: now,
  };
  await insertIntent(db, intent);
  await audit(db, 'deposit_initiated', { userId: user.id, detail: { intentId: id, amount, provider: provider.name }, ip });

  if (result.status === 'completed') {
    await creditDeposit(db, intent);
    intent.status = 'completed';
  }
  return { intent, balance: await balanceOf(db, user.id) };
}

export async function initiatePayout(
  db: Db,
  user: User,
  amount: number,
  idempotencyKey: string,
  ip: string | null,
): Promise<InitiateResult> {
  if (amount <= 0) throw new AppError(400, 'invalid_amount', 'El importe debe ser positivo.');
  if (user.kyc_status !== 'verified') {
    throw new AppError(403, 'kyc_required', 'Debe completar la verificación KYC antes de retirar fondos.');
  }

  const existing = await findIntentByKey(db, user.id, idempotencyKey);
  if (existing) return { intent: existing, balance: await balanceOf(db, user.id) };

  const provider = getPaymentProvider();
  const id = nanoid();
  const now = nowIso();
  const result = provider.createPayout({ intentId: id, userId: user.id, amount, currency: user.currency });
  const intent: PaymentIntent = {
    id,
    user_id: user.id,
    provider: provider.name,
    type: 'payout',
    amount,
    currency: user.currency,
    status: result.status,
    idempotency_key: idempotencyKey,
    provider_ref: result.providerRef,
    created_at: now,
    updated_at: now,
  };

  await db.tx(async (t) => {
    await applyLedgerEntry(t, user.id, 'withdrawal', -amount, id);
    await screenTransaction(t, user.id, 'withdrawal', amount);
    await insertIntent(t, intent);
    await audit(t, 'payout_initiated', { userId: user.id, detail: { intentId: id, amount }, ip });
  });

  return { intent, balance: await balanceOf(db, user.id) };
}

/** Procesa un webhook firmado del proveedor (confirmaciones asíncronas). */
export async function handleWebhook(db: Db, rawBody: string, signature: string | undefined): Promise<{ ok: boolean }> {
  const provider = getPaymentProvider();
  if (!provider.verifyWebhookSignature(rawBody, signature)) {
    throw new AppError(401, 'invalid_signature', 'Firma de webhook inválida.');
  }
  let event: WebhookEvent;
  try {
    event = provider.parseWebhook(JSON.parse(rawBody));
  } catch {
    throw new AppError(400, 'invalid_payload', 'Payload de webhook inválido.');
  }

  const intent = await db.oneOrNone<PaymentIntent>(`SELECT * FROM payment_intents WHERE provider_ref = $1`, [event.providerRef]);
  if (!intent) return { ok: true };

  if (intent.type === 'deposit' && event.status === 'completed') {
    await creditDeposit(db, intent);
  } else if (event.status === 'failed') {
    await db.none(`UPDATE payment_intents SET status='failed', updated_at=$1 WHERE id=$2`, [nowIso(), intent.id]);
    await audit(db, 'payment_failed', { userId: intent.user_id, detail: { intentId: intent.id } });
  }
  return { ok: true };
}

export async function listPaymentIntents(db: Executor, userId: string, limit = 50): Promise<PaymentIntent[]> {
  return db.query<PaymentIntent>(
    `SELECT * FROM payment_intents WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [userId, limit],
  );
}
