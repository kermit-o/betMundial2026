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
  email_verified       INTEGER NOT NULL DEFAULT 0,
  mfa_enabled          INTEGER NOT NULL DEFAULT 0,
  mfa_secret           TEXT,
  self_excluded_until  TEXT,                       -- ISO datetime o NULL
  daily_deposit_limit  INTEGER NOT NULL,
  daily_loss_limit     INTEGER,
  -- Cambios de límite con enfriamiento (las subidas se aplican con retardo):
  pending_deposit_limit       INTEGER,
  pending_deposit_effective   TEXT,
  pending_loss_limit          INTEGER,
  pending_loss_effective      TEXT,
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
  type          TEXT NOT NULL,   -- deposit | withdrawal | bet_stake | bet_payout | refund | cashout
  amount        INTEGER NOT NULL,-- positivo abona, negativo carga
  balance_after INTEGER NOT NULL,
  ref_id        TEXT,            -- p.ej. bet id / payment intent id
  status        TEXT NOT NULL DEFAULT 'completed', -- completed | pending | flagged | rejected
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tx_user_time ON transactions(user_id, created_at);

-- Intentos de pago a través de un proveedor (depósitos y retiros). Idempotentes.
CREATE TABLE IF NOT EXISTS payment_intents (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider        TEXT NOT NULL,        -- sandbox | stripe | ...
  type            TEXT NOT NULL,        -- deposit | payout
  amount          INTEGER NOT NULL,
  currency        TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending', -- pending | completed | failed
  idempotency_key TEXT NOT NULL,
  provider_ref    TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_idem ON payment_intents(user_id, idempotency_key);

-- Casos KYC gestionados por un proveedor externo (sandbox por defecto).
CREATE TABLE IF NOT EXISTS kyc_cases (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider    TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending', -- pending | verified | rejected
  reference   TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Tokens de un solo uso: verificación de email y restablecimiento de contraseña.
CREATE TABLE IF NOT EXISTS auth_tokens (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,   -- email_verify | password_reset
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

-- Un "bet" representa un boleto: simple (1 selección) o combinada (N selecciones).
CREATE TABLE IF NOT EXISTS bets (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type              TEXT NOT NULL DEFAULT 'single', -- single | combo
  stake             INTEGER NOT NULL,
  total_odds        REAL NOT NULL,     -- cuota combinada bloqueada al apostar
  potential_payout  INTEGER NOT NULL,
  status            TEXT NOT NULL DEFAULT 'open', -- open | won | lost | void | cashed_out
  cash_out_value    INTEGER,           -- importe pagado si se cerró anticipadamente
  risk_score        INTEGER NOT NULL DEFAULT 0,
  placed_at         TEXT NOT NULL DEFAULT (datetime('now')),
  settled_at        TEXT
);
CREATE INDEX IF NOT EXISTS idx_bet_user ON bets(user_id, placed_at);

-- Cada selección dentro de un boleto (1 fila para simples, N para combinadas).
CREATE TABLE IF NOT EXISTS bet_legs (
  id            TEXT PRIMARY KEY,
  bet_id        TEXT NOT NULL REFERENCES bets(id) ON DELETE CASCADE,
  selection_id  TEXT NOT NULL REFERENCES selections(id),
  market_id     TEXT NOT NULL REFERENCES markets(id),
  match_id      TEXT NOT NULL REFERENCES matches(id),
  odds          REAL NOT NULL,    -- cuota bloqueada de esta selección
  result        TEXT NOT NULL DEFAULT 'pending' -- pending | won | lost | void
);
CREATE INDEX IF NOT EXISTS idx_leg_bet ON bet_legs(bet_id);
CREATE INDEX IF NOT EXISTS idx_leg_selection ON bet_legs(selection_id);
CREATE INDEX IF NOT EXISTS idx_leg_match ON bet_legs(match_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id          TEXT PRIMARY KEY,
  user_id     TEXT,
  action      TEXT NOT NULL,
  detail      TEXT,            -- JSON
  ip          TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log(created_at);

CREATE TABLE IF NOT EXISTS fraud_flags (
  id          TEXT PRIMARY KEY,
  user_id     TEXT REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  severity    TEXT NOT NULL,   -- low | medium | high
  detail      TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fraud_user ON fraud_flags(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_fraud_time ON fraud_flags(created_at);
