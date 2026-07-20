export async function migrateWorkspacesTable(db: D1Database): Promise<string[]> {
  const messages: string[] = [];
  try {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS workspaces (
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
      )
    `).run();
    messages.push('[Migration] workspaces table OK');
  } catch (error) {
    messages.push(`[Migration] workspaces table error: ${error}`);
  }
  return messages;
}
