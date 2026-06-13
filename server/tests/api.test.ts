import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createTestDb, type Db } from '../src/db/index.js';
import { createApp } from '../src/app.js';
import { seed } from '../src/db/seed.js';

describe('API e2e', () => {
  let db: Db;
  let app: Express;
  let token = '';

  beforeAll(async () => {
    db = await createTestDb();
    await seed(db);
    app = createApp(db);
  });
  afterAll(async () => { await db.close(); });

  it('GET /api/health responde ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('lista jurisdicciones permitidas', async () => {
    const res = await request(app).get('/api/jurisdictions');
    expect(res.status).toBe(200);
    expect(res.body.jurisdictions.length).toBeGreaterThan(0);
  });

  it('registra un usuario válido', async () => {
    const res = await request(app).post('/api/auth/register').send({
      email: 'maria@test.com',
      password: 'Password1!',
      fullName: 'María García',
      dateOfBirth: '1995-03-10',
      jurisdiction: 'ES',
      acceptTerms: true,
    });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    token = res.body.token;
  });

  it('rechaza registro de menor de edad', async () => {
    const res = await request(app).post('/api/auth/register').send({
      email: 'nino@test.com',
      password: 'Password1!',
      fullName: 'Niño Test',
      dateOfBirth: '2015-03-10',
      jurisdiction: 'ES',
      acceptTerms: true,
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('underage');
  });

  it('rechaza jurisdicción no permitida', async () => {
    const res = await request(app).post('/api/auth/register').send({
      email: 'x@test.com',
      password: 'Password1!',
      fullName: 'Equis',
      dateOfBirth: '1990-03-10',
      jurisdiction: 'ZZ',
      acceptTerms: true,
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('jurisdiction_blocked');
  });

  it('lista partidos con cuotas', async () => {
    const res = await request(app).get('/api/matches');
    expect(res.status).toBe(200);
    expect(res.body.matches.length).toBe(6);
    expect(res.body.matches[0].markets.length).toBe(3);
  });

  it('exige KYC antes de apostar y completa el flujo', async () => {
    const matches = (await request(app).get('/api/matches')).body.matches;
    const selection = matches[0].markets[0].selections[0];

    await request(app).post('/api/wallet/deposit').set('Authorization', `Bearer ${token}`).send({ amount: 20_000 });

    const blocked = await request(app)
      .post('/api/bets')
      .set('Authorization', `Bearer ${token}`)
      .send({ legs: [{ selectionId: selection.id, expectedOdds: selection.odds }], stake: 5_000 });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('kyc_required');

    const kyc = await request(app)
      .post('/api/me/kyc')
      .set('Authorization', `Bearer ${token}`)
      .send({ documentType: 'national_id', documentNumber: '12345678Z', fullNameOnDocument: 'María García' });
    expect(kyc.body.kyc_status).toBe('verified');

    const ok = await request(app)
      .post('/api/bets')
      .set('Authorization', `Bearer ${token}`)
      .send({ legs: [{ selectionId: selection.id, expectedOdds: selection.odds }], stake: 5_000 });
    expect(ok.status).toBe(201);
    expect(ok.body.bet.stake).toBe(5_000);
    expect(ok.body.balance).toBe(15_000);
  });

  it('requiere autenticación para apostar', async () => {
    const res = await request(app).post('/api/bets').send({ legs: [{ selectionId: 'x', expectedOdds: 1 }], stake: 1 });
    expect(res.status).toBe(401);
  });
});
