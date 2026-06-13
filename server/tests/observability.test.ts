import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createTestDb, type Db } from '../src/db/index.js';
import { createApp } from '../src/app.js';
import { seed } from '../src/db/seed.js';

describe('observabilidad y operación', () => {
  let db: Db;
  let app: Express;

  beforeAll(async () => {
    db = await createTestDb();
    await seed(db);
    app = createApp(db);
  });
  afterAll(async () => { await db.close(); });

  it('expone liveness en /healthz', async () => {
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('expone readiness en /readyz (BD accesible)', async () => {
    const res = await request(app).get('/readyz');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
  });

  it('expone métricas Prometheus en /metrics', async () => {
    await request(app).get('/healthz');
    await request(app).get('/api/matches');
    const res = await request(app).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).toContain('bet_http_requests_total');
    expect(res.text).toContain('bet_users_total');
    expect(res.text).toContain('bet_open_liability_minor');
  });

  it('devuelve un X-Request-Id en cada respuesta', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-request-id']).toBeTruthy();
  });
});
