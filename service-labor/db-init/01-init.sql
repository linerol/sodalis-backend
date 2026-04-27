-- ============================================================
-- Sodalis Labor — Schéma initial
-- PostgreSQL 17+
-- ============================================================

BEGIN;

CREATE TYPE task_status AS ENUM ('TODO', 'IN_PROGRESS', 'DONE');

CREATE TABLE tasks (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title       VARCHAR(150) NOT NULL CHECK (char_length(title) >= 1),
    assignee_id UUID         NOT NULL,
    coloc_id    UUID         NOT NULL,
    status      task_status  NOT NULL DEFAULT 'TODO',
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_tasks_coloc_id    ON tasks (coloc_id);
CREATE INDEX idx_tasks_assignee_id ON tasks (assignee_id);

COMMIT;