import { describe, it, expect, beforeAll } from 'vitest';
import { nanoid } from 'nanoid';
import { freshDb } from './helpers.js';
import type { Db } from '../src/db/index.js';

async function createOperator(db: Db, id: string): Promise<void> {
  await db.runAsSystem(() =>
    db.none(
      `INSERT INTO operators (id, name, slug, status, created_at) VALUES ($1,$2,$3,'active',$4)`,
      [id, id, id, new Date().toISOString()],
    ),
  );
}

async function createUser(db: Db, operatorId: string, email: string): Promise<string> {
  const id = nanoid();
  await db.runWithContext(operatorId, () =>
    db.tx(async (t) => {
      // operator_id se rellena solo desde el contexto (no se indica aquí).
      await t.none(
        `INSERT INTO users (id, email, password_hash, full_name, date_of_birth, jurisdiction, currency, daily_deposit_limit, created_at)
         VALUES ($1,$2,'h','N','1990-01-01','ES','EUR',50000,$3)`,
        [id, email, new Date().toISOString()],
      );
      await t.none(`INSERT INTO wallets (user_id, balance, currency) VALUES ($1, 1000, 'EUR')`, [id]);
    }),
  );
  return id;
}

describe('aislamiento multi-operador (RLS)', () => {
  let db: Db;
  let userA: string;
  let userB: string;

  beforeAll(async () => {
    db = await freshDb();
    await createOperator(db, 'opA');
    await createOperator(db, 'opB');
    userA = await createUser(db, 'opA', 'cliente@x.com');
    userB = await createUser(db, 'opB', 'cliente@x.com'); // mismo email, otro operador
  });

  it('cada operador solo ve a sus propios usuarios', async () => {
    const aSees = await db.runWithContext('opA', () => db.query<{ id: string }>(`SELECT id FROM users`));
    const bSees = await db.runWithContext('opB', () => db.query<{ id: string }>(`SELECT id FROM users`));
    const aIds = aSees.map((r) => r.id);
    const bIds = bSees.map((r) => r.id);

    expect(aIds).toContain(userA);
    expect(aIds).not.toContain(userB);
    expect(bIds).toContain(userB);
    expect(bIds).not.toContain(userA);
  });

  it('un operador no puede leer la cartera de otro', async () => {
    const carteraDeBdesdeA = await db.runWithContext('opA', () =>
      db.oneOrNone(`SELECT * FROM wallets WHERE user_id = $1`, [userB]),
    );
    expect(carteraDeBdesdeA).toBeUndefined();
  });

  it('el contexto de sistema ve a todos los operadores', async () => {
    const all = await db.runAsSystem(() => db.query<{ id: string }>(`SELECT id FROM users`));
    const ids = all.map((r) => r.id);
    expect(ids).toContain(userA);
    expect(ids).toContain(userB);
  });

  it('WITH CHECK impide escribir en otro operador', async () => {
    await expect(
      db.runWithContext('opA', () =>
        db.none(
          `INSERT INTO users (id, operator_id, email, password_hash, full_name, date_of_birth, jurisdiction, currency, daily_deposit_limit, created_at)
           VALUES ($1,'opB','intruso@x.com','h','N','1990-01-01','ES','EUR',50000,$2)`,
          [nanoid(), new Date().toISOString()],
        ),
      ),
    ).rejects.toThrow();
  });

  it('el mismo email puede existir en operadores distintos', async () => {
    // userA y userB se crearon con el mismo email en operadores distintos: ambos existen.
    const a = await db.runWithContext('opA', () =>
      db.oneOrNone<{ id: string }>(`SELECT id FROM users WHERE email = 'cliente@x.com'`),
    );
    const b = await db.runWithContext('opB', () =>
      db.oneOrNone<{ id: string }>(`SELECT id FROM users WHERE email = 'cliente@x.com'`),
    );
    expect(a?.id).toBe(userA);
    expect(b?.id).toBe(userB);
  });
});
