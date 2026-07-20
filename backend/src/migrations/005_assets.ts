export async function migrateAssetsTable(db: D1Database): Promise<string[]> {
  const messages: string[] = [];
  try {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS assets (
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
      )
    `).run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_assets_thread ON assets(thread_id)`).run();
    messages.push('[Migration] assets table OK');
  } catch (error) {
    messages.push(`[Migration] assets table error: ${error}`);
  }
  return messages;
}
