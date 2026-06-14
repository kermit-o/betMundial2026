import type { NextFunction, Request, Response } from 'express';
import type { Db } from '../db/index.js';
import { config } from '../config.js';
import { AppError } from '../types.js';
import { findOperatorBySlug, type Operator } from '../platform/platform.service.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      operatorId?: string;
    }
  }
}

// Subdominios reservados que NO identifican a un operador.
const RESERVED = new Set(['www', 'api', 'admin', 'app']);

// Caché breve de slug -> operador para no consultar la BD en cada petición.
const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { op: Operator | null; exp: number }>();

function extractSubdomain(hostname: string, baseDomain: string): string | null {
  if (hostname === baseDomain) return null;
  if (!hostname.endsWith('.' + baseDomain)) return null;
  const sub = hostname.slice(0, hostname.length - baseDomain.length - 1);
  // Solo un nivel de subdominio y no reservado.
  if (!sub || sub.includes('.') || RESERVED.has(sub)) return null;
  return sub;
}

async function lookupBySlug(db: Db, slug: string): Promise<Operator | null> {
  const cached = cache.get(slug);
  if (cached && cached.exp > Date.now()) return cached.op;
  const op = (await findOperatorBySlug(db, slug)) ?? null;
  cache.set(slug, { op, exp: Date.now() + CACHE_TTL_MS });
  return op;
}

async function resolveOperatorId(db: Db, req: Request): Promise<string> {
  // 1) Subdominio (producción multi-operador).
  if (config.platformBaseDomain) {
    const sub = extractSubdomain(req.hostname, config.platformBaseDomain);
    if (sub) {
      const op = await lookupBySlug(db, sub);
      if (!op) throw new AppError(404, 'operator_not_found', 'Operador desconocido.');
      if (op.status !== 'active') throw new AppError(403, 'operator_suspended', 'Operador no disponible.');
      return op.id;
    }
  }
  // 2) Cabecera explícita (clientes API / pruebas).
  const header = req.headers['x-operator-id'];
  if (typeof header === 'string' && header.trim()) return header.trim();
  // 3) Operador por defecto (instalación de un solo operador).
  return config.defaultOperatorId;
}

/**
 * Fija el operador (tenant) de cada petición y ejecuta el resto del flujo dentro
 * de su contexto de BD, de modo que la RLS de PostgreSQL aísla los datos por
 * operador. Resuelve por subdominio, cabecera `X-Operator-Id` o el operador por
 * defecto, en ese orden.
 */
export function tenantContext(db: Db) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const operatorId = await resolveOperatorId(db, req);
      req.operatorId = operatorId;
      await db.runWithContext(
        operatorId,
        () =>
          new Promise<void>((resolve) => {
            res.on('finish', resolve);
            res.on('close', resolve);
            next();
          }),
      );
    } catch (err) {
      next(err);
    }
  };
}
