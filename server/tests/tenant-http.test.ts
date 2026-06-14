import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createTestDb, type Db } from '../src/db/index.js';
import { createApp } from '../src/app.js';

const baseReg = {
  password: 'Password1!',
  fullName: 'Cliente',
  dateOfBirth: '1990-01-01',
  jurisdiction: 'ES',
  acceptTerms: true,
};

describe('aislamiento multi-operador (HTTP)', () => {
  let db: Db;
  let app: Express;

  beforeAll(async () => {
    db = await createTestDb();
    await db.runAsSystem(() =>
      db.none(
        `INSERT INTO operators (id, name, slug, status, created_at)
         VALUES ('opA','A','a','active','t'), ('opB','B','b','active','t')`,
      ),
    );
    app = createApp(db);
  });
  afterAll(async () => {
    await db.close();
  });

  it('el mismo email puede registrarse en dos operadores como cuentas distintas', async () => {
    const email = 'cliente@http.com';
    const a = await request(app).post('/api/auth/register').set('X-Operator-Id', 'opA').send({ email, ...baseReg });
    const b = await request(app).post('/api/auth/register').set('X-Operator-Id', 'opB').send({ email, ...baseReg });

    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.user.id).not.toBe(b.body.user.id);
  });

  it('un usuario de un operador es invisible al login de otro operador', async () => {
    const email = 'solo-en-a@http.com';
    const reg = await request(app).post('/api/auth/register').set('X-Operator-Id', 'opA').send({ email, ...baseReg });
    expect(reg.status).toBe(201);

    // El mismo email/clave en opB no existe => credenciales inválidas.
    const loginB = await request(app).post('/api/auth/login').set('X-Operator-Id', 'opB').send({ email, password: baseReg.password });
    expect(loginB.status).toBe(401);

    // En su operador correcto, el login funciona.
    const loginA = await request(app).post('/api/auth/login').set('X-Operator-Id', 'opA').send({ email, password: baseReg.password });
    expect(loginA.status).toBe(200);
  });

  it('el token de un operador no accede a su perfil bajo otro operador', async () => {
    const email = 'perfil@http.com';
    const reg = await request(app).post('/api/auth/register').set('X-Operator-Id', 'opA').send({ email, ...baseReg });
    const token = reg.body.token as string;

    const meA = await request(app).get('/api/me').set('Authorization', `Bearer ${token}`).set('X-Operator-Id', 'opA');
    expect(meA.status).toBe(200);

    // El token es de opA pero la petición declara opB => rechazo explícito.
    const meB = await request(app).get('/api/me').set('Authorization', `Bearer ${token}`).set('X-Operator-Id', 'opB');
    expect(meB.status).toBe(403);
  });
});
