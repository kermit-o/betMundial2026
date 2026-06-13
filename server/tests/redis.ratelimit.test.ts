import { describe, it, expect } from 'vitest';
import { nanoid } from 'nanoid';
import { rateLimit } from '../src/middleware/rateLimit.js';
import { getRedis } from '../src/infra/redis.js';

// Sólo corre cuando hay un Redis disponible (REDIS_URL). En la suite por defecto
// (sin Redis) se omite: el rate-limit en memoria ya lo cubren otros tests.
const hasRedis = !!process.env.REDIS_URL;

function mockReq(ip: string) {
  return { headers: {}, ip } as never;
}

function mockRes() {
  const headers: Record<string, string> = {};
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    setHeader(k: string, v: string) {
      headers[k] = v;
    },
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(b: unknown) {
      res.body = b;
      return res;
    },
    headers,
  };
  return res;
}

async function run(mw: ReturnType<typeof rateLimit>, ip: string) {
  const res = mockRes();
  let passed = false;
  await mw(mockReq(ip), res as never, () => {
    passed = true;
  });
  return { res, passed };
}

describe.skipIf(!hasRedis)('rate limiter distribuido (Redis)', () => {
  it('usa Redis y bloquea al superar el límite, compartiendo el contador', async () => {
    expect(getRedis()).not.toBeNull();

    const scope = `test-${nanoid(8)}`;
    const ip = '203.0.113.7';
    const mw = rateLimit(3, scope);

    for (let i = 1; i <= 3; i++) {
      const { passed } = await run(mw, ip);
      expect(passed).toBe(true);
    }

    // La 4.ª petición supera el límite -> 429 (contador compartido en Redis).
    const fourth = await run(mw, ip);
    expect(fourth.passed).toBe(false);
    expect(fourth.res.statusCode).toBe(429);
    expect(fourth.res.headers['X-RateLimit-Remaining']).toBe('0');

    // El contador vive en Redis (clave rl:<scope>:<ip>:<ventana>).
    const redis = getRedis()!;
    const windowId = Math.floor(Date.now() / 60_000);
    const stored = await redis.get(`rl:${scope}:${ip}:${windowId}`);
    expect(Number(stored)).toBeGreaterThanOrEqual(4);
  });
});
