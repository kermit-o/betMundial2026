import type { NextFunction, Request, Response } from 'express';
import crypto from 'node:crypto';
import { logger } from '../utils/logger.js';
import { incCounter, observeLatency } from '../observability/metrics.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}

/** Etiqueta de ruta de baja cardinalidad (patrón, no la URL concreta). */
function routeLabel(req: Request): string {
  const base = (req.baseUrl || '') + ((req.route && req.route.path) || '');
  return base || 'unknown';
}

/**
 * Asigna un request-id, registra la petición (método, ruta, estado, duración) y
 * alimenta las métricas HTTP. El request-id se devuelve en la cabecera para
 * correlación extremo a extremo.
 */
export function requestLog(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();
  req.id = (req.headers['x-request-id'] as string) || crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);

  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    const route = routeLabel(req);
    const status = String(res.statusCode);
    incCounter('bet_http_requests_total', { method: req.method, route, status });
    observeLatency('bet_http_request_duration_ms', { method: req.method, route }, ms);

    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    logger[level]('http_request', {
      reqId: req.id,
      method: req.method,
      path: req.originalUrl,
      route,
      status: res.statusCode,
      durationMs: Math.round(ms * 100) / 100,
      ip: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip,
    });
  });

  next();
}
