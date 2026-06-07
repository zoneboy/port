-- Zilcycler Record Management System — schema v2
-- Run once against your Neon database:  psql "$DATABASE_URL" -f db/schema.sql

-- Roles for the two worker pipelines
DO $$ BEGIN
  CREATE TYPE worker_role AS ENUM ('Sorter', 'Baler');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE audit_action AS ENUM ('create', 'update', 'delete');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────────────────────
-- Settings: current global pricing. Exactly one row (id = 1).
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS settings (
  id                  integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  pet_price_per_kg    numeric(10,2) NOT NULL DEFAULT 0,
  cover_price_per_kg  numeric(10,2) NOT NULL DEFAULT 0,
  bale_price          numeric(10,2) NOT NULL DEFAULT 0,
  updated_at          timestamptz   NOT NULL DEFAULT now()
);

INSERT INTO settings (id, pet_price_per_kg, cover_price_per_kg, bale_price)
VALUES (1, 0, 0, 0)
ON CONFLICT (id) DO NOTHING;

-- Optional full history of pricing changes (kept for audit)
CREATE TABLE IF NOT EXISTS settings_history (
  id                  bigserial PRIMARY KEY,
  pet_price_per_kg    numeric(10,2) NOT NULL,
  cover_price_per_kg  numeric(10,2) NOT NULL,
  bale_price          numeric(10,2) NOT NULL,
  changed_at          timestamptz   NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────
-- Workers: directory of sorters and balers.
-- bank_name and account_number are stored ENCRYPTED (AES-256-GCM)
-- by the application layer, so they are plain text columns here.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name       text         NOT NULL,
  role            worker_role  NOT NULL,
  bank_name       text         NOT NULL,   -- ciphertext
  account_number  text         NOT NULL,   -- ciphertext
  is_active       boolean      NOT NULL DEFAULT true,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────
-- Daily records. Rates are snapshotted at insert; payout is a
-- generated column so it can never drift from the captured rate.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_records (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date            date         NOT NULL,            -- Africa/Lagos calendar date
  worker_id       uuid         NOT NULL REFERENCES workers(id),

  pet_kg          numeric(10,2),                    -- sorters only
  cover_kg        numeric(10,2),                    -- sorters only
  bales_produced  integer,                          -- balers only

  pet_rate        numeric(10,2),                    -- snapshot at insert
  cover_rate      numeric(10,2),                    -- snapshot at insert
  bale_rate       numeric(10,2),                    -- snapshot at insert

  payout numeric(12,2) GENERATED ALWAYS AS (
      COALESCE(pet_kg   * pet_rate,  0)
    + COALESCE(cover_kg * cover_rate, 0)
    + COALESCE(bales_produced * bale_rate, 0)
  ) STORED,

  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now(),
  deleted_at      timestamptz,                       -- soft delete

  -- A row is either a sorter row (kg fields) or a baler row (bales). Never both.
  CONSTRAINT sorter_xor_baler CHECK (
    (pet_kg IS NOT NULL OR cover_kg IS NOT NULL) <> (bales_produced IS NOT NULL)
  ),
  CONSTRAINT non_negative CHECK (
    COALESCE(pet_kg,0) >= 0 AND COALESCE(cover_kg,0) >= 0 AND COALESCE(bales_produced,0) >= 0
  )
);

-- One live record per worker per day (v2 default — see PRD §8.1).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_worker_day_live
  ON daily_records (worker_id, date)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_records_date
  ON daily_records (date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_records_worker_date
  ON daily_records (worker_id, date) WHERE deleted_at IS NULL;

-- ─────────────────────────────────────────────────────────────
-- Audit log for every create / update / delete of a wage record.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS record_audit (
  id          bigserial PRIMARY KEY,
  record_id   uuid          NOT NULL,
  action      audit_action  NOT NULL,
  changes     jsonb         NOT NULL DEFAULT '{}'::jsonb,
  changed_at  timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_record ON record_audit (record_id);
