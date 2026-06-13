import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { getRedis } from '../infra/redis.js';

/**
 * Rate limiter por clave (scope + IP) con ventana fija de 1 minuto.
 * Primera línea de defensa antifraude/DoS. Si hay REDIS_URL, el contador se
 * comparte entre instancias (Redis); si no, o si Redis falla, cae a memoria.
 */
interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
const WINDOW_MS = 60_000;

interface Hit {
  remaining: number;
  limited: boolean;
}

function clientIp(req: Request): string {
  return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || 'unknown';
}

function memoryHit(key: string, max: number): Hit {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + WINDOW_MS };
    buckets.set(key, bucket);
  }
  bucket.count++;
  return { remaining: Math.max(0, max - bucket.count), limited: bucket.count > max };
}

async function redisHit(key: string, max: number): Promise<Hit> {
  const redis = getRedis()!;
  const windowId = Math.floor(Date.now() / WINDOW_MS);
  const rkey = `rl:${key}:${windowId}`;
  const count = await redis.incr(rkey);
  if (count === 1) await redis.pexpire(rkey, WINDOW_MS);
  return { remaining: Math.max(0, max - count), limited: count > max };
}

/**
 * Limita peticiones por minuto y por IP. Cada limitador usa su propio `scope`
 * para no compartir contador: así el límite estricto de auth no se agota con
 * el tráfico general (que pasa por el limitador global).
 */
export function rateLimit(maxPerMinute = config.rateLimitPerMinute, scope = 'global') {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const key = `${scope}:${clientIp(req)}`;
    let hit: Hit;
    if (getRedis()) {
      try {
        hit = await redisHit(key, maxPerMinute);
      } catch {
        hit = memoryHit(key, maxPerMinute); // Redis caído: protección local.
      }
    } else {
      hit = memoryHit(key, maxPerMinute);
    }

    res.setHeader('X-RateLimit-Limit', String(maxPerMinute));
    res.setHeader('X-RateLimit-Remaining', String(hit.remaining));
    if (hit.limited) {
      res.status(429).json({ error: { code: 'rate_limited', message: 'Demasiadas peticiones. Inténtelo más tarde.' } });
      return;
    }
    next();
  };
}

// Limpieza periódica de buckets en memoria caducados para no crecer sin límite.
setInterval(() => {
  const now = Date.now();
  for (const [key, b] of buckets) if (b.resetAt <= now) buckets.delete(key);
}, WINDOW_MS).unref?.();
