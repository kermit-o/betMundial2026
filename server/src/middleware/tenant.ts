import type { NextFunction, Request, Response } from 'express';
import type { Db } from '../db/index.js';
import { config } from '../config.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      operatorId?: string;
    }
  }
}

/**
 * Fija el operador (tenant) de cada petición y ejecuta el resto del flujo dentro
 * de su contexto de BD, de modo que la RLS de PostgreSQL aísla los datos por
 * operador. Fase 1: el operador viene de la cabecera `X-Operator-Id` o del
 * operador por defecto; la Fase 2 lo resolverá por subdominio.
 */
export function tenantContext(db: Db) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers['x-operator-id'];
    const operatorId = (typeof header === 'string' && header.trim()) || config.defaultOperatorId;
    req.operatorId = operatorId;
    db.runWithContext(
      operatorId,
      () =>
        new Promise<void>((resolve) => {
          res.on('finish', resolve);
          res.on('close', resolve);
          next();
        }),
    ).catch(next);
  };
}
