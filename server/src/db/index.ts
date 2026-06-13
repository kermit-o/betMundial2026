import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nanoid } from 'nanoid';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// pg devuelve BIGINT (20) y NUMERIC (1700, p.ej. SUM(bigint)) como string; los
// parseamos a number (los importes en minor units caben en un number seguro).
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));

const SCHEMA_SQL = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');

/** Ejecutor de consultas (lo implementan tanto el pool como un cliente de transacción). */
export interface Executor {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  oneOrNone<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined>;
  none(sql: string, params?: unknown[]): Promise<void>;
}

export interface Db extends Executor {
  tx<T>(fn: (e: Executor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

type RunFn = (sql: string, params?: unknown[]) => Promise<pg.QueryResult>;

function makeExecutor(run: RunFn): Executor {
  return {
    async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
      return (await run(sql, params)).rows as T[];
    },
    async oneOrNone<T>(sql: string, params?: unknown[]): Promise<T | undefined> {
      const r = await run(sql, params);
      return r.rows[0] as T | undefined;
    },
    async none(sql: string, params?: unknown[]): Promise<void> {
      await run(sql, params);
    },
  };
}

class PgDb implements Db {
  private exec: Executor;
  constructor(private pool: pg.Pool) {
    this.exec = makeExecutor((sql, params) => this.pool.query(sql, params as unknown[]));
  }
  query<T>(sql: string, params?: unknown[]) { return this.exec.query<T>(sql, params); }
  oneOrNone<T>(sql: string, params?: unknown[]) { return this.exec.oneOrNone<T>(sql, params); }
  none(sql: string, params?: unknown[]) { return this.exec.none(sql, params); }

  async tx<T>(fn: (e: Executor) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const exec = makeExecutor((sql, params) => client.query(sql, params as unknown[]));
      const result = await fn(exec);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async close() { await this.pool.end(); }
}

let instance: PgDb | null = null;

/** Aplica el esquema de forma idempotente. */
export async function applySchema(db: Db): Promise<void> {
  await db.none(SCHEMA_SQL);
}

export async function getDb(): Promise<Db> {
  if (instance) return instance;
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: config.databasePoolMax });
  instance = new PgDb(pool);
  await applySchema(instance);
  return instance;
}

export async function closeDb(): Promise<void> {
  if (instance) {
    await instance.close();
    instance = null;
  }
}

/**
 * BD aislada para pruebas: crea un esquema temporal en la BD de test y fija el
 * search_path de todas las conexiones del pool a ese esquema. Así cada test
 * corre sobre tablas propias contra un PostgreSQL real.
 */
export async function createTestDb(): Promise<Db> {
  const schema = 't_' + nanoid(10).replace(/[^a-zA-Z0-9]/g, '');
  const admin = new pg.Pool({ connectionString: config.databaseUrl, max: 1 });
  await admin.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  await admin.end();

  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    max: 4,
    options: `-c search_path=${schema}`,
  });
  const db = new PgDb(pool);
  await applySchema(db);
  return db;
}
