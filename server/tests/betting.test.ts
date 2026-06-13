import { describe, it, expect } from 'vitest';
import { placeBet, cashOut, listUserBets } from '../src/betting/betting.service.js';
import { settleMatch } from '../src/betting/settlement.service.js';
import { getBalance } from '../src/wallet/wallet.service.js';
import { AppError } from '../src/types.js';
import { freshDb, makeUser, makeMatchWith1x2 } from './helpers.js';

describe('apuestas simples', () => {
  it('coloca una apuesta simple y debita el saldo', async () => {
    const db = await freshDb();
    const user = await makeUser(db);
    const { selHome, odds } = await makeMatchWith1x2(db);

    const bet = await placeBet(db, user, { legs: [{ selectionId: selHome, expectedOdds: odds.home }], stake: 10_000 }, '10.0.0.1');

    expect(bet.type).toBe('single');
    expect(bet.total_odds).toBe(odds.home);
    expect(bet.potential_payout).toBe(Math.floor(10_000 * odds.home));
    expect(await getBalance(db, user.id)).toBe(90_000);
    await db.close();
  });

  it('rechaza si la cuota ha cambiado', async () => {
    const db = await freshDb();
    const user = await makeUser(db);
    const { selHome } = await makeMatchWith1x2(db);
    try {
      await placeBet(db, user, { legs: [{ selectionId: selHome, expectedOdds: 9.99 }], stake: 1000 }, null);
      expect.fail('debería lanzar');
    } catch (e) {
      expect((e as AppError).code).toBe('odds_changed');
    }
    await db.close();
  });

  it('liquida y paga al ganador (impuesto 0% en ES)', async () => {
    const db = await freshDb();
    const user = await makeUser(db);
    const { matchId, selHome, odds } = await makeMatchWith1x2(db);
    await placeBet(db, user, { legs: [{ selectionId: selHome, expectedOdds: odds.home }], stake: 10_000 }, null);

    const result = await settleMatch(db, matchId, 2, 0);
    expect(result.settledBets).toBe(1);
    expect(await getBalance(db, user.id)).toBe(90_000 + Math.floor(10_000 * odds.home));
    await db.close();
  });

  it('marca como perdida la apuesta cuando el resultado no acompaña', async () => {
    const db = await freshDb();
    const user = await makeUser(db);
    const { matchId, selHome, odds } = await makeMatchWith1x2(db);
    await placeBet(db, user, { legs: [{ selectionId: selHome, expectedOdds: odds.home }], stake: 10_000 }, null);

    await settleMatch(db, matchId, 0, 1);
    expect(await getBalance(db, user.id)).toBe(90_000);
    const bets = await listUserBets(db, user.id);
    expect(bets[0].status).toBe('lost');
    await db.close();
  });

  it('no permite apostar en un partido finalizado', async () => {
    const db = await freshDb();
    const user = await makeUser(db);
    const { matchId, selHome, odds } = await makeMatchWith1x2(db);
    await db.none(`UPDATE matches SET status='finished' WHERE id = $1`, [matchId]);
    try {
      await placeBet(db, user, { legs: [{ selectionId: selHome, expectedOdds: odds.home }], stake: 1000 }, null);
      expect.fail('debería lanzar');
    } catch (e) {
      expect((e as AppError).code).toBe('match_closed');
    }
    await db.close();
  });
});

describe('apuestas combinadas', () => {
  it('multiplica las cuotas y paga si ganan todas las patas', async () => {
    const db = await freshDb();
    const user = await makeUser(db);
    const m1 = await makeMatchWith1x2(db, { home: 2.0, draw: 3.3, away: 3.5 });
    const m2 = await makeMatchWith1x2(db, { home: 1.5, draw: 4.0, away: 6.0 });

    const bet = await placeBet(
      db,
      user,
      { legs: [{ selectionId: m1.selHome, expectedOdds: 2.0 }, { selectionId: m2.selHome, expectedOdds: 1.5 }], stake: 10_000 },
      null,
    );
    expect(bet.type).toBe('combo');
    expect(bet.total_odds).toBeCloseTo(3.0, 5);
    expect(bet.potential_payout).toBe(Math.floor(10_000 * 3.0));

    await settleMatch(db, m1.matchId, 2, 0);
    let bets = await listUserBets(db, user.id);
    expect(bets[0].status).toBe('open');

    await settleMatch(db, m2.matchId, 1, 0);
    bets = await listUserBets(db, user.id);
    expect(bets[0].status).toBe('won');
    expect(await getBalance(db, user.id)).toBe(90_000 + Math.floor(10_000 * 3.0));
    await db.close();
  });

  it('pierde la combinada si falla una sola pata', async () => {
    const db = await freshDb();
    const user = await makeUser(db);
    const m1 = await makeMatchWith1x2(db);
    const m2 = await makeMatchWith1x2(db);
    await placeBet(db, user, { legs: [{ selectionId: m1.selHome, expectedOdds: m1.odds.home }, { selectionId: m2.selHome, expectedOdds: m2.odds.home }], stake: 5_000 }, null);

    await settleMatch(db, m1.matchId, 2, 0);
    await settleMatch(db, m2.matchId, 0, 2);
    const bets = await listUserBets(db, user.id);
    expect(bets[0].status).toBe('lost');
    expect(await getBalance(db, user.id)).toBe(95_000);
    await db.close();
  });

  it('rechaza dos selecciones del mismo partido en una combinada', async () => {
    const db = await freshDb();
    const user = await makeUser(db);
    const m = await makeMatchWith1x2(db);
    try {
      await placeBet(db, user, { legs: [{ selectionId: m.selHome, expectedOdds: m.odds.home }, { selectionId: m.selDraw, expectedOdds: m.odds.draw }], stake: 1000 }, null);
      expect.fail('debería lanzar');
    } catch (e) {
      expect((e as AppError).code).toBe('same_match_combo');
    }
    await db.close();
  });
});

describe('cash-out', () => {
  it('paga un valor positivo cuando la cuota se acorta', async () => {
    const db = await freshDb();
    const user = await makeUser(db);
    const { selHome } = await makeMatchWith1x2(db, { home: 3.0, draw: 3.3, away: 2.4 });
    await placeBet(db, user, { legs: [{ selectionId: selHome, expectedOdds: 3.0 }], stake: 10_000 }, null);

    await db.none(`UPDATE selections SET odds = 1.5 WHERE id = $1`, [selHome]);
    const bets = await listUserBets(db, user.id);
    const { value, balance } = await cashOut(db, user, bets[0].id, null);

    // valor justo = 10000 * (3.0/1.5) * 0.95 = 19000
    expect(value).toBe(19_000);
    expect(balance).toBe(90_000 + 19_000);
    const after = await listUserBets(db, user.id);
    expect(after[0].status).toBe('cashed_out');
    await db.close();
  });

  it('no permite cash-out de una apuesta ya liquidada', async () => {
    const db = await freshDb();
    const user = await makeUser(db);
    const { matchId, selHome, odds } = await makeMatchWith1x2(db);
    await placeBet(db, user, { legs: [{ selectionId: selHome, expectedOdds: odds.home }], stake: 5_000 }, null);
    await settleMatch(db, matchId, 2, 0);
    const bets = await listUserBets(db, user.id);
    try {
      await cashOut(db, user, bets[0].id, null);
      expect.fail('debería lanzar');
    } catch (e) {
      expect((e as AppError).code).toBe('bet_not_open');
    }
    await db.close();
  });
});
