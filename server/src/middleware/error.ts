import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../types.js';
import { isProd } from '../config.js';
import { logger } from '../utils/logger.js';
import { incCounter } from '../observability/metrics.js';

/** Handler de errores centralizado: respuestas consistentes y sin filtrar internals. */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.httpStatus).json({ error: { code: err.code, message: err.message } });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: { code: 'validation_error', message: 'Datos de entrada inválidos.', issues: err.issues },
    });
    return;
  }
  // Error inesperado: log estructurado, métrica y respuesta genérica.
  incCounter('bet_http_unhandled_errors_total');
  logger.error('unhandled_error', { reqId: req.id, path: req.originalUrl, error: String((err as Error)?.stack ?? err) });
  res.status(500).json({
    error: {
      code: 'internal_error',
      message: isProd ? 'Se produjo un error interno.' : String((err as Error)?.message ?? err),
    },
  });
}

/** Envuelve handlers async para propagar rechazos al errorHandler. */
export function asyncHandler<T extends (req: Request, res: Response, next: NextFunction) => unknown>(fn: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
