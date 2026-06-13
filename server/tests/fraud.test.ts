import { describe, it, expect } from 'vitest';
import { assessBetRisk, screenTransaction } from '../src/fraud/fraud.service.js';
import { freshDb, makeUser } from './helpers.js';

describe('antifraude', () => {
  it('puntúa más alto un stake en el límite', async () => {
    const db = await freshDb();
    const user = await makeUser(db);
    const low = await assessBetRisk(db, { user, stake: 1000, odds: 2.0, maxStake: 30_000, ip: '1.1.1.1' });
    const high = await assessBetRisk(db, { user, stake: 30_000, odds: 2.0, maxStake: 30_000, ip: '1.1.1.1' });
    expect(high.score).toBeGreaterThan(low.score);
    expect(high.reasons).toContain('stake_en_limite');
    await db.close();
  });

  it('detecta cuotas extremas', async () => {
    const db = await freshDb();
    const user = await makeUser(db);
    const a = await assessBetRisk(db, { user, stake: 1000, odds: 80, maxStake: 30_000, ip: '1.1.1.1' });
    expect(a.reasons).toContain('cuota_extrema');
    await db.close();
  });

  it('señala multicuenta por IP compartida', async () => {
    const db = await freshDb();
    const ip = '203.0.113.9';
    await makeUser(db, { signup_ip: ip });
    await makeUser(db, { signup_ip: ip });
    await makeUser(db, { signup_ip: ip });
    const target = await makeUser(db, { signup_ip: ip });
    const a = await assessBetRisk(db, { user: target, stake: 1000, odds: 2.0, maxStake: 30_000, ip });
    expect(a.reasons.some((rs) => rs.startsWith('multicuenta_ip'))).toBe(true);
    await db.close();
  });

  it('marca transacciones grandes para revisión AML', async () => {
    const db = await freshDb();
    const user = await makeUser(db);
    await screenTransaction(db, user.id, 'deposit', 500_000);
    const flags = await db.query(`SELECT * FROM fraud_flags WHERE user_id = $1`, [user.id]);
    expect(flags.length).toBe(1);
    await db.close();
  });
});
