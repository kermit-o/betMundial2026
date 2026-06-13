import type { Db, Executor } from '../db/index.js';
import { AppError, type Bet, type BetLeg, type Market, type Selection } from '../types.js';
import { audit } from '../utils/audit.js';
import { nowIso } from '../utils/time.js';
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
export async function settleMatch(
  db: Db,
  matchId: string,
  homeScore: number,
  awayScore: number,
): Promise<{ settledBets: number; totalPaidOut: number }> {
  const match = await db.oneOrNone<{ id: string }>(`SELECT id FROM matches WHERE id = $1`, [matchId]);
  if (!match) throw new AppError(404, 'match_not_found', 'Partido no encontrado.');

  return db.tx(async (t) => {
    let settledBets = 0;
    let totalPaidOut = 0;

    await t.none(`UPDATE matches SET status='finished', home_score=$1, away_score=$2 WHERE id=$3`, [homeScore, awayScore, matchId]);

    const markets = await t.query<Market>(`SELECT * FROM markets WHERE match_id = $1`, [matchId]);
    for (const market of markets) {
      const winnerName = winningSelectionName(market.type, homeScore, awayScore);
      const selections = await t.query<Selection>(`SELECT * FROM selections WHERE market_id = $1`, [market.id]);
      for (const sel of selections) {
        const result = winnerName === null ? 'void' : sel.name === winnerName ? 'won' : 'lost';
        await t.none(`UPDATE selections SET result = $1 WHERE id = $2`, [result, sel.id]);
        await t.none(`UPDATE bet_legs SET result = $1 WHERE selection_id = $2 AND result = 'pending'`, [result, sel.id]);
      }
      await t.none(`UPDATE markets SET status='settled' WHERE id = $1`, [market.id]);
    }

    const affected = await t.query<{ bet_id: string }>(`SELECT DISTINCT bet_id FROM bet_legs WHERE match_id = $1`, [matchId]);
    for (const { bet_id } of affected) {
      const outcome = await settleBetIfComplete(t, bet_id);
      if (outcome) {
        settledBets++;
        totalPaidOut += outcome.paidOut;
      }
    }

    await audit(t, 'match_settled', { detail: { matchId, homeScore, awayScore, settledBets, totalPaidOut } });
    return { settledBets, totalPaidOut };
  });
}

/**
 * Resuelve un boleto si todas sus patas están decididas. Reglas:
 *  - Alguna pata perdida  → boleto perdido (sin pago).
 *  - Todas anuladas       → boleto anulado (reembolso del stake).
 *  - Resto                → ganado: pago = stake × Π(cuotas de patas ganadas), menos impuesto.
 */
export async function settleBetIfComplete(db: Executor, betId: string): Promise<{ status: Bet['status']; paidOut: number } | null> {
  const bet = await db.oneOrNone<Bet>(`SELECT * FROM bets WHERE id = $1`, [betId]);
  if (!bet || bet.status !== 'open') return null;

  const legs = await db.query<BetLeg>(`SELECT * FROM bet_legs WHERE bet_id = $1`, [betId]);
  if (legs.some((l) => l.result === 'pending')) return null;

  const anyLost = legs.some((l) => l.result === 'lost');
  const allVoid = legs.every((l) => l.result === 'void');

  if (anyLost) {
    await markBet(db, betId, 'lost');
    return { status: 'lost', paidOut: 0 };
  }

  if (allVoid) {
    await applyLedgerEntry(db, bet.user_id, 'refund', bet.stake, betId);
    await markBet(db, betId, 'void');
    return { status: 'void', paidOut: 0 };
  }

  const effectiveOdds = legs.reduce((acc, l) => (l.result === 'won' ? acc * l.odds : acc), 1);
  const grossPayout = Math.floor(bet.stake * effectiveOdds);
  const netPayout = await applyWinningsTax(db, bet.user_id, bet.stake, grossPayout);
  await applyLedgerEntry(db, bet.user_id, 'bet_payout', netPayout, betId);
  await markBet(db, betId, 'won');
  return { status: 'won', paidOut: netPayout };
}

/** Aplica el impuesto sobre la ganancia neta según la jurisdicción del usuario. */
async function applyWinningsTax(db: Executor, userId: string, stake: number, grossPayout: number): Promise<number> {
  const user = await findUserById(db, userId);
  const taxRate = user ? getJurisdictionRule(user.jurisdiction).winningsTaxRate : 0;
  const grossProfit = grossPayout - stake;
  const tax = grossProfit > 0 ? Math.floor(grossProfit * taxRate) : 0;
  return grossPayout - tax;
}

async function markBet(db: Executor, betId: string, status: Bet['status']): Promise<void> {
  await db.none(`UPDATE bets SET status = $1, settled_at = $2 WHERE id = $3`, [status, nowIso(), betId]);
}
