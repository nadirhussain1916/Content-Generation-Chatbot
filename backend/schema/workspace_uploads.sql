-- ──────────────────────────────────────────────────
-- Table: workspace_uploads
-- Exported: 2026-08-10 10:30:13 UTC
-- ──────────────────────────────────────────────────

CREATE TABLE workspace_uploads (
        id                  TEXT    PRIMARY KEY,
        workspace_id        TEXT    NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        thread_id           TEXT    REFERENCES threads(id) ON DELETE SET NULL,
        uploaded_by         TEXT    NOT NULL,
        name                TEXT    NOT NULL,
        r2_key              TEXT    NOT NULL,
        public_url          TEXT,
        mime_type           TEXT,
        vision_description  TEXT,
        created_at          INTEGER NOT NULL DEFAULT (unixepoch())
      );

-- Index: idx_workspace_uploads_thread
CREATE INDEX idx_workspace_uploads_thread ON workspace_uploads(thread_id);

-- Index: idx_workspace_uploads_workspace
CREATE INDEX idx_workspace_uploads_workspace ON workspace_uploads(workspace_id);

