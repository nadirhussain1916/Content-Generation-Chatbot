-- ──────────────────────────────────────────────────
-- Table: assets
-- Exported: 2026-08-10 10:30:13 UTC
-- ──────────────────────────────────────────────────

CREATE TABLE assets (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        message_id TEXT REFERENCES messages(id),
        type TEXT NOT NULL CHECK(type IN ('image','video')),
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK(status IN ('pending','generating','ready','failed')),
        r2_key TEXT,
        public_url TEXT,
        prompt TEXT,
        prediction_id TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      , error_message TEXT);

-- Index: idx_assets_thread
CREATE INDEX idx_assets_thread ON assets(thread_id);

