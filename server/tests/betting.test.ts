import { describe, it, expect } from 'vitest';
import { placeBet, cashOut, listUserBets } from '../src/betting/betting.service.js';
import { settleMatch } from '../src/betting/settlement.service.js';
import { getBalance } from '../src/wallet/wallet.service.js';
import { AppError } from '../src/types.js';
import { freshDb, makeUser, makeMatchWith1x2 } from './helpers.js';

describe('apuestas simples', () => {
  it('coloca una apuesta simple y debita el saldo', () => {
    const db = freshDb();
    const user = makeUser(db); // saldo inicial 100.000
    const { selHome, odds } = makeMatchWith1x2(db);

    const bet = placeBet(db, user, { legs: [{ selectionId: selHome, expectedOdds: odds.home }], stake: 10_000 }, '10.0.0.1');

    expect(bet.type).toBe('single');
    expect(bet.total_odds).toBe(odds.home);
    expect(bet.potential_payout).toBe(Math.floor(10_000 * odds.home));
    expect(getBalance(db, user.id)).toBe(90_000);
  });

  it('rechaza si la cuota ha cambiado', () => {
    const db = freshDb();
    const user = makeUser(db);
    const { selHome } = makeMatchWith1x2(db);
    try {
      placeBet(db, user, { legs: [{ selectionId: selHome, expectedOdds: 9.99 }], stake: 1000 }, null);
      expect.fail('debería lanzar');
    } catch (e) {
      expect((e as AppError).code).toBe('odds_changed');
    }
  });

  it('liquida y paga al ganador (impuesto 0% en ES)', () => {
    const db = freshDb();
    const user = makeUser(db);
    const { matchId, selHome, odds } = makeMatchWith1x2(db);
    placeBet(db, user, { legs: [{ selectionId: selHome, expectedOdds: odds.home }], stake: 10_000 }, null);

    const result = settleMatch(db, matchId, 2, 0);
    expect(result.settledBets).toBe(1);
    expect(getBalance(db, user.id)).toBe(90_000 + Math.floor(10_000 * odds.home));
  });

  it('marca como perdida la apuesta cuando el resultado no acompaña', () => {
    const db = freshDb();
    const user = makeUser(db);
    const { matchId, selHome, odds } = makeMatchWith1x2(db);
    placeBet(db, user, { legs: [{ selectionId: selHome, expectedOdds: odds.home }], stake: 10_000 }, null);

    settleMatch(db, matchId, 0, 1);
    expect(getBalance(db, user.id)).toBe(90_000);
    const bet = db.prepare(`SELECT status FROM bets WHERE user_id = ?`).get(user.id) as { status: string };
    expect(bet.status).toBe('lost');
  });

  it('no permite apostar en un partido finalizado', () => {
    const db = freshDb();
    const user = makeUser(db);
    const { matchId, selHome, odds } = makeMatchWith1x2(db);
    db.prepare(`UPDATE matches SET status='finished' WHERE id = ?`).run(matchId);
    try {
      placeBet(db, user, { legs: [{ selectionId: selHome, expectedOdds: odds.home }], stake: 1000 }, null);
      expect.fail('debería lanzar');
    } catch (e) {
      expect((e as AppError).code).toBe('match_closed');
    }
  });
});

describe('apuestas combinadas', () => {
  it('multiplica las cuotas y paga si ganan todas las patas', () => {
    const db = freshDb();
    const user = makeUser(db);
    const m1 = makeMatchWith1x2(db, { home: 2.0, draw: 3.3, away: 3.5 });
    const m2 = makeMatchWith1x2(db, { home: 1.5, draw: 4.0, away: 6.0 });

    const bet = placeBet(
      db,
      user,
      { legs: [{ selectionId: m1.selHome, expectedOdds: 2.0 }, { selectionId: m2.selHome, expectedOdds: 1.5 }], stake: 10_000 },
      null,
    );
    expect(bet.type).toBe('combo');
    expect(bet.total_odds).toBeCloseTo(3.0, 5);
    expect(bet.potential_payout).toBe(Math.floor(10_000 * 3.0));

    settleMatch(db, m1.matchId, 2, 0); // gana local m1: combo sigue abierta
    let bets = listUserBets(db, user.id);
    expect(bets[0].status).toBe('open');

    settleMatch(db, m2.matchId, 1, 0); // gana local m2: combo ganada
    bets = listUserBets(db, user.id);
    expect(bets[0].status).toBe('won');
    expect(getBalance(db, user.id)).toBe(90_000 + Math.floor(10_000 * 3.0));
  });

  it('pierde la combinada si falla una sola pata', () => {
    const db = freshDb();
    const user = makeUser(db);
    const m1 = makeMatchWith1x2(db);
    const m2 = makeMatchWith1x2(db);
    placeBet(db, user, { legs: [{ selectionId: m1.selHome, expectedOdds: m1.odds.home }, { selectionId: m2.selHome, expectedOdds: m2.odds.home }], stake: 5_000 }, null);

    settleMatch(db, m1.matchId, 2, 0); // gana
    settleMatch(db, m2.matchId, 0, 2); // pierde -> combo perdida
    const bets = listUserBets(db, user.id);
    expect(bets[0].status).toBe('lost');
    expect(getBalance(db, user.id)).toBe(95_000);
  });

  it('rechaza dos selecciones del mismo partido en una combinada', () => {
    const db = freshDb();
    const user = makeUser(db);
    const m = makeMatchWith1x2(db);
    try {
      placeBet(db, user, { legs: [{ selectionId: m.selHome, expectedOdds: m.odds.home }, { selectionId: m.selDraw, expectedOdds: m.odds.draw }], stake: 1000 }, null);
      expect.fail('debería lanzar');
    } catch (e) {
      expect((e as AppError).code).toBe('same_match_combo');
    }
  });
});

describe('cash-out', () => {
  it('paga un valor positivo cuando la cuota se acorta', () => {
    const db = freshDb();
    const user = makeUser(db);
    const { selHome } = makeMatchWith1x2(db, { home: 3.0, draw: 3.3, away: 2.4 });
    placeBet(db, user, { legs: [{ selectionId: selHome, expectedOdds: 3.0 }], stake: 10_000 }, null);

    // La cuota baja a 1.5 (el equipo se ha convertido en favorito) -> cash-out > stake.
    db.prepare(`UPDATE selections SET odds = 1.5 WHERE id = ?`).run(selHome);
    const { value, balance } = cashOut(db, user, listUserBets(db, user.id)[0].id, null);

    // valor justo = 10000 * (3.0/1.5) * 0.95 = 19000
    expect(value).toBe(19_000);
    expect(balance).toBe(90_000 + 19_000);
    expect(listUserBets(db, user.id)[0].status).toBe('cashed_out');
  });

  it('no permite cash-out de una apuesta ya liquidada', () => {
    const db = freshDb();
    const user = makeUser(db);
    const { matchId, selHome, odds } = makeMatchWith1x2(db);
    placeBet(db, user, { legs: [{ selectionId: selHome, expectedOdds: odds.home }], stake: 5_000 }, null);
    settleMatch(db, matchId, 2, 0);
    try {
      cashOut(db, user, listUserBets(db, user.id)[0].id, null);
      expect.fail('debería lanzar');
    } catch (e) {
      expect((e as AppError).code).toBe('bet_not_open');
    }
  });
});
