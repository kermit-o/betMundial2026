import type Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import { createInMemoryDb } from '../src/db/index.js';
import type { User } from '../src/types.js';

export function freshDb(): Database.Database {
  return createInMemoryDb();
}

export function makeUser(db: Database.Database, overrides: Partial<User> = {}): User {
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const user: User = {
    id: nanoid(),
    email: `${nanoid(6)}@test.com`,
    password_hash: bcrypt.hashSync('Password1!', 8),
    full_name: 'Juan Pérez',
    date_of_birth: '1990-05-20',
    jurisdiction: 'ES',
    currency: 'EUR',
    role: 'user',
    kyc_status: 'verified',
    self_excluded_until: null,
    daily_deposit_limit: 50_000,
    daily_loss_limit: null,
    terms_accepted_at: now,
    signup_ip: '10.0.0.1',
    created_at: now,
    ...overrides,
  };
  db.prepare(
    `INSERT INTO users (id, email, password_hash, full_name, date_of_birth, jurisdiction, currency,
      role, kyc_status, self_excluded_until, daily_deposit_limit, daily_loss_limit, terms_accepted_at,
      signup_ip, created_at)
     VALUES (@id,@email,@password_hash,@full_name,@date_of_birth,@jurisdiction,@currency,@role,
      @kyc_status,@self_excluded_until,@daily_deposit_limit,@daily_loss_limit,@terms_accepted_at,
      @signup_ip,@created_at)`,
  ).run(user);
  db.prepare(`INSERT INTO wallets (user_id, balance, currency) VALUES (?, ?, ?)`).run(
    user.id,
    overrides.daily_deposit_limit === undefined ? 100_000 : 100_000,
    user.currency,
  );
  return user;
}

/** Crea un partido con un mercado 1x2 y devuelve ids útiles. */
export function makeMatchWith1x2(
  db: Database.Database,
  odds: { home: number; draw: number; away: number } = { home: 2.0, draw: 3.3, away: 3.5 },
) {
  const homeTeam = nanoid();
  const awayTeam = nanoid();
  db.prepare(`INSERT INTO teams (id,name,code,grp) VALUES (?,?,?,?)`).run(homeTeam, 'Local FC', 'LOC', 'A');
  db.prepare(`INSERT INTO teams (id,name,code,grp) VALUES (?,?,?,?)`).run(awayTeam, 'Visita FC', 'VIS', 'A');
  const matchId = nanoid();
  db.prepare(
    `INSERT INTO matches (id,stage,grp,home_team,away_team,kickoff,venue,status)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run(matchId, 'group', 'A', homeTeam, awayTeam, '2026-06-20T18:00:00Z', 'Estadio', 'scheduled');
  const marketId = nanoid();
  db.prepare(`INSERT INTO markets (id,match_id,type,name,status) VALUES (?,?,?,?,'open')`).run(
    marketId,
    matchId,
    '1x2',
    'Resultado (1X2)',
  );
  const selHome = nanoid();
  const selDraw = nanoid();
  const selAway = nanoid();
  db.prepare(`INSERT INTO selections (id,market_id,name,odds) VALUES (?,?,?,?)`).run(selHome, marketId, 'Local', odds.home);
  db.prepare(`INSERT INTO selections (id,market_id,name,odds) VALUES (?,?,?,?)`).run(selDraw, marketId, 'Empate', odds.draw);
  db.prepare(`INSERT INTO selections (id,market_id,name,odds) VALUES (?,?,?,?)`).run(selAway, marketId, 'Visitante', odds.away);
  return { matchId, marketId, selHome, selDraw, selAway, odds };
}
