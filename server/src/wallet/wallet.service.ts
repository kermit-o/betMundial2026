import { nanoid } from 'nanoid';
import type { Executor } from '../db/index.js';
import { AppError, type Transaction, type TransactionType } from '../types.js';
import { nowIso } from '../utils/time.js';

export async function getBalance(db: Executor, userId: string): Promise<number> {
  const row = await db.oneOrNone<{ balance: number }>(`SELECT balance FROM wallets WHERE user_id = $1`, [userId]);
  if (!row) throw new AppError(404, 'wallet_not_found', 'Cartera no encontrada.');
  return row.balance;
}

/**
 * Aplica un movimiento de saldo de forma atómica y deja traza en transactions.
 * Debe invocarse dentro de una transacción (pasar el Executor de la transacción)
 * cuando forme parte de una operación compuesta (p.ej. colocar una apuesta).
 */
export async function applyLedgerEntry(
  db: Executor,
  userId: string,
  type: TransactionType,
  amount: number,
  refId: string | null,
  status = 'completed',
): Promise<Transaction> {
  const wallet = await db.oneOrNone<{ balance: number }>(`SELECT balance FROM wallets WHERE user_id = $1`, [userId]);
  if (!wallet) throw new AppError(404, 'wallet_not_found', 'Cartera no encontrada.');

  const newBalance = wallet.balance + amount;
  if (newBalance < 0) {
    throw new AppError(402, 'insufficient_funds', 'Saldo insuficiente para completar la operación.');
  }

  await db.none(`UPDATE wallets SET balance = $1 WHERE user_id = $2`, [newBalance, userId]);

  const tx: Transaction = {
    id: nanoid(),
    user_id: userId,
    type,
    amount,
    balance_after: newBalance,
    ref_id: refId,
    status,
    created_at: nowIso(),
  };
  await db.none(
    `INSERT INTO transactions (id, user_id, type, amount, balance_after, ref_id, status, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [tx.id, tx.user_id, tx.type, tx.amount, tx.balance_after, tx.ref_id, tx.status, tx.created_at],
  );

  return tx;
}

export async function listTransactions(db: Executor, userId: string, limit = 50): Promise<Transaction[]> {
  return db.query<Transaction>(
    `SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [userId, limit],
  );
}
