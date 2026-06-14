import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createTestDb, type Db } from '../src/db/index.js';
import { createApp } from '../src/app.js';
import { seed } from '../src/db/seed.js';

const reg = {
  password: 'Password1!',
  fullName: 'Nuevo Cliente',
  dateOfBirth: '1990-01-01',
  jurisdiction: 'ES',
  acceptTerms: true,
};

describe('plataforma (super-admin)', () => {
  let db: Db;
  let app: Express;
  let token = '';

  beforeAll(async () => {
    db = await createTestDb();
    await seed(db); // crea el super-admin de demo (dev): super@platform.test / Super1234!
    app = createApp(db);
  });
  afterAll(async () => {
    await db.close();
  });

  it('login de plataforma correcto devuelve token', async () => {
    const res = await request(app).post('/api/platform/login').send({ email: 'super@platform.test', password: 'Super1234!' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    token = res.body.token;
  });

  it('rechaza login de plataforma con credenciales incorrectas', async () => {
    const res = await request(app).post('/api/platform/login').send({ email: 'super@platform.test', password: 'mala' });
    expect(res.status).toBe(401);
  });

  it('lista operadores (incluye op_default) con token de plataforma', async () => {
    const res = await request(app).get('/api/platform/operators').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.operators.map((o: { id: string }) => o.id)).toContain('op_default');
  });

  it('exige autenticación para gestionar operadores', async () => {
    const res = await request(app).get('/api/platform/operators');
    expect(res.status).toBe(401);
  });

  it('crea un operador nuevo y permite registrar usuarios aislados en él', async () => {
    const create = await request(app)
      .post('/api/platform/operators')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Casino Nuevo', slug: 'casino-nuevo' });
    expect(create.status).toBe(201);
    const opId = create.body.operator.id as string;

    const register = await request(app).post('/api/auth/register').set('X-Operator-Id', opId).send({ email: 'nuevo@casino.com', ...reg });
    expect(register.status).toBe(201);

    // Ese usuario no existe en el operador por defecto.
    const loginDefault = await request(app).post('/api/auth/login').set('X-Operator-Id', 'op_default').send({ email: 'nuevo@casino.com', password: reg.password });
    expect(loginDefault.status).toBe(401);
  });

  it('rechaza slug inválido o duplicado', async () => {
    const bad = await request(app).post('/api/platform/operators').set('Authorization', `Bearer ${token}`).send({ name: 'X', slug: 'MAYUS_invalido' });
    expect(bad.status).toBe(400);
    const dup = await request(app).post('/api/platform/operators').set('Authorization', `Bearer ${token}`).send({ name: 'X', slug: 'casino-nuevo' });
    expect(dup.status).toBe(409);
  });

  it('suspende y reactiva un operador', async () => {
    const create = await request(app)
      .post('/api/platform/operators')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Casino Temporal', slug: 'casino-temporal' });
    const opId = create.body.operator.id as string;

    const suspend = await request(app).patch(`/api/platform/operators/${opId}`).set('Authorization', `Bearer ${token}`).send({ status: 'suspended' });
    expect(suspend.status).toBe(200);
    expect(suspend.body.operator.status).toBe('suspended');

    const activate = await request(app).patch(`/api/platform/operators/${opId}`).set('Authorization', `Bearer ${token}`).send({ status: 'active' });
    expect(activate.body.operator.status).toBe('active');

    // Operador inexistente => 404.
    const missing = await request(app).patch('/api/platform/operators/op_nope').set('Authorization', `Bearer ${token}`).send({ status: 'suspended' });
    expect(missing.status).toBe(404);
  });

  it('un token de usuario de operador no sirve para la plataforma', async () => {
    const register = await request(app).post('/api/auth/register').set('X-Operator-Id', 'op_default').send({ email: 'normal@x.com', ...reg });
    const userToken = register.body.token as string;
    const res = await request(app).get('/api/platform/operators').set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(401);
  });
});
