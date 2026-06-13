import type Database from 'better-sqlite3';
import { AppError, type Bet, type BetLeg, type Market, type Selection } from '../types.js';
import { audit } from '../utils/audit.js';
import { applyLedgerEntry } from '../wallet/wallet.service.js';
import { getJurisdictionRule } from '../compliance/jurisdictions.js';
import { findUserById } from '../auth/users.repo.js';

/** Selección ganadora de un mercado según el resultado del partido. */
function winningSelectionName(marketType: string, home: number, away: number): string | null {
  switch (marketType) {
    case '1x2':
      if (home > away) return 'Local';
      if (home < away) return 'Visitante';
      return 'Empate';
    case 'over_under_2_5':
      return home + away > 2 ? 'Más de 2.5' : 'Menos de 2.5';
    case 'btts':
      return home > 0 && away > 0 ? 'Sí' : 'No';
    default:
      return null;
  }
}

/**
 * Liquida todos los mercados de un partido finalizado: marca selecciones y
 * patas, y resuelve los boletos (simples y combinados) que queden completos.
 */
export function settleMatch(
  db: Database.Database,
  matchId: string,
  homeScore: number,
  awayScore: number,
): { settledBets: number; totalPaidOut: number } {
  const match = db.prepare(`SELECT id FROM matches WHERE id = ?`).get(matchId) as { id: string } | undefined;
  if (!match) throw new AppError(404, 'match_not_found', 'Partido no encontrado.');

  let settledBets = 0;
  let totalPaidOut = 0;

  const run = db.transaction(() => {
    db.prepare(`UPDATE matches SET status='finished', home_score=?, away_score=? WHERE id=?`).run(homeScore, awayScore, matchId);

    const markets = db.prepare(`SELECT * FROM markets WHERE match_id = ?`).all(matchId) as Market[];
    for (const market of markets) {
      const winnerName = winningSelectionName(market.type, homeScore, awayScore);
      const selections = db.prepare(`SELECT * FROM selections WHERE market_id = ?`).all(market.id) as Selection[];
      for (const sel of selections) {
        const result = winnerName === null ? 'void' : sel.name === winnerName ? 'won' : 'lost';
        db.prepare(`UPDATE selections SET result = ? WHERE id = ?`).run(result, sel.id);
        // Propagar el resultado a todas las patas que apostaron esta selección.
        db.prepare(`UPDATE bet_legs SET result = ? WHERE selection_id = ? AND result = 'pending'`).run(result, sel.id);
      }
      db.prepare(`UPDATE markets SET status='settled' WHERE id = ?`).run(market.id);
    }

    // Boletos afectados por este partido y aún abiertos.
    const affected = db
      .prepare(`SELECT DISTINCT bet_id FROM bet_legs WHERE match_id = ?`)
      .all(matchId) as Array<{ bet_id: string }>;

    for (const { bet_id } of affected) {
      const outcome = settleBetIfComplete(db, bet_id);
      if (outcome) {
        settledBets++;
        totalPaidOut += outcome.paidOut;
      }
    }

    audit(db, 'match_settled', { detail: { matchId, homeScore, awayScore, settledBets, totalPaidOut } });
  });
  run();

  return { settledBets, totalPaidOut };
}

/**
 * Resuelve un boleto si todas sus patas están decididas. Reglas:
 *  - Alguna pata perdida  → boleto perdido (sin pago).
 *  - Todas anuladas       → boleto anulado (reembolso del stake).
 *  - Resto                → ganado: pago = stake × Π(cuotas de patas ganadas)
 *                           (las anuladas cuentan como cuota 1), menos impuesto.
 * Devuelve null si el boleto sigue abierto (patas pendientes) o ya estaba cerrado.
 */
export function settleBetIfComplete(db: Database.Database, betId: string): { status: Bet['status']; paidOut: number } | null {
  const bet = db.prepare(`SELECT * FROM bets WHERE id = ?`).get(betId) as Bet | undefined;
  if (!bet || bet.status !== 'open') return null;

  const legs = db.prepare(`SELECT * FROM bet_legs WHERE bet_id = ?`).all(betId) as BetLeg[];
  if (legs.some((l) => l.result === 'pending')) return null; // aún no liquidable

  const anyLost = legs.some((l) => l.result === 'lost');
  const allVoid = legs.every((l) => l.result === 'void');

  if (anyLost) {
    markBet(db, betId, 'lost', null);
    return { status: 'lost', paidOut: 0 };
  }

  if (allVoid) {
    applyLedgerEntry(db, bet.user_id, 'refund', bet.stake, betId);
    markBet(db, betId, 'void', null);
    return { status: 'void', paidOut: 0 };
  }

  // Ganado: producto de cuotas de patas ganadas (anuladas = 1).
  const effectiveOdds = legs.reduce((acc, l) => (l.result === 'won' ? acc * l.odds : acc), 1);
  const grossPayout = Math.floor(bet.stake * effectiveOdds);
  const netPayout = applyWinningsTax(db, bet.user_id, bet.stake, grossPayout);
  applyLedgerEntry(db, bet.user_id, 'bet_payout', netPayout, betId);
  markBet(db, betId, 'won', null);
  return { status: 'won', paidOut: netPayout };
}

/** Aplica el impuesto sobre la ganancia neta según la jurisdicción del usuario. */
function applyWinningsTax(db: Database.Database, userId: string, stake: number, grossPayout: number): number {
  const user = findUserById(db, userId);
  const taxRate = user ? getJurisdictionRule(user.jurisdiction).winningsTaxRate : 0;
  const grossProfit = grossPayout - stake;
  const tax = grossProfit > 0 ? Math.floor(grossProfit * taxRate) : 0;
  return grossPayout - tax;
}

function markBet(db: Database.Database, betId: string, status: Bet['status'], cashOutValue: number | null): void {
  db.prepare(`UPDATE bets SET status = ?, cash_out_value = ?, settled_at = datetime('now') WHERE id = ?`).run(status, cashOutValue, betId);
}
