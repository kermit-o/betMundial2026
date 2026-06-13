import type Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import { AppError, type Bet, type Market, type Selection, type User } from '../types.js';
import { audit } from '../utils/audit.js';
import { computePayout } from '../utils/money.js';
import { applyLedgerEntry } from '../wallet/wallet.service.js';
import { assertCanBet, assertLossLimitNotExceeded } from '../compliance/compliance.service.js';
import { enforceBetRisk } from '../fraud/fraud.service.js';
import { getJurisdictionRule } from '../compliance/jurisdictions.js';
import { findUserById } from '../auth/users.repo.js';

export interface PlaceBetInput {
  selectionId: string;
  stake: number; // minor units
  /** Cuota que vio el usuario; rechazamos si la real ha cambiado (protección de mercado). */
  expectedOdds: number;
}

export function placeBet(
  db: Database.Database,
  user: User,
  input: PlaceBetInput,
  ip: string | null,
): Bet {
  if (!Number.isInteger(input.stake) || input.stake <= 0) {
    throw new AppError(400, 'invalid_stake', 'El importe de la apuesta debe ser un entero positivo.');
  }

  // --- Cumplimiento previo ---
  assertCanBet(db, user);

  const rule = getJurisdictionRule(user.jurisdiction);
  if (input.stake > rule.maxStake) {
    throw new AppError(403, 'stake_too_high', `La apuesta supera el máximo permitido (${rule.maxStake}).`);
  }
  assertLossLimitNotExceeded(db, user, input.stake);

  // --- Cargar selección y mercado y validar estado ---
  const selection = db.prepare(`SELECT * FROM selections WHERE id = ?`).get(input.selectionId) as
    | Selection
    | undefined;
  if (!selection) throw new AppError(404, 'selection_not_found', 'Selección no encontrada.');

  const market = db.prepare(`SELECT * FROM markets WHERE id = ?`).get(selection.market_id) as
    | Market
    | undefined;
  if (!market) throw new AppError(404, 'market_not_found', 'Mercado no encontrado.');
  if (market.status !== 'open') {
    throw new AppError(409, 'market_closed', 'El mercado está suspendido o cerrado para apuestas.');
  }

  const match = db.prepare(`SELECT status, kickoff FROM matches WHERE id = ?`).get(market.match_id) as
    | { status: string; kickoff: string }
    | undefined;
  if (!match) throw new AppError(404, 'match_not_found', 'Partido no encontrado.');
  if (match.status === 'finished' || match.status === 'cancelled') {
    throw new AppError(409, 'match_closed', 'El partido ya no admite apuestas.');
  }

  // --- Protección de cuota: rechazar si la cuota se ha movido ---
  if (Math.abs(selection.odds - input.expectedOdds) > 1e-9) {
    throw new AppError(409, 'odds_changed', 'La cuota ha cambiado. Revise el boleto e inténtelo de nuevo.');
  }

  // --- Antifraude (puede lanzar y bloquear) ---
  const risk = enforceBetRisk(db, {
    user,
    stake: input.stake,
    odds: selection.odds,
    maxStake: rule.maxStake,
    ip,
  });

  const potentialPayout = computePayout(input.stake, selection.odds);
  const bet: Bet = {
    id: nanoid(),
    user_id: user.id,
    selection_id: selection.id,
    market_id: market.id,
    match_id: market.match_id,
    stake: input.stake,
    odds: selection.odds,
    potential_payout: potentialPayout,
    status: 'open',
    risk_score: risk.score,
    placed_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
    settled_at: null,
  };

  // --- Operación atómica: debitar saldo + registrar apuesta ---
  const run = db.transaction(() => {
    applyLedgerEntry(db, user.id, 'bet_stake', -input.stake, bet.id);
    db.prepare(
      `INSERT INTO bets (id, user_id, selection_id, market_id, match_id, stake, odds,
        potential_payout, status, risk_score, placed_at, settled_at)
       VALUES (@id, @user_id, @selection_id, @market_id, @match_id, @stake, @odds,
        @potential_payout, @status, @risk_score, @placed_at, @settled_at)`,
    ).run(bet);
    audit(db, 'bet_placed', {
      userId: user.id,
      detail: { betId: bet.id, stake: bet.stake, odds: bet.odds, riskScore: risk.score },
      ip,
    });
  });
  run();

  return bet;
}

export function listUserBets(db: Database.Database, userId: string, limit = 50): Bet[] {
  return db
    .prepare(`SELECT * FROM bets WHERE user_id = ? ORDER BY placed_at DESC LIMIT ?`)
    .all(userId, limit) as Bet[];
}

/** Reload helper used by routes to fetch a fresh User from the DB. */
export function requireUser(db: Database.Database, userId: string): User {
  const user = findUserById(db, userId);
  if (!user) throw new AppError(401, 'user_not_found', 'Usuario no encontrado.');
  return user;
}
