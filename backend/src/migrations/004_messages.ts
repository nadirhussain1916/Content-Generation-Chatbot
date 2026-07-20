export async function migrateMessagesTable(db: D1Database): Promise<string[]> {
  const messages: string[] = [];
  try {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK(role IN ('user','assistant')),
        type TEXT NOT NULL DEFAULT 'chat'
          CHECK(type IN ('chat','draft','followup')),
        content TEXT NOT NULL,
        post_package TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      )
    `).run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id)`).run();
    messages.push('[Migration] messages table OK');
  } catch (error) {
    messages.push(`[Migration] messages table error: ${error}`);
  }
  return messages;
}
