import type { NextFunction, Request, Response } from 'express';
import { AppError, type AuthUser, type PlatformAuth } from '../types.js';
import { verifyToken } from '../auth/auth.service.js';
import { verifyPlatformToken } from '../platform/platform.service.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthUser;
      platformAdmin?: PlatformAuth;
    }
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    throw new AppError(401, 'unauthenticated', 'Falta el token de autenticación.');
  }
  const auth = verifyToken(header.slice(7));
  // El operador del token debe coincidir con el operador de la petición (resuelto
  // por subdominio/cabecera). Evita usar un token de un operador contra otro.
  if (req.operatorId && auth.operator_id !== req.operatorId) {
    throw new AppError(403, 'operator_mismatch', 'El token no pertenece a este operador.');
  }
  req.auth = auth;
  next();
}

export function requireSuperAdmin(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    throw new AppError(401, 'unauthenticated', 'Falta el token de autenticación.');
  }
  req.platformAdmin = verifyPlatformToken(header.slice(7));
  next();
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.auth || req.auth.role !== 'admin') {
    throw new AppError(403, 'forbidden', 'Se requieren permisos de administrador.');
  }
  next();
}
