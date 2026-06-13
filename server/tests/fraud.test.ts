import { describe, it, expect } from 'vitest';
import { assessBetRisk, screenTransaction } from '../src/fraud/fraud.service.js';
import { freshDb, makeUser } from './helpers.js';

describe('antifraude', () => {
  it('puntúa más alto un stake en el límite', () => {
    const db = freshDb();
    const user = makeUser(db);
    const low = assessBetRisk(db, { user, stake: 1000, odds: 2.0, maxStake: 30_000, ip: '1.1.1.1' });
    const high = assessBetRisk(db, { user, stake: 30_000, odds: 2.0, maxStake: 30_000, ip: '1.1.1.1' });
    expect(high.score).toBeGreaterThan(low.score);
    expect(high.reasons).toContain('stake_en_limite');
  });

  it('detecta cuotas extremas', () => {
    const db = freshDb();
    const user = makeUser(db);
    const a = assessBetRisk(db, { user, stake: 1000, odds: 80, maxStake: 30_000, ip: '1.1.1.1' });
    expect(a.reasons).toContain('cuota_extrema');
  });

  it('señala multicuenta por IP compartida', () => {
    const db = freshDb();
    const ip = '203.0.113.9';
    makeUser(db, { signup_ip: ip });
    makeUser(db, { signup_ip: ip });
    makeUser(db, { signup_ip: ip });
    const target = makeUser(db, { signup_ip: ip });
    const a = assessBetRisk(db, { user: target, stake: 1000, odds: 2.0, maxStake: 30_000, ip });
    expect(a.reasons.some((r) => r.startsWith('multicuenta_ip'))).toBe(true);
  });

  it('marca transacciones grandes para revisión AML', () => {
    const db = freshDb();
    const user = makeUser(db);
    screenTransaction(db, user.id, 'deposit', 500_000);
    const flags = db.prepare(`SELECT * FROM fraud_flags WHERE user_id = ?`).all(user.id);
    expect(flags.length).toBe(1);
  });
});
