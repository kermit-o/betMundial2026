import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createTestDb, type Db } from '../src/db/index.js';
import { createApp } from '../src/app.js';

// Solo corre con PLATFORM_BASE_DOMAIN definido (p. ej. example.com). En la suite
// por defecto se omite (la resolución por cabecera ya la cubren otros tests).
const base = process.env.PLATFORM_BASE_DOMAIN;

const reg = { password: 'Password1!', fullName: 'Sub Cliente', dateOfBirth: '1990-01-01', jurisdiction: 'ES', acceptTerms: true };

describe.skipIf(!base)('resolución de operador por subdominio', () => {
  let db: Db;
  let app: Express;

  beforeAll(async () => {
    db = await createTestDb();
    await db.runAsSystem(() =>
      db.none(`INSERT INTO operators (id, name, slug, status, created_at) VALUES ('op_sub','Casino Sub','casinosub','active','t')`),
    );
    app = createApp(db);
  });
  afterAll(async () => {
    await db.close();
  });

  it('casinosub.<base> resuelve al operador con ese slug y lo aísla', async () => {
    const register = await request(app).post('/api/auth/register').set('Host', `casinosub.${base}`).send({ email: 'sub@x.com', ...reg });
    expect(register.status).toBe(201);

    // El usuario existe bajo op_sub, no bajo op_default.
    const inDefault = await request(app).post('/api/auth/login').set('X-Operator-Id', 'op_default').send({ email: 'sub@x.com', password: reg.password });
    expect(inDefault.status).toBe(401);

    const inSub = await request(app).post('/api/auth/login').set('Host', `casinosub.${base}`).send({ email: 'sub@x.com', password: reg.password });
    expect(inSub.status).toBe(200);
  });

  it('un subdominio desconocido da 404', async () => {
    const res = await request(app).get('/api/health').set('Host', `noexiste.${base}`);
    expect(res.status).toBe(404);
  });
});
