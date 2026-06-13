import type Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import { AppError, type PaymentIntent, type User } from '../types.js';
import { audit } from '../utils/audit.js';
import { applyLedgerEntry } from '../wallet/wallet.service.js';
import { assertDepositWithinLimit } from '../compliance/compliance.service.js';
import { screenTransaction } from '../fraud/fraud.service.js';
import { getPaymentProvider, type WebhookEvent } from './index.js';

function findIntentByKey(db: Database.Database, userId: string, key: string): PaymentIntent | undefined {
  return db
    .prepare(`SELECT * FROM payment_intents WHERE user_id = ? AND idempotency_key = ?`)
    .get(userId, key) as PaymentIntent | undefined;
}

function insertIntent(db: Database.Database, intent: PaymentIntent): void {
  db.prepare(
    `INSERT INTO payment_intents (id, user_id, provider, type, amount, currency, status,
       idempotency_key, provider_ref, created_at, updated_at)
     VALUES (@id,@user_id,@provider,@type,@amount,@currency,@status,@idempotency_key,@provider_ref,@created_at,@updated_at)`,
  ).run(intent);
}

/**
 * Acreditar un depósito completado en la cartera (una sola vez). Idempotente:
 * marca el intent como completed sólo si estaba pending.
 */
function creditDeposit(db: Database.Database, intent: PaymentIntent): void {
  // Consultamos el estado actual en BD para no acreditar dos veces (webhook + síncrono).
  const current = db.prepare(`SELECT status FROM payment_intents WHERE id = ?`).get(intent.id) as
    | { status: string }
    | undefined;
  if (!current || current.status === 'completed') return;
  const run = db.transaction(() => {
    applyLedgerEntry(db, intent.user_id, 'deposit', intent.amount, intent.id);
    screenTransaction(db, intent.user_id, 'deposit', intent.amount);
    db.prepare(`UPDATE payment_intents SET status='completed', updated_at=datetime('now') WHERE id=?`).run(intent.id);
    audit(db, 'deposit_completed', { userId: intent.user_id, detail: { intentId: intent.id, amount: intent.amount } });
  });
  run();
}

export interface InitiateResult {
  intent: PaymentIntent;
  balance: number | null;
}

export function initiateDeposit(
  db: Database.Database,
  user: User,
  amount: number,
  idempotencyKey: string,
  ip: string | null,
): InitiateResult {
  if (amount <= 0) throw new AppError(400, 'invalid_amount', 'El importe debe ser positivo.');

  // Idempotencia: si ya existe un intent con esta clave, devolver el mismo.
  const existing = findIntentByKey(db, user.id, idempotencyKey);
  if (existing) {
    const balance = db.prepare(`SELECT balance FROM wallets WHERE user_id=?`).get(user.id) as { balance: number };
    return { intent: existing, balance: balance.balance };
  }

  assertDepositWithinLimit(db, user, amount);

  const provider = getPaymentProvider();
  const id = nanoid();
  const now = new Date().toISOString();
  const result = provider.createDeposit({ intentId: id, userId: user.id, amount, currency: user.currency });

  // El intent nace 'pending'; sólo pasa a 'completed' al acreditar el saldo.
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
  insertIntent(db, intent);
  audit(db, 'deposit_initiated', { userId: user.id, detail: { intentId: id, amount, provider: provider.name }, ip });

  // Si el proveedor confirma de forma síncrona, acreditar ya.
  if (result.status === 'completed') {
    creditDeposit(db, intent);
    intent.status = 'completed';
  }

  const balance = db.prepare(`SELECT balance FROM wallets WHERE user_id=?`).get(user.id) as { balance: number };
  return { intent, balance: balance.balance };
}

export function initiatePayout(
  db: Database.Database,
  user: User,
  amount: number,
  idempotencyKey: string,
  ip: string | null,
): InitiateResult {
  if (amount <= 0) throw new AppError(400, 'invalid_amount', 'El importe debe ser positivo.');
  if (user.kyc_status !== 'verified') {
    throw new AppError(403, 'kyc_required', 'Debe completar la verificación KYC antes de retirar fondos.');
  }

  const existing = findIntentByKey(db, user.id, idempotencyKey);
  if (existing) {
    const balance = db.prepare(`SELECT balance FROM wallets WHERE user_id=?`).get(user.id) as { balance: number };
    return { intent: existing, balance: balance.balance };
  }

  const provider = getPaymentProvider();
  const id = nanoid();
  const now = new Date().toISOString();

  // Debitar el saldo de forma atómica al iniciar el retiro (reserva de fondos).
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

  const run = db.transaction(() => {
    applyLedgerEntry(db, user.id, 'withdrawal', -amount, id);
    screenTransaction(db, user.id, 'withdrawal', amount);
    insertIntent(db, intent);
    audit(db, 'payout_initiated', { userId: user.id, detail: { intentId: id, amount }, ip });
  });
  run();

  const balance = db.prepare(`SELECT balance FROM wallets WHERE user_id=?`).get(user.id) as { balance: number };
  return { intent, balance: balance.balance };
}

/** Procesa un webhook firmado del proveedor (confirmaciones asíncronas). */
export function handleWebhook(db: Database.Database, rawBody: string, signature: string | undefined): { ok: boolean } {
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

  const intent = db.prepare(`SELECT * FROM payment_intents WHERE provider_ref = ?`).get(event.providerRef) as
    | PaymentIntent
    | undefined;
  if (!intent) return { ok: true }; // desconocido: aceptamos sin actuar (idempotente)

  if (intent.type === 'deposit' && event.status === 'completed') {
    creditDeposit(db, intent);
  } else if (event.status === 'failed') {
    db.prepare(`UPDATE payment_intents SET status='failed', updated_at=datetime('now') WHERE id=?`).run(intent.id);
    audit(db, 'payment_failed', { userId: intent.user_id, detail: { intentId: intent.id } });
  }
  return { ok: true };
}

export function listPaymentIntents(db: Database.Database, userId: string, limit = 50): PaymentIntent[] {
  return db
    .prepare(`SELECT * FROM payment_intents WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`)
    .all(userId, limit) as PaymentIntent[];
}
