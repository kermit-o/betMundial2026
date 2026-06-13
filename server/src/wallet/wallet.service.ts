import type Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import { AppError, type Transaction, type TransactionType, type User } from '../types.js';
import { audit } from '../utils/audit.js';
import { assertDepositWithinLimit } from '../compliance/compliance.service.js';
import { screenTransaction } from '../fraud/fraud.service.js';

export function getBalance(db: Database.Database, userId: string): number {
  const row = db.prepare(`SELECT balance FROM wallets WHERE user_id = ?`).get(userId) as
    | { balance: number }
    | undefined;
  if (!row) throw new AppError(404, 'wallet_not_found', 'Cartera no encontrada.');
  return row.balance;
}

/**
 * Aplica un movimiento de saldo de forma atómica y deja traza en transactions.
 * Debe invocarse dentro de una transacción SQLite cuando forme parte de una
 * operación compuesta (p.ej. colocar una apuesta).
 */
export function applyLedgerEntry(
  db: Database.Database,
  userId: string,
  type: TransactionType,
  amount: number,
  refId: string | null,
  status: string = 'completed',
): Transaction {
  const wallet = db.prepare(`SELECT balance, currency FROM wallets WHERE user_id = ?`).get(userId) as
    | { balance: number; currency: string }
    | undefined;
  if (!wallet) throw new AppError(404, 'wallet_not_found', 'Cartera no encontrada.');

  const newBalance = wallet.balance + amount;
  if (newBalance < 0) {
    throw new AppError(402, 'insufficient_funds', 'Saldo insuficiente para completar la operación.');
  }

  db.prepare(`UPDATE wallets SET balance = ? WHERE user_id = ?`).run(newBalance, userId);

  const tx: Transaction = {
    id: nanoid(),
    user_id: userId,
    type,
    amount,
    balance_after: newBalance,
    ref_id: refId,
    status,
    created_at: new Date().toISOString(),
  };
  db.prepare(
    `INSERT INTO transactions (id, user_id, type, amount, balance_after, ref_id, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(tx.id, tx.user_id, tx.type, tx.amount, tx.balance_after, tx.ref_id, tx.status);

  return tx;
}

export function deposit(db: Database.Database, user: User, amount: number, ip: string | null): Transaction {
  if (amount <= 0) throw new AppError(400, 'invalid_amount', 'El importe debe ser positivo.');
  assertDepositWithinLimit(db, user, amount);

  const run = db.transaction(() => {
    const tx = applyLedgerEntry(db, user.id, 'deposit', amount, null);
    screenTransaction(db, user.id, 'deposit', amount);
    audit(db, 'deposit', { userId: user.id, detail: { amount }, ip });
    return tx;
  });
  return run();
}

export function withdraw(db: Database.Database, user: User, amount: number, ip: string | null): Transaction {
  if (amount <= 0) throw new AppError(400, 'invalid_amount', 'El importe debe ser positivo.');
  if (user.kyc_status !== 'verified') {
    throw new AppError(403, 'kyc_required', 'Debe completar la verificación KYC antes de retirar fondos.');
  }

  const run = db.transaction(() => {
    const tx = applyLedgerEntry(db, user.id, 'withdrawal', -amount, null);
    screenTransaction(db, user.id, 'withdrawal', amount);
    audit(db, 'withdrawal', { userId: user.id, detail: { amount }, ip });
    return tx;
  });
  return run();
}

export function listTransactions(db: Database.Database, userId: string, limit = 50): Transaction[] {
  return db
    .prepare(`SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`)
    .all(userId, limit) as Transaction[];
}
