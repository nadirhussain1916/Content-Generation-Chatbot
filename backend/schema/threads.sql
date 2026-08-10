-- ──────────────────────────────────────────────────
-- Table: threads
-- Exported: 2026-08-10 10:30:13 UTC
-- ──────────────────────────────────────────────────

CREATE TABLE threads (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        created_by TEXT NOT NULL REFERENCES users(id),
        title TEXT,
        media_type TEXT NOT NULL DEFAULT 'undecided'
          CHECK(media_type IN ('undecided','image','video')),
        status TEXT NOT NULL DEFAULT 'planning'
          CHECK(status IN ('planning','draft','script_ready','media_pending','ready','published')),
        active_draft_id TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );

-- Index: idx_threads_workspace
CREATE INDEX idx_threads_workspace ON threads(workspace_id);

