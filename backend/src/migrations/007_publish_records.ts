export async function migratePublishRecordsTable(db: D1Database): Promise<string[]> {
  const messages: string[] = [];
  try {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS publish_records (
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
      )
    `).run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_publish_workspace ON publish_records(workspace_id)`).run();
    messages.push('[Migration] publish_records table OK');
  } catch (error) {
    messages.push(`[Migration] publish_records table error: ${error}`);
  }
  return messages;
}
