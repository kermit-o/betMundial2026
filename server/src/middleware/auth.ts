import type { NextFunction, Request, Response } from 'express';
import { AppError, type AuthUser } from '../types.js';
import { verifyToken } from '../auth/auth.service.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthUser;
    }
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    throw new AppError(401, 'unauthenticated', 'Falta el token de autenticación.');
  }
  req.auth = verifyToken(header.slice(7));
  next();
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.auth || req.auth.role !== 'admin') {
    throw new AppError(403, 'forbidden', 'Se requieren permisos de administrador.');
  }
  next();
}
