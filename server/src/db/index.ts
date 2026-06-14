import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { fileURLToPath } from 'node:url';
import { nanoid } from 'nanoid';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

/**
 * Contexto de operador por petición. La app fija un cliente con la variable de
 * sesión app.operator_id; las consultas de ese flujo lo usan y la RLS de
 * PostgreSQL aísla los datos por operador.
 */
interface TenantStore {
  client: pg.PoolClient;
  operatorId: string;
}
const tenantALS = new AsyncLocalStorage<TenantStore>();

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
  /** Ejecuta fn con el contexto de un operador (RLS lo aísla). */
  runWithContext<T>(operatorId: string, fn: () => Promise<T>): Promise<T>;
  /** Ejecuta fn como sistema (ve/escribe en todos los operadores). */
  runAsSystem<T>(fn: () => Promise<T>): Promise<T>;
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
  constructor(private pool: pg.Pool) {}

  /** Enruta cada consulta al cliente del operador actual o al pool si no hay contexto. */
  private exec(): Executor {
    const store = tenantALS.getStore();
    const run: RunFn = store
      ? (sql, params) => store.client.query(sql, params as unknown[])
      : (sql, params) => this.pool.query(sql, params as unknown[]);
    return makeExecutor(run);
  }

  query<T>(sql: string, params?: unknown[]) { return this.exec().query<T>(sql, params); }
  oneOrNone<T>(sql: string, params?: unknown[]) { return this.exec().oneOrNone<T>(sql, params); }
  none(sql: string, params?: unknown[]) { return this.exec().none(sql, params); }

  async tx<T>(fn: (e: Executor) => Promise<T>): Promise<T> {
    // Cada transacción usa su propio cliente (concurrencia), fijando el operador
    // del contexto actual para que la RLS aplique también dentro de la tx.
    const store = tenantALS.getStore();
    const client = await this.pool.connect();
    try {
      if (store) await client.query(`SELECT set_config('app.operator_id', $1, false)`, [store.operatorId]);
      await client.query('BEGIN');
      const exec = makeExecutor((sql, params) => client.query(sql, params as unknown[]));
      const result = await fn(exec);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      if (store) {
        try { await client.query('RESET app.operator_id'); } catch { /* noop */ }
      }
      client.release();
    }
  }

  async runWithContext<T>(operatorId: string, fn: () => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query(`SELECT set_config('app.operator_id', $1, false)`, [operatorId]);
      return await tenantALS.run({ client, operatorId }, fn);
    } finally {
      try { await client.query('RESET app.operator_id'); } catch { /* noop */ }
      client.release();
    }
  }

  runAsSystem<T>(fn: () => Promise<T>): Promise<T> {
    return this.runWithContext('__system__', fn);
  }

  async close() { await this.pool.end(); }
}

let instance: PgDb | null = null;

/** Aplica el esquema de forma idempotente (como sistema: crea RLS y backfill). */
export async function applySchema(db: Db): Promise<void> {
  await db.runAsSystem(() => db.none(SCHEMA_SQL));
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function getDb(): Promise<Db> {
  if (instance) return instance;
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: config.databasePoolMax });
  const db = new PgDb(pool);
  // La base de datos puede no estar lista en el primer intento (arranque en frío
  // del contenedor de Postgres). Reintentamos con backoff exponencial en lugar de
  // abortar el proceso, que provocaría un crash-loop del servicio.
  const maxAttempts = 10;
  for (let attempt = 1; ; attempt++) {
    try {
      await applySchema(db);
      break;
    } catch (err) {
      if (attempt >= maxAttempts) {
        await pool.end().catch(() => undefined);
        throw err;
      }
      const waitMs = Math.min(1000 * 2 ** (attempt - 1), 10_000);
      logger.warn('db_connect_retry', { attempt, maxAttempts, waitMs, error: String(err) });
      await sleep(waitMs);
    }
  }
  instance = db;
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
    // Cada conexión arranca en el esquema de prueba y bajo el operador por defecto,
    // de modo que las inserciones directas de los tests se escopan a op_default.
    options: `-c search_path=${schema} -c app.operator_id=op_default`,
  });
  const db = new PgDb(pool);
  await applySchema(db);
  return db;
}
