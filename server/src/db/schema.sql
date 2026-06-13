-- Esquema de la plataforma de apuestas (PostgreSQL).
-- Importes monetarios en "minor units" (céntimos) como BIGINT.
-- Los timestamps se almacenan como TEXT en ISO-8601 UTC ('...Z'), fijados desde
-- el código (comparables lexicográfica = cronológicamente).

CREATE TABLE IF NOT EXISTS users (
  id                   TEXT PRIMARY KEY,
  email                TEXT NOT NULL UNIQUE,
  password_hash        TEXT NOT NULL,
  full_name            TEXT NOT NULL,
  date_of_birth        TEXT NOT NULL,
  jurisdiction         TEXT NOT NULL,
  currency             TEXT NOT NULL,
  role                 TEXT NOT NULL DEFAULT 'user',
  kyc_status           TEXT NOT NULL DEFAULT 'pending',
  email_verified       INTEGER NOT NULL DEFAULT 0,
  mfa_enabled          INTEGER NOT NULL DEFAULT 0,
  mfa_secret           TEXT,
  self_excluded_until  TEXT,
  daily_deposit_limit  BIGINT NOT NULL,
  daily_loss_limit     BIGINT,
  pending_deposit_limit       BIGINT,
  pending_deposit_effective   TEXT,
  pending_loss_limit          BIGINT,
  pending_loss_effective      TEXT,
  terms_accepted_at    TEXT,
  signup_ip            TEXT,
  created_at           TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wallets (
  user_id   TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance   BIGINT NOT NULL DEFAULT 0,
  currency  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,
  amount        BIGINT NOT NULL,
  balance_after BIGINT NOT NULL,
  ref_id        TEXT,
  status        TEXT NOT NULL DEFAULT 'completed',
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tx_user_time ON transactions(user_id, created_at);

CREATE TABLE IF NOT EXISTS payment_intents (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider        TEXT NOT NULL,
  type            TEXT NOT NULL,
  amount          BIGINT NOT NULL,
  currency        TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',
  idempotency_key TEXT NOT NULL,
  provider_ref    TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_idem ON payment_intents(user_id, idempotency_key);

CREATE TABLE IF NOT EXISTS kyc_cases (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider    TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',
  reference   TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_tokens (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  token_hash  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  used_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_authtoken_hash ON auth_tokens(token_hash);

CREATE TABLE IF NOT EXISTS teams (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL,
  code  TEXT NOT NULL,
  grp   TEXT
);

CREATE TABLE IF NOT EXISTS matches (
  id          TEXT PRIMARY KEY,
  stage       TEXT NOT NULL,
  grp         TEXT,
  home_team   TEXT NOT NULL REFERENCES teams(id),
  away_team   TEXT NOT NULL REFERENCES teams(id),
  kickoff     TEXT NOT NULL,
  venue       TEXT,
  status      TEXT NOT NULL DEFAULT 'scheduled',
  home_score  INTEGER,
  away_score  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_match_status ON matches(status, kickoff);

CREATE TABLE IF NOT EXISTS markets (
  id        TEXT PRIMARY KEY,
  match_id  TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  type      TEXT NOT NULL,
  name      TEXT NOT NULL,
  status    TEXT NOT NULL DEFAULT 'open'
);
CREATE INDEX IF NOT EXISTS idx_market_match ON markets(match_id);

CREATE TABLE IF NOT EXISTS selections (
  id          TEXT PRIMARY KEY,
  market_id   TEXT NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  odds        DOUBLE PRECISION NOT NULL,
  result      TEXT NOT NULL DEFAULT 'pending'
);
CREATE INDEX IF NOT EXISTS idx_selection_market ON selections(market_id);

CREATE TABLE IF NOT EXISTS bets (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type              TEXT NOT NULL DEFAULT 'single',
  stake             BIGINT NOT NULL,
  total_odds        DOUBLE PRECISION NOT NULL,
  potential_payout  BIGINT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'open',
  cash_out_value    BIGINT,
  risk_score        INTEGER NOT NULL DEFAULT 0,
  placed_at         TEXT NOT NULL,
  settled_at        TEXT
);
CREATE INDEX IF NOT EXISTS idx_bet_user ON bets(user_id, placed_at);

CREATE TABLE IF NOT EXISTS bet_legs (
  id            TEXT PRIMARY KEY,
  bet_id        TEXT NOT NULL REFERENCES bets(id) ON DELETE CASCADE,
  selection_id  TEXT NOT NULL REFERENCES selections(id),
  market_id     TEXT NOT NULL REFERENCES markets(id),
  match_id      TEXT NOT NULL REFERENCES matches(id),
  odds          DOUBLE PRECISION NOT NULL,
  result        TEXT NOT NULL DEFAULT 'pending'
);
CREATE INDEX IF NOT EXISTS idx_leg_bet ON bet_legs(bet_id);
CREATE INDEX IF NOT EXISTS idx_leg_selection ON bet_legs(selection_id);
CREATE INDEX IF NOT EXISTS idx_leg_match ON bet_legs(match_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id          TEXT PRIMARY KEY,
  user_id     TEXT,
  action      TEXT NOT NULL,
  detail      TEXT,
  ip          TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log(created_at);

CREATE TABLE IF NOT EXISTS fraud_flags (
  id          TEXT PRIMARY KEY,
  user_id     TEXT REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  severity    TEXT NOT NULL,
  detail      TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fraud_user ON fraud_flags(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_fraud_time ON fraud_flags(created_at);
