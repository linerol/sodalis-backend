-- ============================================================
-- Sodalis Domus — Schéma initial
-- PostgreSQL 17+
-- ============================================================

BEGIN;

-- ── Types ────────────────────────────────────────────────────
CREATE TYPE user_role AS ENUM ('ADMIN', 'MEMBER');

-- ── Colocs ───────────────────────────────────────────────────
CREATE TABLE colocs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(100) NOT NULL CHECK (char_length(name) >= 1),
    invite_code VARCHAR(20)  NOT NULL UNIQUE CHECK (char_length(invite_code) >= 4),
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ── Users ────────────────────────────────────────────────────
CREATE TABLE users (
    id         UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
    name       VARCHAR(100) NOT NULL CHECK (char_length(name) >= 1),
    email      VARCHAR(255) NOT NULL UNIQUE CHECK (email ~* '^[^@]+@[^@]+\.[^@]+$'),
    password   VARCHAR(255),
    coloc_id   UUID         REFERENCES colocs(id) ON DELETE SET NULL,
    role       user_role    NOT NULL DEFAULT 'MEMBER',
    created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ── Index ────────────────────────────────────────────────────
CREATE INDEX idx_users_coloc_id    ON users (coloc_id);
CREATE INDEX idx_colocs_invite_code ON colocs (invite_code);

COMMIT;