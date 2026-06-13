import { nanoid } from 'nanoid';
import type { Db, Executor } from '../db/index.js';
import { AppError, type Bet, type BetLeg, type Market, type Selection, type User } from '../types.js';
import { audit } from '../utils/audit.js';
import { computePayout } from '../utils/money.js';
import { nowIso } from '../utils/time.js';
import { applyLedgerEntry } from '../wallet/wallet.service.js';
import { assertCanBet, assertLossLimitNotExceeded } from '../compliance/compliance.service.js';
import { enforceBetRisk } from '../fraud/fraud.service.js';
import { getJurisdictionRule } from '../compliance/jurisdictions.js';
import { findUserById } from '../auth/users.repo.js';

/** Margen del operador aplicado al valor de cash-out (5%). */
const CASHOUT_MARGIN = 0.05;
/** Máximo de selecciones en una combinada. */
const MAX_LEGS = 12;

export interface BetLegInput {
  selectionId: string;
  expectedOdds: number;
}

export interface PlaceBetInput {
  legs: BetLegInput[];
  stake: number; // minor units
}

interface ResolvedLeg {
  selection: Selection;
  market: Market;
  matchId: string;
}

export async function placeBet(db: Db, user: User, input: PlaceBetInput, ip: string | null): Promise<Bet> {
  if (!Number.isInteger(input.stake) || input.stake <= 0) {
    throw new AppError(400, 'invalid_stake', 'El importe de la apuesta debe ser un entero positivo.');
  }
  if (!Array.isArray(input.legs) || input.legs.length === 0) {
    throw new AppError(400, 'no_selections', 'Debe incluir al menos una selección.');
  }
  if (input.legs.length > MAX_LEGS) {
    throw new AppError(400, 'too_many_legs', `Una combinada admite como máximo ${MAX_LEGS} selecciones.`);
  }

  // --- Cumplimiento previo ---
  assertCanBet(user);
  const rule = getJurisdictionRule(user.jurisdiction);
  if (input.stake > rule.maxStake) {
    throw new AppError(403, 'stake_too_high', `La apuesta supera el máximo permitido (${rule.maxStake}).`);
  }
  await assertLossLimitNotExceeded(db, user, input.stake);

  // --- Resolver y validar cada selección ---
  const resolved: ResolvedLeg[] = [];
  const seenMatches = new Set<string>();
  const seenSelections = new Set<string>();

  for (const leg of input.legs) {
    if (seenSelections.has(leg.selectionId)) {
      throw new AppError(400, 'duplicate_selection', 'No puede repetir la misma selección en el boleto.');
    }
    seenSelections.add(leg.selectionId);

    const selection = await db.oneOrNone<Selection>(`SELECT * FROM selections WHERE id = $1`, [leg.selectionId]);
    if (!selection) throw new AppError(404, 'selection_not_found', 'Selección no encontrada.');

    const market = await db.oneOrNone<Market>(`SELECT * FROM markets WHERE id = $1`, [selection.market_id]);
    if (!market) throw new AppError(404, 'market_not_found', 'Mercado no encontrado.');
    if (market.status !== 'open') {
      throw new AppError(409, 'market_closed', 'Un mercado del boleto está suspendido o cerrado.');
    }

    const match = await db.oneOrNone<{ status: string }>(`SELECT status FROM matches WHERE id = $1`, [market.match_id]);
    if (!match) throw new AppError(404, 'match_not_found', 'Partido no encontrado.');
    if (match.status === 'finished' || match.status === 'cancelled') {
      throw new AppError(409, 'match_closed', 'Un partido del boleto ya no admite apuestas.');
    }

    if (input.legs.length > 1 && seenMatches.has(market.match_id)) {
      throw new AppError(409, 'same_match_combo', 'Una combinada no puede incluir dos selecciones del mismo partido.');
    }
    seenMatches.add(market.match_id);

    if (Math.abs(selection.odds - leg.expectedOdds) > 1e-9) {
      throw new AppError(409, 'odds_changed', 'La cuota ha cambiado. Revise el boleto e inténtelo de nuevo.');
    }

    resolved.push({ selection, market, matchId: market.match_id });
  }

  const totalOdds = Math.round(resolved.reduce((acc, r) => acc * r.selection.odds, 1) * 100) / 100;
  const isCombo = resolved.length > 1;

  const risk = await enforceBetRisk(db, { user, stake: input.stake, odds: totalOdds, maxStake: rule.maxStake, ip });

  const potentialPayout = computePayout(input.stake, totalOdds);
  const betId = nanoid();
  const bet: Bet = {
    id: betId,
    user_id: user.id,
    type: isCombo ? 'combo' : 'single',
    stake: input.stake,
    total_odds: totalOdds,
    potential_payout: potentialPayout,
    status: 'open',
    cash_out_value: null,
    risk_score: risk.score,
    placed_at: nowIso(),
    settled_at: null,
  };

  // --- Operación atómica: debitar saldo + crear boleto y patas ---
  await db.tx(async (t) => {
    await applyLedgerEntry(t, user.id, 'bet_stake', -input.stake, bet.id);
    await t.none(
      `INSERT INTO bets (id, user_id, type, stake, total_odds, potential_payout, status,
        cash_out_value, risk_score, placed_at, settled_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [bet.id, bet.user_id, bet.type, bet.stake, bet.total_odds, bet.potential_payout, bet.status,
       bet.cash_out_value, bet.risk_score, bet.placed_at, bet.settled_at],
    );
    for (const r of resolved) {
      await t.none(
        `INSERT INTO bet_legs (id, bet_id, selection_id, market_id, match_id, odds, result)
         VALUES ($1,$2,$3,$4,$5,$6,'pending')`,
        [nanoid(), betId, r.selection.id, r.market.id, r.matchId, r.selection.odds],
      );
    }
    await audit(t, 'bet_placed', {
      userId: user.id,
      detail: { betId, type: bet.type, legs: resolved.length, stake: bet.stake, totalOdds, riskScore: risk.score },
      ip,
    });
  });

  return bet;
}

export interface BetWithLegs extends Bet {
  legs: BetLeg[];
  cashOutValue: number | null;
}

export async function getBetWithLegs(db: Executor, betId: string): Promise<BetWithLegs | undefined> {
  const bet = await db.oneOrNone<Bet>(`SELECT * FROM bets WHERE id = $1`, [betId]);
  if (!bet) return undefined;
  const legs = await db.query<BetLeg>(`SELECT * FROM bet_legs WHERE bet_id = $1`, [betId]);
  return { ...bet, legs, cashOutValue: bet.status === 'open' ? await computeCashOutValue(db, bet, legs) : null };
}

export async function listUserBets(db: Executor, userId: string, limit = 50): Promise<BetWithLegs[]> {
  const bets = await db.query<Bet>(`SELECT * FROM bets WHERE user_id = $1 ORDER BY placed_at DESC LIMIT $2`, [userId, limit]);
  const out: BetWithLegs[] = [];
  for (const bet of bets) {
    const legs = await db.query<BetLeg>(`SELECT * FROM bet_legs WHERE bet_id = $1`, [bet.id]);
    out.push({ ...bet, legs, cashOutValue: bet.status === 'open' ? await computeCashOutValue(db, bet, legs) : null });
  }
  return out;
}

/**
 * Valor de cash-out actual de una apuesta abierta, o null si no es posible.
 */
export async function computeCashOutValue(db: Executor, bet: Bet, legs: BetLeg[]): Promise<number | null> {
  if (bet.status !== 'open') return null;

  let wonFactor = 1;
  let lockedRemaining = 1;
  let currentRemaining = 1;

  for (const leg of legs) {
    if (leg.result === 'lost') return null;
    if (leg.result === 'won') {
      wonFactor *= leg.odds;
      continue;
    }
    if (leg.result === 'void') continue;
    const match = await db.oneOrNone<{ status: string }>(`SELECT status FROM matches WHERE id = $1`, [leg.match_id]);
    if (!match || match.status === 'finished' || match.status === 'cancelled') return null;
    const sel = await db.oneOrNone<{ odds: number }>(`SELECT odds FROM selections WHERE id = $1`, [leg.selection_id]);
    if (!sel) return null;
    lockedRemaining *= leg.odds;
    currentRemaining *= sel.odds;
  }

  if (currentRemaining === 1 && lockedRemaining === 1) {
    return bet.potential_payout;
  }
  const fairValue = bet.stake * wonFactor * (lockedRemaining / currentRemaining);
  return Math.max(0, Math.floor(fairValue * (1 - CASHOUT_MARGIN)));
}

export async function cashOut(db: Db, user: User, betId: string, ip: string | null): Promise<{ value: number; balance: number }> {
  const bet = await db.oneOrNone<Bet>(`SELECT * FROM bets WHERE id = $1`, [betId]);
  if (!bet || bet.user_id !== user.id) throw new AppError(404, 'bet_not_found', 'Apuesta no encontrada.');
  if (bet.status !== 'open') throw new AppError(409, 'bet_not_open', 'La apuesta no admite cash-out.');

  const legs = await db.query<BetLeg>(`SELECT * FROM bet_legs WHERE bet_id = $1`, [betId]);
  const value = await computeCashOutValue(db, bet, legs);
  if (value == null) throw new AppError(409, 'cashout_unavailable', 'El cash-out no está disponible para esta apuesta ahora mismo.');

  const balance = await db.tx(async (t) => {
    const tx = await applyLedgerEntry(t, user.id, 'cashout', value, bet.id);
    await t.none(`UPDATE bets SET status='cashed_out', cash_out_value=$1, settled_at=$2 WHERE id=$3`, [value, nowIso(), bet.id]);
    await audit(t, 'bet_cashed_out', { userId: user.id, detail: { betId, value }, ip });
    return tx.balance_after;
  });
  return { value, balance };
}

/** Reload helper used by routes to fetch a fresh User from the DB. */
export async function requireUser(db: Executor, userId: string): Promise<User> {
  const user = await findUserById(db, userId);
  if (!user) throw new AppError(401, 'user_not_found', 'Usuario no encontrado.');
  return user;
}
