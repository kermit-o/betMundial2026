import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import { createTestDb, type Db } from '../src/db/index.js';
import type { User } from '../src/types.js';

export function freshDb(): Promise<Db> {
  return createTestDb();
}

export async function makeUser(db: Db, overrides: Partial<User> = {}): Promise<User> {
  const now = new Date().toISOString();
  const user: User = {
    id: nanoid(),
    operator_id: 'op_default',
    email: `${nanoid(6)}@test.com`,
    password_hash: bcrypt.hashSync('Password1!', 8),
    full_name: 'Juan Pérez',
    date_of_birth: '1990-05-20',
    jurisdiction: 'ES',
    currency: 'EUR',
    role: 'user',
    kyc_status: 'verified',
    email_verified: 1,
    mfa_enabled: 0,
    mfa_secret: null,
    self_excluded_until: null,
    daily_deposit_limit: 50_000,
    daily_loss_limit: null,
    pending_deposit_limit: null,
    pending_deposit_effective: null,
    pending_loss_limit: null,
    pending_loss_effective: null,
    terms_accepted_at: now,
    signup_ip: '10.0.0.1',
    created_at: now,
    ...overrides,
  };
  await db.none(
    `INSERT INTO users (id, email, password_hash, full_name, date_of_birth, jurisdiction, currency,
      role, kyc_status, email_verified, mfa_enabled, mfa_secret, self_excluded_until, daily_deposit_limit,
      daily_loss_limit, pending_deposit_limit, pending_deposit_effective, pending_loss_limit,
      pending_loss_effective, terms_accepted_at, signup_ip, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
    [
      user.id, user.email, user.password_hash, user.full_name, user.date_of_birth, user.jurisdiction,
      user.currency, user.role, user.kyc_status, user.email_verified, user.mfa_enabled, user.mfa_secret,
      user.self_excluded_until, user.daily_deposit_limit, user.daily_loss_limit, user.pending_deposit_limit,
      user.pending_deposit_effective, user.pending_loss_limit, user.pending_loss_effective,
      user.terms_accepted_at, user.signup_ip, user.created_at,
    ],
  );
  await db.none(`INSERT INTO wallets (user_id, balance, currency) VALUES ($1, $2, $3)`, [user.id, 100_000, user.currency]);
  return user;
}

/** Crea un partido con un mercado 1x2 y devuelve ids útiles. */
export async function makeMatchWith1x2(
  db: Db,
  odds: { home: number; draw: number; away: number } = { home: 2.0, draw: 3.3, away: 3.5 },
) {
  const homeTeam = nanoid();
  const awayTeam = nanoid();
  await db.none(`INSERT INTO teams (id,name,code,grp) VALUES ($1,$2,$3,$4)`, [homeTeam, 'Local FC', 'LOC', 'A']);
  await db.none(`INSERT INTO teams (id,name,code,grp) VALUES ($1,$2,$3,$4)`, [awayTeam, 'Visita FC', 'VIS', 'A']);
  const matchId = nanoid();
  await db.none(
    `INSERT INTO matches (id,stage,grp,home_team,away_team,kickoff,venue,status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'scheduled')`,
    [matchId, 'group', 'A', homeTeam, awayTeam, '2026-06-20T18:00:00Z', 'Estadio'],
  );
  const marketId = nanoid();
  await db.none(`INSERT INTO markets (id,match_id,type,name,status) VALUES ($1,$2,'1x2','Resultado (1X2)','open')`, [marketId, matchId]);
  const selHome = nanoid();
  const selDraw = nanoid();
  const selAway = nanoid();
  await db.none(`INSERT INTO selections (id,market_id,name,odds) VALUES ($1,$2,'Local',$3)`, [selHome, marketId, odds.home]);
  await db.none(`INSERT INTO selections (id,market_id,name,odds) VALUES ($1,$2,'Empate',$3)`, [selDraw, marketId, odds.draw]);
  await db.none(`INSERT INTO selections (id,market_id,name,odds) VALUES ($1,$2,'Visitante',$3)`, [selAway, marketId, odds.away]);
  return { matchId, marketId, selHome, selDraw, selAway, odds };
}
