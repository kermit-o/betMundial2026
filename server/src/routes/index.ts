import { Router, type Request } from 'express';
import { nanoid } from 'nanoid';
import type { Db } from '../db/index.js';
import { asyncHandler } from '../middleware/error.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import {
  registerSchema,
  loginSchema,
  amountSchema,
  placeBetSchema,
  kycSchema,
  depositLimitSchema,
  lossLimitSchema,
  selfExcludeSchema,
  settleSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  verifyEmailSchema,
  mfaEnableSchema,
  mfaDisableSchema,
  marketStatusSchema,
  forceKycSchema,
} from './schemas.js';
import { login, register } from '../auth/auth.service.js';
import {
  requestEmailVerification,
  verifyEmail,
  requestPasswordReset,
  resetPassword,
  setupMfa,
  enableMfa,
  disableMfa,
} from '../auth/security.service.js';
import { listMatches, getMatch } from '../betting/catalog.service.js';
import { placeBet, listUserBets, cashOut, requireUser } from '../betting/betting.service.js';
import { settleMatch } from '../betting/settlement.service.js';
import { getBalance, listTransactions } from '../wallet/wallet.service.js';
import { initiateDeposit, initiatePayout, handleWebhook, listPaymentIntents } from '../payments/payments.service.js';
import {
  submitKyc,
  setDepositLimit,
  setLossLimit,
  selfExclude,
  applyPendingLimits,
  realityCheck,
  publicProfile,
} from '../account/account.service.js';
import {
  listFraudFlags,
  listAuditLog,
  listUsers,
  setMarketStatus,
  forceKycStatus,
  adminStats,
} from '../admin/admin.service.js';
import { listAllowedJurisdictions } from '../compliance/jurisdictions.js';
import { getBranding } from '../platform/platform.service.js';
import type { User } from '../types.js';

function ipOf(req: Request): string | null {
  return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || null;
}

/** Carga el usuario actual y promueve cualquier límite pendiente ya vigente. */
async function loadUser(db: Db, req: Request): Promise<User> {
  return applyPendingLimits(db, await requireUser(db, req.auth!.id));
}

