import { Router, type Request } from 'express';
import type Database from 'better-sqlite3';
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
} from './schemas.js';
import { login, register } from '../auth/auth.service.js';
import { listMatches, getMatch } from '../betting/catalog.service.js';
import { placeBet, listUserBets, requireUser } from '../betting/betting.service.js';
import { settleMatch } from '../betting/settlement.service.js';
import { deposit, withdraw, getBalance, listTransactions } from '../wallet/wallet.service.js';
import {
  submitKyc,
  setDepositLimit,
  setLossLimit,
  selfExclude,
  publicProfile,
} from '../account/account.service.js';
import { listAllowedJurisdictions } from '../compliance/jurisdictions.js';

function ipOf(req: Request): string | null {
  return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || null;
}

export function buildRouter(db: Database.Database): Router {
  const r = Router();

  // --- Salud / metadatos ---
  r.get('/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));
  r.get('/jurisdictions', (_req, res) => res.json({ jurisdictions: listAllowedJurisdictions() }));

  // --- Auth (rate limit estricto para frenar fuerza bruta / abuso de registro) ---
  r.post(
    '/auth/register',
    rateLimit(10),
    asyncHandler((req, res) => {
      const input = registerSchema.parse(req.body);
      const { user, token } = register(db, input, ipOf(req));
      res.status(201).json({ token, user: publicProfile(user) });
    }),
  );

  r.post(
    '/auth/login',
    rateLimit(10),
    asyncHandler((req, res) => {
      const { email, password } = loginSchema.parse(req.body);
      const { user, token } = login(db, email, password, ipOf(req));
      res.json({ token, user: publicProfile(user) });
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
      const user = requireUser(db, req.auth!.id);
      res.json({ user: publicProfile(user), balance: getBalance(db, user.id) });
    }),
  );

  r.post(
    '/me/kyc',
    requireAuth,
    asyncHandler((req, res) => {
      const payload = kycSchema.parse(req.body);
      const user = requireUser(db, req.auth!.id);
      res.json(submitKyc(db, user, payload, ipOf(req)));
    }),
  );

  r.put(
    '/me/limits/deposit',
    requireAuth,
    asyncHandler((req, res) => {
      const { amount } = depositLimitSchema.parse(req.body);
      const user = requireUser(db, req.auth!.id);
      setDepositLimit(db, user, amount, ipOf(req));
      res.json({ ok: true });
    }),
  );

  r.put(
    '/me/limits/loss',
    requireAuth,
    asyncHandler((req, res) => {
      const { amount } = lossLimitSchema.parse(req.body);
      const user = requireUser(db, req.auth!.id);
      setLossLimit(db, user, amount, ipOf(req));
      res.json({ ok: true });
    }),
  );

  r.post(
    '/me/self-exclude',
    requireAuth,
    asyncHandler((req, res) => {
      const { days } = selfExcludeSchema.parse(req.body);
      const user = requireUser(db, req.auth!.id);
      res.json(selfExclude(db, user, days, ipOf(req)));
    }),
  );

  // --- Cartera ---
  r.get(
    '/wallet',
    requireAuth,
    asyncHandler((req, res) => {
      res.json({ balance: getBalance(db, req.auth!.id), transactions: listTransactions(db, req.auth!.id) });
    }),
  );

  r.post(
    '/wallet/deposit',
    requireAuth,
    rateLimit(30),
    asyncHandler((req, res) => {
      const { amount } = amountSchema.parse(req.body);
      const user = requireUser(db, req.auth!.id);
      const tx = deposit(db, user, amount, ipOf(req));
      res.status(201).json({ transaction: tx, balance: tx.balance_after });
    }),
  );

  r.post(
    '/wallet/withdraw',
    requireAuth,
    rateLimit(30),
    asyncHandler((req, res) => {
      const { amount } = amountSchema.parse(req.body);
      const user = requireUser(db, req.auth!.id);
      const tx = withdraw(db, user, amount, ipOf(req));
      res.status(201).json({ transaction: tx, balance: tx.balance_after });
    }),
  );

  // --- Apuestas ---
  r.post(
    '/bets',
    requireAuth,
    rateLimit(60),
    asyncHandler((req, res) => {
      const input = placeBetSchema.parse(req.body);
      const user = requireUser(db, req.auth!.id);
      const bet = placeBet(db, user, input, ipOf(req));
      res.status(201).json({ bet, balance: getBalance(db, user.id) });
    }),
  );

  r.get(
    '/bets',
    requireAuth,
    asyncHandler((req, res) => {
      res.json({ bets: listUserBets(db, req.auth!.id) });
    }),
  );

  // --- Administración (liquidación de partidos) ---
  r.post(
    '/admin/matches/:id/settle',
    requireAuth,
    requireAdmin,
    asyncHandler((req, res) => {
      const { homeScore, awayScore } = settleSchema.parse(req.body);
      res.json(settleMatch(db, req.params.id, homeScore, awayScore));
    }),
  );

  return r;
}
