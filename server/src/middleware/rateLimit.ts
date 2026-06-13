import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';

/**
 * Rate limiter en memoria por clave (IP) con ventana deslizante simple.
 * Primera línea de defensa antifraude/DoS. En un despliegue multi-instancia
 * se respaldaría en Redis; aquí basta para una instancia con baja latencia.
 */
interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
const WINDOW_MS = 60_000;

function clientKey(req: Request): string {
  return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || 'unknown';
}

export function rateLimit(maxPerMinute = config.rateLimitPerMinute) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = clientKey(req);
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + WINDOW_MS };
      buckets.set(key, bucket);
    }
    bucket.count++;
    res.setHeader('X-RateLimit-Limit', String(maxPerMinute));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, maxPerMinute - bucket.count)));
    if (bucket.count > maxPerMinute) {
      res.status(429).json({ error: { code: 'rate_limited', message: 'Demasiadas peticiones. Inténtelo más tarde.' } });
      return;
    }
    next();
  };
}

// Limpieza periódica de buckets caducados para no crecer sin límite.
setInterval(() => {
  const now = Date.now();
  for (const [key, b] of buckets) if (b.resetAt <= now) buckets.delete(key);
}, WINDOW_MS).unref?.();
