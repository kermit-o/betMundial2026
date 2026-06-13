-- Esquema de la plataforma de apuestas (SQLite).
-- Todos los importes monetarios se almacenan en "minor units" (céntimos) como enteros
-- para evitar errores de coma flotante en operaciones financieras.

PRAGMA journal_mode = WAL;      -- concurrencia lectura/escritura y baja latencia
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS users (
  id                   TEXT PRIMARY KEY,
  email                TEXT NOT NULL UNIQUE,
  password_hash        TEXT NOT NULL,
  full_name            TEXT NOT NULL,
  date_of_birth        TEXT NOT NULL,              -- ISO YYYY-MM-DD
  jurisdiction         TEXT NOT NULL,              -- ISO 3166-1 alpha-2
  currency             TEXT NOT NULL,
  role                 TEXT NOT NULL DEFAULT 'user',  -- user | admin
  kyc_status           TEXT NOT NULL DEFAULT 'pending', -- pending | verified | rejected
  self_excluded_until  TEXT,                       -- ISO datetime o NULL
  daily_deposit_limit  INTEGER NOT NULL,
  daily_loss_limit     INTEGER,
  terms_accepted_at    TEXT,
  signup_ip            TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS wallets (
  user_id   TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance   INTEGER NOT NULL DEFAULT 0,           -- saldo disponible
  currency  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,   -- deposit | withdrawal | bet_stake | bet_payout | refund
  amount        INTEGER NOT NULL,-- positivo abona, negativo carga
  balance_after INTEGER NOT NULL,
  ref_id        TEXT,            -- p.ej. bet id
  status        TEXT NOT NULL DEFAULT 'completed', -- completed | pending | flagged | rejected
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tx_user_time ON transactions(user_id, created_at);

CREATE TABLE IF NOT EXISTS teams (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL,
  code  TEXT NOT NULL,
  grp   TEXT
);

CREATE TABLE IF NOT EXISTS matches (
  id          TEXT PRIMARY KEY,
  stage       TEXT NOT NULL,    -- group | round16 | quarter | semi | final
  grp         TEXT,
  home_team   TEXT NOT NULL REFERENCES teams(id),
  away_team   TEXT NOT NULL REFERENCES teams(id),
  kickoff     TEXT NOT NULL,    -- ISO datetime
  venue       TEXT,
  status      TEXT NOT NULL DEFAULT 'scheduled', -- scheduled | live | finished | cancelled
  home_score  INTEGER,
  away_score  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_match_status ON matches(status, kickoff);

CREATE TABLE IF NOT EXISTS markets (
  id        TEXT PRIMARY KEY,
  match_id  TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  type      TEXT NOT NULL,   -- 1x2 | over_under_2_5 | btts
  name      TEXT NOT NULL,
  status    TEXT NOT NULL DEFAULT 'open' -- open | suspended | settled
);
CREATE INDEX IF NOT EXISTS idx_market_match ON markets(match_id);

CREATE TABLE IF NOT EXISTS selections (
  id          TEXT PRIMARY KEY,
  market_id   TEXT NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  odds        REAL NOT NULL,   -- cuota decimal
  result      TEXT NOT NULL DEFAULT 'pending' -- pending | won | lost | void
);
CREATE INDEX IF NOT EXISTS idx_selection_market ON selections(market_id);

CREATE TABLE IF NOT EXISTS bets (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  selection_id      TEXT NOT NULL REFERENCES selections(id),
  market_id         TEXT NOT NULL REFERENCES markets(id),
  match_id          TEXT NOT NULL REFERENCES matches(id),
  stake             INTEGER NOT NULL,
  odds              REAL NOT NULL,     -- cuota bloqueada al apostar
  potential_payout  INTEGER NOT NULL,
  status            TEXT NOT NULL DEFAULT 'open', -- open | won | lost | void
  risk_score        INTEGER NOT NULL DEFAULT 0,
  placed_at         TEXT NOT NULL DEFAULT (datetime('now')),
  settled_at        TEXT
);
CREATE INDEX IF NOT EXISTS idx_bet_user ON bets(user_id, placed_at);
CREATE INDEX IF NOT EXISTS idx_bet_match ON bets(match_id, status);

CREATE TABLE IF NOT EXISTS audit_log (
  id          TEXT PRIMARY KEY,
  user_id     TEXT,
  action      TEXT NOT NULL,
  detail      TEXT,            -- JSON
  ip          TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id, created_at);

CREATE TABLE IF NOT EXISTS fraud_flags (
  id          TEXT PRIMARY KEY,
  user_id     TEXT REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  severity    TEXT NOT NULL,   -- low | medium | high
  detail      TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fraud_user ON fraud_flags(user_id, created_at);
