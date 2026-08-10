-- ──────────────────────────────────────────────────
-- Table: social_accounts
-- Exported: 2026-08-10 10:30:13 UTC
-- ──────────────────────────────────────────────────

CREATE TABLE social_accounts (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        platform TEXT NOT NULL CHECK(platform IN ('instagram','tiktok')),
        access_token TEXT NOT NULL,
        refresh_token TEXT,
        account_id TEXT NOT NULL,
        username TEXT,
        token_expires_at INTEGER,
        refresh_token_expires_at INTEGER,
        connected_at INTEGER NOT NULL DEFAULT (unixepoch()),
        UNIQUE(workspace_id, platform)
      );

