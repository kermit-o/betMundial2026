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

-- ============================================================================
-- Multi-operador (SaaS). Registro de operadores (tenants) y aislamiento de datos
-- por operador mediante Row-Level Security. La columna operator_id se rellena
-- sola desde la variable de sesión app.operator_id (la fija la app por petición).
-- ============================================================================
CREATE TABLE IF NOT EXISTS operators (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  status      TEXT NOT NULL DEFAULT 'active',
  branding    TEXT,                 -- JSON con marca (nombre visible, logo, colores) — Fase 4
  created_at  TEXT NOT NULL
);

-- Operador por defecto: alberga los datos de una instalación de un solo operador
-- y los datos preexistentes al activar el multi-tenant.
INSERT INTO operators (id, name, slug, status, created_at)
VALUES ('op_default', 'Operador por defecto', 'default', 'active', '1970-01-01T00:00:00Z')
ON CONFLICT (id) DO NOTHING;

-- Añade operator_id + RLS a cada tabla con datos de cliente, de forma idempotente.
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'users','wallets','transactions','payment_intents','kyc_cases',
    'auth_tokens','bets','bet_legs','audit_log','fraud_flags'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS operator_id text', t);
    -- Backfill de filas preexistentes al operador por defecto.
    EXECUTE format('UPDATE %I SET operator_id = %L WHERE operator_id IS NULL', t, 'op_default');
    EXECUTE format($f$ALTER TABLE %I ALTER COLUMN operator_id SET DEFAULT current_setting('app.operator_id', true)$f$, t);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN operator_id SET NOT NULL', t);
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_' || t || '_operator') THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT fk_%s_operator FOREIGN KEY (operator_id) REFERENCES operators(id)', t, t);
    END IF;
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%s_operator ON %I(operator_id)', t, t);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON %I
      USING (current_setting('app.operator_id', true) = '__system__'
             OR operator_id = current_setting('app.operator_id', true))
      WITH CHECK (current_setting('app.operator_id', true) = '__system__'
             OR operator_id = current_setting('app.operator_id', true))
    $p$, t);
  END LOOP;
END $$;

-- El email es único POR operador (dos operadores pueden tener el mismo cliente).
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_operator_email ON users(operator_id, email);
