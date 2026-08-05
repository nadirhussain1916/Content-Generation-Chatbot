export async function migrateWorkspaceUploadsTable(db: D1Database): Promise<string[]> {
  const messages: string[] = [];
  try {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS workspace_uploads (
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
      )
    `).run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_workspace_uploads_workspace ON workspace_uploads(workspace_id)`).run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_workspace_uploads_thread ON workspace_uploads(thread_id)`).run();
    messages.push('[Migration] workspace_uploads table OK');
  } catch (error) {
    messages.push(`[Migration] workspace_uploads table error: ${error}`);
  }
  return messages;
}
