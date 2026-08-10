-- ──────────────────────────────────────────────────
-- Table: users
-- Exported: 2026-08-10 10:30:13 UTC
-- ──────────────────────────────────────────────────

CREATE TABLE users (
        id TEXT PRIMARY KEY,
        onboarded INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );

