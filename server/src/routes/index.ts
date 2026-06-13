import { Router, type Request } from 'express';
import type Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
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

function ipOf(req: Request): string | null {
  return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || null;
}

/** Carga el usuario actual y promueve cualquier límite pendiente ya vigente. */
function loadUser(db: Database.Database, req: Request) {
  return applyPendingLimits(db, requireUser(db, req.auth!.id));
}

export function buildRouter(db: Database.Database): Router {
  const r = Router();

  // --- Salud / metadatos ---
  r.get('/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));
  r.get('/jurisdictions', (_req, res) => res.json({ jurisdictions: listAllowedJurisdictions() }));

  // --- Auth ---
  r.post(
    '/auth/register',
    rateLimit(10, 'auth'),
    asyncHandler((req, res) => {
      const input = registerSchema.parse(req.body);
      const { user, token } = register(db, input, ipOf(req));
      res.status(201).json({ token, user: publicProfile(user) });
    }),
  );

  r.post(
    '/auth/login',
    rateLimit(10, 'auth'),
    asyncHandler((req, res) => {
      const { email, password, mfaCode } = loginSchema.parse(req.body);
      const { user, token } = login(db, email, password, ipOf(req), mfaCode);
      res.json({ token, user: publicProfile(user) });
    }),
  );

  r.post(
    '/auth/forgot-password',
    rateLimit(5, 'auth'),
    asyncHandler((req, res) => {
      const { email } = forgotPasswordSchema.parse(req.body);
      const { token } = requestPasswordReset(db, email);
      // Respuesta neutra (anti-enumeración). En la demo devolvemos el token.
      res.json({ ok: true, ...(token ? { devToken: token } : {}) });
    }),
  );

  r.post(
    '/auth/reset-password',
    rateLimit(10, 'auth'),
    asyncHandler((req, res) => {
      const { token, newPassword } = resetPasswordSchema.parse(req.body);
      resetPassword(db, token, newPassword);
      res.json({ ok: true });
    }),
  );

  r.post(
    '/auth/verify-email',
    rateLimit(20, 'auth'),
    asyncHandler((req, res) => {
      const { token } = verifyEmailSchema.parse(req.body);
      verifyEmail(db, token);
      res.json({ ok: true });
    }),
  );

  // --- Catálogo de partidos / cuotas (público) ---
  r.get(
    '/matches',
    asyncHandler((req, res) => {
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      res.json({ matches: listMatches(db, status) });
    }),
  );
  r.get(
    '/matches/:id',
    asyncHandler((req, res) => {
      const match = getMatch(db, req.params.id);
      if (!match) return res.status(404).json({ error: { code: 'not_found', message: 'Partido no encontrado.' } });
      res.json({ match });
    }),
  );

  // --- Perfil / cuenta ---
  r.get(
    '/me',
    requireAuth,
    asyncHandler((req, res) => {
      const user = loadUser(db, req);
      res.json({ user: publicProfile(user), balance: getBalance(db, user.id) });
    }),
  );

  r.get(
    '/me/reality-check',
    requireAuth,
    asyncHandler((req, res) => res.json(realityCheck(db, req.auth!.id))),
  );

  r.post(
    '/me/kyc',
    requireAuth,
    asyncHandler((req, res) => {
      const payload = kycSchema.parse(req.body);
      res.json(submitKyc(db, loadUser(db, req), payload, ipOf(req)));
    }),
  );

  r.post(
    '/me/email/verify-request',
    requireAuth,
    asyncHandler((req, res) => {
      const { token } = requestEmailVerification(db, loadUser(db, req));
      res.json({ ok: true, devToken: token });
    }),
  );

  r.put(
    '/me/limits/deposit',
    requireAuth,
    asyncHandler((req, res) => {
      const { amount } = depositLimitSchema.parse(req.body);
      res.json(setDepositLimit(db, loadUser(db, req), amount, ipOf(req)));
    }),
  );

  r.put(
    '/me/limits/loss',
    requireAuth,
    asyncHandler((req, res) => {
      const { amount } = lossLimitSchema.parse(req.body);
      res.json(setLossLimit(db, loadUser(db, req), amount, ipOf(req)));
    }),
  );

  r.post(
    '/me/self-exclude',
    requireAuth,
    asyncHandler((req, res) => {
      const { days } = selfExcludeSchema.parse(req.body);
      res.json(selfExclude(db, loadUser(db, req), days, ipOf(req)));
    }),
  );

  // --- MFA ---
  r.post(
    '/me/mfa/setup',
    requireAuth,
    asyncHandler((req, res) => res.json(setupMfa(db, loadUser(db, req)))),
  );
  r.post(
    '/me/mfa/enable',
    requireAuth,
    asyncHandler((req, res) => {
      const { code } = mfaEnableSchema.parse(req.body);
      enableMfa(db, loadUser(db, req), code);
      res.json({ ok: true, mfa_enabled: true });
    }),
  );
  r.post(
    '/me/mfa/disable',
    requireAuth,
    asyncHandler((req, res) => {
      const { code } = mfaDisableSchema.parse(req.body);
      disableMfa(db, loadUser(db, req), code);
      res.json({ ok: true, mfa_enabled: false });
    }),
  );

  // --- Cartera y pagos ---
  r.get(
    '/wallet',
    requireAuth,
    asyncHandler((req, res) => {
      res.json({
        balance: getBalance(db, req.auth!.id),
        transactions: listTransactions(db, req.auth!.id),
        payments: listPaymentIntents(db, req.auth!.id),
      });
    }),
  );

  r.post(
    '/wallet/deposit',
    requireAuth,
    rateLimit(30, 'wallet'),
    asyncHandler((req, res) => {
      const { amount, idempotencyKey } = amountSchema.parse(req.body);
      const key = idempotencyKey ?? (req.headers['idempotency-key'] as string) ?? nanoid();
      const { intent, balance } = initiateDeposit(db, loadUser(db, req), amount, key, ipOf(req));
      res.status(201).json({ intent, balance });
    }),
  );

  r.post(
    '/wallet/withdraw',
    requireAuth,
    rateLimit(30, 'wallet'),
    asyncHandler((req, res) => {
      const { amount, idempotencyKey } = amountSchema.parse(req.body);
      const key = idempotencyKey ?? (req.headers['idempotency-key'] as string) ?? nanoid();
      const { intent, balance } = initiatePayout(db, loadUser(db, req), amount, key, ipOf(req));
      res.status(201).json({ intent, balance });
    }),
  );

  // Webhook de confirmaciones de pago (firmado). Cuerpo crudo en req.rawBody.
  r.post(
    '/webhooks/payments',
    asyncHandler((req, res) => {
      const raw = (req as Request & { rawBody?: string }).rawBody ?? JSON.stringify(req.body);
      const sig = req.headers['x-signature'] as string | undefined;
      res.json(handleWebhook(db, raw, sig));
    }),
  );

  // --- Apuestas ---
  r.post(
    '/bets',
    requireAuth,
    rateLimit(60, 'bets'),
    asyncHandler((req, res) => {
      const input = placeBetSchema.parse(req.body);
      const user = loadUser(db, req);
      const bet = placeBet(db, user, input, ipOf(req));
      res.status(201).json({ bet, balance: getBalance(db, user.id) });
    }),
  );

  r.get(
    '/bets',
    requireAuth,
    asyncHandler((req, res) => res.json({ bets: listUserBets(db, req.auth!.id) })),
  );

  r.post(
    '/bets/:id/cashout',
    requireAuth,
    rateLimit(60, 'bets'),
    asyncHandler((req, res) => {
      const user = loadUser(db, req);
      res.json(cashOut(db, user, req.params.id, ipOf(req)));
    }),
  );

  // --- Administración ---
  r.get('/admin/stats', requireAuth, requireAdmin, asyncHandler((_req, res) => res.json(adminStats(db))));
  r.get('/admin/fraud-flags', requireAuth, requireAdmin, asyncHandler((_req, res) => res.json({ flags: listFraudFlags(db) })));
  r.get('/admin/audit', requireAuth, requireAdmin, asyncHandler((_req, res) => res.json({ entries: listAuditLog(db) })));
  r.get('/admin/users', requireAuth, requireAdmin, asyncHandler((_req, res) => res.json({ users: listUsers(db) })));

  r.post(
    '/admin/matches/:id/settle',
    requireAuth,
    requireAdmin,
    asyncHandler((req, res) => {
      const { homeScore, awayScore } = settleSchema.parse(req.body);
      res.json(settleMatch(db, req.params.id, homeScore, awayScore));
    }),
  );

  r.post(
    '/admin/markets/:id/status',
    requireAuth,
    requireAdmin,
    asyncHandler((req, res) => {
      const { status } = marketStatusSchema.parse(req.body);
      res.json(setMarketStatus(db, req.params.id, status, req.auth!.id));
    }),
  );

  r.post(
    '/admin/users/:id/kyc',
    requireAuth,
    requireAdmin,
    asyncHandler((req, res) => {
      const { status } = forceKycSchema.parse(req.body);
      res.json(forceKycStatus(db, req.params.id, status, req.auth!.id));
    }),
  );

  return r;
}
