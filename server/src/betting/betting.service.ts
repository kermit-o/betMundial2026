import type Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import { AppError, type Bet, type BetLeg, type Market, type Selection, type User } from '../types.js';
import { audit } from '../utils/audit.js';
import { computePayout } from '../utils/money.js';
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
  /** 1 selección = apuesta simple; 2+ = combinada. */
  legs: BetLegInput[];
  stake: number; // minor units
}

interface ResolvedLeg {
  selection: Selection;
  market: Market;
  matchId: string;
}

export function placeBet(db: Database.Database, user: User, input: PlaceBetInput, ip: string | null): Bet {
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
  assertCanBet(db, user);
  const rule = getJurisdictionRule(user.jurisdiction);
  if (input.stake > rule.maxStake) {
    throw new AppError(403, 'stake_too_high', `La apuesta supera el máximo permitido (${rule.maxStake}).`);
  }
  assertLossLimitNotExceeded(db, user, input.stake);

  // --- Resolver y validar cada selección ---
  const resolved: ResolvedLeg[] = [];
  const seenMatches = new Set<string>();
  const seenSelections = new Set<string>();

  for (const leg of input.legs) {
    if (seenSelections.has(leg.selectionId)) {
      throw new AppError(400, 'duplicate_selection', 'No puede repetir la misma selección en el boleto.');
    }
    seenSelections.add(leg.selectionId);

    const selection = db.prepare(`SELECT * FROM selections WHERE id = ?`).get(leg.selectionId) as Selection | undefined;
    if (!selection) throw new AppError(404, 'selection_not_found', 'Selección no encontrada.');

    const market = db.prepare(`SELECT * FROM markets WHERE id = ?`).get(selection.market_id) as Market | undefined;
    if (!market) throw new AppError(404, 'market_not_found', 'Mercado no encontrado.');
    if (market.status !== 'open') {
      throw new AppError(409, 'market_closed', 'Un mercado del boleto está suspendido o cerrado.');
    }

    const match = db.prepare(`SELECT status FROM matches WHERE id = ?`).get(market.match_id) as { status: string } | undefined;
    if (!match) throw new AppError(404, 'match_not_found', 'Partido no encontrado.');
    if (match.status === 'finished' || match.status === 'cancelled') {
      throw new AppError(409, 'match_closed', 'Un partido del boleto ya no admite apuestas.');
    }

    // Regla de combinada: no se pueden combinar dos selecciones del mismo partido.
    if (input.legs.length > 1 && seenMatches.has(market.match_id)) {
      throw new AppError(409, 'same_match_combo', 'Una combinada no puede incluir dos selecciones del mismo partido.');
    }
    seenMatches.add(market.match_id);

    // Protección de cuota: rechazar si se ha movido.
    if (Math.abs(selection.odds - leg.expectedOdds) > 1e-9) {
      throw new AppError(409, 'odds_changed', 'La cuota ha cambiado. Revise el boleto e inténtelo de nuevo.');
    }

    resolved.push({ selection, market, matchId: market.match_id });
  }

  const totalOdds = Math.round(resolved.reduce((acc, r) => acc * r.selection.odds, 1) * 100) / 100;
  const isCombo = resolved.length > 1;

  // --- Antifraude (sobre la cuota total y el stake) ---
  const risk = enforceBetRisk(db, {
    user,
    stake: input.stake,
    odds: totalOdds,
    maxStake: rule.maxStake,
    ip,
  });

  const potentialPayout = computePayout(input.stake, totalOdds);
  const betId = nanoid();
  const placedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
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
    placed_at: placedAt,
    settled_at: null,
  };

  // --- Operación atómica: debitar saldo + crear boleto y patas ---
  const run = db.transaction(() => {
    applyLedgerEntry(db, user.id, 'bet_stake', -input.stake, bet.id);
    db.prepare(
      `INSERT INTO bets (id, user_id, type, stake, total_odds, potential_payout, status,
        cash_out_value, risk_score, placed_at, settled_at)
       VALUES (@id,@user_id,@type,@stake,@total_odds,@potential_payout,@status,@cash_out_value,@risk_score,@placed_at,@settled_at)`,
    ).run(bet);
    const insertLeg = db.prepare(
      `INSERT INTO bet_legs (id, bet_id, selection_id, market_id, match_id, odds, result)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
    );
    for (const r of resolved) {
      insertLeg.run(nanoid(), betId, r.selection.id, r.market.id, r.matchId, r.selection.odds);
    }
    audit(db, 'bet_placed', {
      userId: user.id,
      detail: { betId, type: bet.type, legs: resolved.length, stake: bet.stake, totalOdds, riskScore: risk.score },
      ip,
    });
  });
  run();

  return bet;
}

export interface BetWithLegs extends Bet {
  legs: BetLeg[];
  cashOutValue: number | null; // valor de cash-out disponible si la apuesta sigue abierta
}

export function getBetWithLegs(db: Database.Database, betId: string): BetWithLegs | undefined {
  const bet = db.prepare(`SELECT * FROM bets WHERE id = ?`).get(betId) as Bet | undefined;
  if (!bet) return undefined;
  const legs = db.prepare(`SELECT * FROM bet_legs WHERE bet_id = ?`).all(betId) as BetLeg[];
  return { ...bet, legs, cashOutValue: bet.status === 'open' ? computeCashOutValue(db, bet, legs) : null };
}

export function listUserBets(db: Database.Database, userId: string, limit = 50): BetWithLegs[] {
  const bets = db
    .prepare(`SELECT * FROM bets WHERE user_id = ? ORDER BY placed_at DESC LIMIT ?`)
    .all(userId, limit) as Bet[];
  return bets.map((bet) => {
    const legs = db.prepare(`SELECT * FROM bet_legs WHERE bet_id = ?`).all(bet.id) as BetLeg[];
    return { ...bet, legs, cashOutValue: bet.status === 'open' ? computeCashOutValue(db, bet, legs) : null };
  });
}

/**
 * Valor de cash-out actual de una apuesta abierta, o null si no es posible.
 * Fórmula: valor_justo = stake × Π(cuota_bloqueada patas ganadas)
 *          × Π(cuota_bloqueada patas abiertas) / Π(cuota_actual patas abiertas),
 * con un margen del operador. Si una pata está perdida o un partido finalizó
 * sin liquidar, no se ofrece cash-out.
 */
export function computeCashOutValue(db: Database.Database, bet: Bet, legs: BetLeg[]): number | null {
  if (bet.status !== 'open') return null;

  let wonFactor = 1;
  let lockedRemaining = 1;
  let currentRemaining = 1;

  for (const leg of legs) {
    if (leg.result === 'lost') return null; // apuesta ya perdida de facto
    if (leg.result === 'won') {
      wonFactor *= leg.odds;
      continue;
    }
    if (leg.result === 'void') continue; // pata anulada → factor 1
    // Pata pendiente: comparar cuota bloqueada vs actual de mercado.
    const match = db.prepare(`SELECT status FROM matches WHERE id = ?`).get(leg.match_id) as { status: string } | undefined;
    if (!match || match.status === 'finished' || match.status === 'cancelled') return null; // pendiente de liquidar
    const sel = db.prepare(`SELECT odds FROM selections WHERE id = ?`).get(leg.selection_id) as { odds: number } | undefined;
    if (!sel) return null;
    lockedRemaining *= leg.odds;
    currentRemaining *= sel.odds;
  }

  // Todas las patas ya decididas (ganadas/anuladas): valor = pago potencial.
  if (currentRemaining === 1 && lockedRemaining === 1) {
    return bet.potential_payout;
  }

  const fairValue = bet.stake * wonFactor * (lockedRemaining / currentRemaining);
  return Math.max(0, Math.floor(fairValue * (1 - CASHOUT_MARGIN)));
}

export function cashOut(db: Database.Database, user: User, betId: string, ip: string | null): { value: number; balance: number } {
  const bet = db.prepare(`SELECT * FROM bets WHERE id = ?`).get(betId) as Bet | undefined;
  if (!bet || bet.user_id !== user.id) throw new AppError(404, 'bet_not_found', 'Apuesta no encontrada.');
  if (bet.status !== 'open') throw new AppError(409, 'bet_not_open', 'La apuesta no admite cash-out.');

  const legs = db.prepare(`SELECT * FROM bet_legs WHERE bet_id = ?`).all(betId) as BetLeg[];
  const value = computeCashOutValue(db, bet, legs);
  if (value == null) throw new AppError(409, 'cashout_unavailable', 'El cash-out no está disponible para esta apuesta ahora mismo.');

  const run = db.transaction(() => {
    const tx = applyLedgerEntry(db, user.id, 'cashout', value, bet.id);
    db.prepare(`UPDATE bets SET status='cashed_out', cash_out_value=?, settled_at=datetime('now') WHERE id=?`).run(value, bet.id);
    audit(db, 'bet_cashed_out', { userId: user.id, detail: { betId, value }, ip });
    return tx.balance_after;
  });
  const balance = run();
  return { value, balance };
}

/** Reload helper used by routes to fetch a fresh User from the DB. */
export function requireUser(db: Database.Database, userId: string): User {
  const user = findUserById(db, userId);
  if (!user) throw new AppError(401, 'user_not_found', 'Usuario no encontrado.');
  return user;
}
