import { describe, it, expect } from 'vitest';
import { placeBet } from '../src/betting/betting.service.js';
import { settleMatch } from '../src/betting/settlement.service.js';
import { getBalance } from '../src/wallet/wallet.service.js';
import { AppError } from '../src/types.js';
import { freshDb, makeUser, makeMatchWith1x2 } from './helpers.js';

describe('flujo de apuestas', () => {
  it('coloca una apuesta y debita el saldo', () => {
    const db = freshDb();
    const user = makeUser(db); // saldo inicial 100.000
    const { selHome, odds } = makeMatchWith1x2(db);

    const bet = placeBet(db, user, { selectionId: selHome, stake: 10_000, expectedOdds: odds.home }, '10.0.0.1');

    expect(bet.stake).toBe(10_000);
    expect(bet.potential_payout).toBe(Math.floor(10_000 * odds.home));
    expect(getBalance(db, user.id)).toBe(90_000);
  });

  it('rechaza si la cuota ha cambiado', () => {
    const db = freshDb();
    const user = makeUser(db);
    const { selHome } = makeMatchWith1x2(db);
    try {
      placeBet(db, user, { selectionId: selHome, stake: 1000, expectedOdds: 9.99 }, null);
      expect.fail('debería lanzar');
    } catch (e) {
      expect((e as AppError).code).toBe('odds_changed');
    }
  });

  it('rechaza apuesta sin saldo suficiente', () => {
    const db = freshDb();
    const user = makeUser(db);
    const { selHome, odds } = makeMatchWith1x2(db);
    expect(() =>
      placeBet(db, user, { selectionId: selHome, stake: 999_999, expectedOdds: odds.home }, null),
    ).toThrowError(/máximo permitido|insuficiente/i);
  });

  it('liquida un partido y paga al ganador', () => {
    const db = freshDb();
    const user = makeUser(db);
    const { matchId, selHome, odds } = makeMatchWith1x2(db);
    placeBet(db, user, { selectionId: selHome, stake: 10_000, expectedOdds: odds.home }, null);

    // Local gana 2-0 -> la selección "Local" gana.
    const result = settleMatch(db, matchId, 2, 0);
    expect(result.settledBets).toBe(1);

    const expectedPayout = Math.floor(10_000 * odds.home); // ES: tax 0%
    expect(getBalance(db, user.id)).toBe(90_000 + expectedPayout);
  });

  it('marca como perdida la apuesta cuando el resultado no acompaña', () => {
    const db = freshDb();
    const user = makeUser(db);
    const { matchId, selHome, odds } = makeMatchWith1x2(db);
    placeBet(db, user, { selectionId: selHome, stake: 10_000, expectedOdds: odds.home }, null);

    settleMatch(db, matchId, 0, 1); // gana visitante
    expect(getBalance(db, user.id)).toBe(90_000); // sin reembolso

    const bet = db.prepare(`SELECT status FROM bets WHERE user_id = ?`).get(user.id) as { status: string };
    expect(bet.status).toBe('lost');
  });

  it('no permite apostar en un partido finalizado', () => {
    const db = freshDb();
    const user = makeUser(db);
    const { matchId, selHome, odds } = makeMatchWith1x2(db);
    db.prepare(`UPDATE matches SET status='finished' WHERE id = ?`).run(matchId);
    try {
      placeBet(db, user, { selectionId: selHome, stake: 1000, expectedOdds: odds.home }, null);
      expect.fail('debería lanzar');
    } catch (e) {
      expect((e as AppError).code).toBe('match_closed');
    }
  });
});
