import type Database from 'better-sqlite3';
import { AppError, type Bet, type Market, type Selection } from '../types.js';
import { audit } from '../utils/audit.js';
import { applyLedgerEntry } from '../wallet/wallet.service.js';
import { getJurisdictionRule } from '../compliance/jurisdictions.js';
import { findUserById } from '../auth/users.repo.js';

/**
 * Calcula qué selección de un mercado resulta ganadora según el resultado.
 * Devuelve el nombre de la selección ganadora (o null para mercados anulados).
 */
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
 * Liquida todos los mercados de un partido finalizado de forma atómica:
 * marca selecciones ganadoras/perdedoras, resuelve apuestas y paga (con impuesto).
 */
export function settleMatch(
  db: Database.Database,
  matchId: string,
  homeScore: number,
  awayScore: number,
): { settledBets: number; totalPaidOut: number } {
  const match = db.prepare(`SELECT * FROM matches WHERE id = ?`).get(matchId) as
    | { id: string; status: string }
    | undefined;
  if (!match) throw new AppError(404, 'match_not_found', 'Partido no encontrado.');

  let settledBets = 0;
  let totalPaidOut = 0;

  const run = db.transaction(() => {
    db.prepare(`UPDATE matches SET status='finished', home_score=?, away_score=? WHERE id=?`).run(
      homeScore,
      awayScore,
      matchId,
    );

    const markets = db.prepare(`SELECT * FROM markets WHERE match_id = ?`).all(matchId) as Market[];

    for (const market of markets) {
      if (market.status === 'settled') continue;
      const winnerName = winningSelectionName(market.type, homeScore, awayScore);
      const selections = db.prepare(`SELECT * FROM selections WHERE market_id = ?`).all(market.id) as Selection[];

      for (const sel of selections) {
        const result = winnerName === null ? 'void' : sel.name === winnerName ? 'won' : 'lost';
        db.prepare(`UPDATE selections SET result = ? WHERE id = ?`).run(result, sel.id);

        const bets = db
          .prepare(`SELECT * FROM bets WHERE selection_id = ? AND status = 'open'`)
          .all(sel.id) as Bet[];

        for (const bet of bets) {
          settledBets++;
          if (result === 'void') {
            // Reembolso íntegro del stake.
            applyLedgerEntry(db, bet.user_id, 'refund', bet.stake, bet.id);
            markBet(db, bet.id, 'void');
          } else if (result === 'won') {
            const payout = computeNetPayout(db, bet);
            totalPaidOut += payout;
            applyLedgerEntry(db, bet.user_id, 'bet_payout', payout, bet.id);
            markBet(db, bet.id, 'won');
          } else {
            markBet(db, bet.id, 'lost');
          }
        }
      }
      db.prepare(`UPDATE markets SET status='settled' WHERE id = ?`).run(market.id);
    }

    audit(db, 'match_settled', {
      detail: { matchId, homeScore, awayScore, settledBets, totalPaidOut },
    });
  });
  run();

  return { settledBets, totalPaidOut };
}

/** Pago neto = pago bruto menos impuesto sobre la ganancia neta de la jurisdicción. */
function computeNetPayout(db: Database.Database, bet: Bet): number {
  const user = findUserById(db, bet.user_id);
  const taxRate = user ? getJurisdictionRule(user.jurisdiction).winningsTaxRate : 0;
  const grossProfit = bet.potential_payout - bet.stake;
  const tax = Math.floor(grossProfit * taxRate);
  return bet.potential_payout - tax;
}

function markBet(db: Database.Database, betId: string, status: Bet['status']): void {
  db.prepare(`UPDATE bets SET status = ?, settled_at = datetime('now') WHERE id = ?`).run(status, betId);
}
