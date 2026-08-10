-- ──────────────────────────────────────────────────
-- Table: messages
-- Exported: 2026-08-10 10:30:13 UTC
-- ──────────────────────────────────────────────────

CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK(role IN ('user','assistant')),
        type TEXT NOT NULL DEFAULT 'chat'
          CHECK(type IN ('chat','draft','followup')),
        content TEXT NOT NULL,
        post_package TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      , image_references TEXT);

-- Index: idx_messages_thread
CREATE INDEX idx_messages_thread ON messages(thread_id);

