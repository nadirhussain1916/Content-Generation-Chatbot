export async function migrateThreadsTable(db: D1Database): Promise<string[]> {
  const messages: string[] = [];
  try {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS threads (
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
      )
    `).run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_threads_workspace ON threads(workspace_id)`).run();
    messages.push('[Migration] threads table OK');
  } catch (error) {
    messages.push(`[Migration] threads table error: ${error}`);
  }
  return messages;
}
