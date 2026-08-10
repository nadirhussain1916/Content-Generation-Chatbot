-- ──────────────────────────────────────────────────
-- Table: publish_records
-- Exported: 2026-08-10 10:30:13 UTC
-- ──────────────────────────────────────────────────

CREATE TABLE publish_records (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        asset_id TEXT REFERENCES assets(id),
        platform TEXT NOT NULL CHECK(platform IN ('instagram','tiktok')),
        platform_post_id TEXT,
        container_id TEXT,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK(status IN ('pending','processing','published','failed')),
        caption TEXT,
        hashtags TEXT,
        error_message TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );

-- Index: idx_publish_workspace
CREATE INDEX idx_publish_workspace ON publish_records(workspace_id);

