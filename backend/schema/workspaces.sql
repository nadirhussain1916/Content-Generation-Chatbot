-- ──────────────────────────────────────────────────
-- Table: workspaces
-- Exported: 2026-08-10 10:30:13 UTC
-- ──────────────────────────────────────────────────

CREATE TABLE workspaces (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        slug TEXT UNIQUE NOT NULL,
        avatar_url TEXT,
        ai_tone TEXT NOT NULL DEFAULT 'professional'
          CHECK(ai_tone IN ('professional','casual','witty','formal','inspirational')),
        default_caption_style TEXT NOT NULL DEFAULT 'short'
          CHECK(default_caption_style IN ('short','medium','long')),
        default_platforms TEXT NOT NULL DEFAULT '["instagram"]',
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      , brand_name TEXT, brand_description TEXT, brand_voice TEXT, target_audience TEXT, agent_instructions TEXT, default_image_size TEXT NOT NULL DEFAULT '1024x1024', default_video_duration INTEGER NOT NULL DEFAULT 5, default_video_dimensions TEXT NOT NULL DEFAULT '1280x720');

