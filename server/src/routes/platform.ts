import { Router } from 'express';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import { asyncHandler } from '../middleware/error.js';
import { requireSuperAdmin } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { platformLogin, listOperators, createOperator, setOperatorStatus, updateOperatorBranding } from '../platform/platform.service.js';

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
const createOperatorSchema = z.object({ name: z.string().min(1).max(80), slug: z.string().min(3).max(32) });
const updateOperatorSchema = z.object({ status: z.enum(['active', 'suspended']) });
const brandingSchema = z.object({
  displayName: z.string().min(1).max(40),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color hex inválido (#RRGGBB).'),
  logoUrl: z.string().url().max(300).nullish(),
  tagline: z.string().max(80).optional(),
});

/**
 * Rutas de plataforma (super-admin). Se montan con contexto de sistema, de modo
 * que pueden gestionar todos los operadores. La autenticación es independiente
 * de la de los usuarios de cada operador.
 */
export function buildPlatformRouter(db: Db): Router {
  const r = Router();

  r.post(
    '/login',
    rateLimit(10, 'platform-auth'),
    asyncHandler(async (req, res) => {
      const { email, password } = loginSchema.parse(req.body);
      res.json(await platformLogin(db, email, password));
    }),
  );

  r.get(
    '/operators',
    requireSuperAdmin,
    asyncHandler(async (_req, res) => {
      res.json({ operators: await listOperators(db) });
    }),
  );

  r.post(
    '/operators',
    requireSuperAdmin,
    asyncHandler(async (req, res) => {
      const { name, slug } = createOperatorSchema.parse(req.body);
      res.status(201).json({ operator: await createOperator(db, name, slug) });
    }),
  );

  r.patch(
    '/operators/:id',
    requireSuperAdmin,
    asyncHandler(async (req, res) => {
      const { status } = updateOperatorSchema.parse(req.body);
      res.json({ operator: await setOperatorStatus(db, req.params.id, status) });
    }),
  );

  r.put(
    '/operators/:id/branding',
    requireSuperAdmin,
    asyncHandler(async (req, res) => {
      const b = brandingSchema.parse(req.body);
      const branding = {
        displayName: b.displayName,
        primaryColor: b.primaryColor,
        logoUrl: b.logoUrl ?? null,
        tagline: b.tagline ?? '',
      };
      res.json({ operator: await updateOperatorBranding(db, req.params.id, branding) });
    }),
  );

  return r;
}