export function buildRouter(db: Db): Router {
  const r = Router();

  // --- Salud / metadatos ---
  r.get('/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));
  r.get('/jurisdictions', (_req, res) => res.json({ jurisdictions: listAllowedJurisdictions() }));
  // Marca blanca del operador actual (pública: la usa el frontend antes del login).
  r.get('/branding', asyncHandler(async (req, res) => {
    res.json(await getBranding(db, req.operatorId!));
  }));

  // --- Auth ---
  r.post(
    '/auth/register',
    rateLimit(10, 'auth'),
    asyncHandler(async (req, res) => {
      const input = registerSchema.parse(req.body);
      const { user, token } = await register(db, input, ipOf(req), req.operatorId!);
      res.status(201).json({ token, user: publicProfile(user) });
    }),
  );

  r.post(
    '/auth/login',
    rateLimit(10, 'auth'),
    asyncHandler(async (req, res) => {
      const { email, password, mfaCode } = loginSchema.parse(req.body);
      const { user, token } = await login(db, email, password, ipOf(req), mfaCode);
      res.json({ token, user: publicProfile(user) });
    }),
  );

  r.post(
    '/auth/forgot-password',
    rateLimit(5, 'auth'),
    asyncHandler(async (req, res) => {
      const { email } = forgotPasswordSchema.parse(req.body);
      const { token } = await requestPasswordReset(db, email);
      res.json({ ok: true, ...(token ? { devToken: token } : {}) });
    }),
  );

  r.post(
    '/auth/reset-password',
    rateLimit(10, 'auth'),
    asyncHandler(async (req, res) => {
      const { token, newPassword } = resetPasswordSchema.parse(req.body);
      await resetPassword(db, token, newPassword);
      res.json({ ok: true });
    }),
  );

  r.post(
    '/auth/verify-email',
    rateLimit(20, 'auth'),
    asyncHandler(async (req, res) => {
      const { token } = verifyEmailSchema.parse(req.body);
      await verifyEmail(db, token);
      res.json({ ok: true });
    }),
  );

  // --- Catálogo de partidos / cuotas (público) ---
  r.get(
    '/matches',
    asyncHandler(async (req, res) => {
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      res.json({ matches: await listMatches(db, status) });
    }),
  );
  r.get(
    '/matches/:id',
    asyncHandler(async (req, res) => {
      const match = await getMatch(db, req.params.id);
      if (!match) return res.status(404).json({ error: { code: 'not_found', message: 'Partido no encontrado.' } });
      res.json({ match });
    }),
  );

  // --- Perfil / cuenta ---
  r.get(
    '/me',
    requireAuth,
    asyncHandler(async (req, res) => {
      const user = await loadUser(db, req);
      res.json({ user: publicProfile(user), balance: await getBalance(db, user.id) });
    }),
  );

  r.get(
    '/me/reality-check',
    requireAuth,
    asyncHandler(async (req, res) => res.json(await realityCheck(db, req.auth!.id))),
  );

  r.post(
    '/me/kyc',
    requireAuth,
    asyncHandler(async (req, res) => {
      const payload = kycSchema.parse(req.body);
      res.json(await submitKyc(db, await loadUser(db, req), payload, ipOf(req)));
    }),
  );

  r.post(
    '/me/email/verify-request',
    requireAuth,
    asyncHandler(async (req, res) => {
      const { token } = await requestEmailVerification(db, await loadUser(db, req));
      res.json({ ok: true, devToken: token });
    }),
  );

  r.put(
    '/me/limits/deposit',
    requireAuth,
    asyncHandler(async (req, res) => {
      const { amount } = depositLimitSchema.parse(req.body);
      res.json(await setDepositLimit(db, await loadUser(db, req), amount, ipOf(req)));
    }),
  );

  r.put(
    '/me/limits/loss',
    requireAuth,
    asyncHandler(async (req, res) => {
      const { amount } = lossLimitSchema.parse(req.body);
      res.json(await setLossLimit(db, await loadUser(db, req), amount, ipOf(req)));
    }),
  );

  r.post(
    '/me/self-exclude',
    requireAuth,
    asyncHandler(async (req, res) => {
      const { days } = selfExcludeSchema.parse(req.body);
      res.json(await selfExclude(db, await loadUser(db, req), days, ipOf(req)));
    }),
  );

  // --- MFA ---
  r.post(
    '/me/mfa/setup',
    requireAuth,
    asyncHandler(async (req, res) => res.json(await setupMfa(db, await loadUser(db, req)))),
  );
  r.post(
    '/me/mfa/enable',
    requireAuth,
    asyncHandler(async (req, res) => {
      const { code } = mfaEnableSchema.parse(req.body);
      await enableMfa(db, await loadUser(db, req), code);
      res.json({ ok: true, mfa_enabled: true });
    }),
  );
  r.post(
    '/me/mfa/disable',
    requireAuth,
    asyncHandler(async (req, res) => {
      const { code } = mfaDisableSchema.parse(req.body);
      await disableMfa(db, await loadUser(db, req), code);
      res.json({ ok: true, mfa_enabled: false });
    }),
  );

  // --- Cartera y pagos ---
  r.get(
    '/wallet',
    requireAuth,
    asyncHandler(async (req, res) => {
      res.json({
        balance: await getBalance(db, req.auth!.id),
        transactions: await listTransactions(db, req.auth!.id),
        payments: await listPaymentIntents(db, req.auth!.id),
      });
    }),
  );

  r.post(
    '/wallet/deposit',
    requireAuth,
    rateLimit(30, 'wallet'),
    asyncHandler(async (req, res) => {
      const { amount, idempotencyKey } = amountSchema.parse(req.body);
      const key = idempotencyKey ?? (req.headers['idempotency-key'] as string) ?? nanoid();
      const { intent, balance, redirectUrl } = await initiateDeposit(db, await loadUser(db, req), amount, key, ipOf(req));
      res.status(201).json({ intent, balance, redirectUrl });
    }),
  );

  r.post(
    '/wallet/withdraw',
    requireAuth,
    rateLimit(30, 'wallet'),
    asyncHandler(async (req, res) => {
      const { amount, idempotencyKey } = amountSchema.parse(req.body);
      const key = idempotencyKey ?? (req.headers['idempotency-key'] as string) ?? nanoid();
      const { intent, balance } = await initiatePayout(db, await loadUser(db, req), amount, key, ipOf(req));
      res.status(201).json({ intent, balance });
    }),
  );

  // Webhook de confirmaciones de pago (firmado). Cuerpo crudo en req.rawBody.
  r.post(
    '/webhooks/payments',
    asyncHandler(async (req, res) => {
      const raw = (req as Request & { rawBody?: string }).rawBody ?? JSON.stringify(req.body);
      // Stripe firma en 'stripe-signature'; el sandbox usa 'x-signature'.
      const sig = (req.headers['stripe-signature'] ?? req.headers['x-signature']) as string | undefined;
      res.json(await handleWebhook(db, raw, sig));
    }),
  );

  // --- Apuestas ---
  r.post(
    '/bets',
    requireAuth,
    rateLimit(60, 'bets'),
    asyncHandler(async (req, res) => {
      const input = placeBetSchema.parse(req.body);
      const user = await loadUser(db, req);
      const bet = await placeBet(db, user, input, ipOf(req));
      res.status(201).json({ bet, balance: await getBalance(db, user.id) });
    }),
  );

  r.get(
    '/bets',
    requireAuth,
    asyncHandler(async (req, res) => res.json({ bets: await listUserBets(db, req.auth!.id) })),
  );

  r.post(
    '/bets/:id/cashout',
    requireAuth,
    rateLimit(60, 'bets'),
    asyncHandler(async (req, res) => {
      const user = await loadUser(db, req);
      res.json(await cashOut(db, user, req.params.id, ipOf(req)));
    }),
  );

  // --- Administración ---
  r.get('/admin/stats', requireAuth, requireAdmin, asyncHandler(async (_req, res) => res.json(await adminStats(db))));
  r.get('/admin/fraud-flags', requireAuth, requireAdmin, asyncHandler(async (_req, res) => res.json({ flags: await listFraudFlags(db) })));
  r.get('/admin/audit', requireAuth, requireAdmin, asyncHandler(async (_req, res) => res.json({ entries: await listAuditLog(db) })));
  r.get('/admin/users', requireAuth, requireAdmin, asyncHandler(async (_req, res) => res.json({ users: await listUsers(db) })));

  r.post(
    '/admin/matches/:id/settle',
    requireAuth,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const { homeScore, awayScore } = settleSchema.parse(req.body);
      res.json(await settleMatch(db, req.params.id, homeScore, awayScore));
    }),
  );

  r.post(
    '/admin/markets/:id/status',
    requireAuth,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const { status } = marketStatusSchema.parse(req.body);
      res.json(await setMarketStatus(db, req.params.id, status, req.auth!.id));
    }),
  );

  r.post(
    '/admin/users/:id/kyc',
    requireAuth,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const { status } = forceKycSchema.parse(req.body);
      res.json(await forceKycStatus(db, req.params.id, status, req.auth!.id));
    }),
  );

  return r;
}
