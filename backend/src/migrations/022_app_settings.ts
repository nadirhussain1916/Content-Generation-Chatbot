export async function migrateAppSettings(db: D1Database): Promise<string[]> {
  const messages: string[] = [];
  try {
    await db.prepare(`
      CREATE TABLE app_settings (
        key         TEXT    NOT NULL,
        workspace_id TEXT   NOT NULL,
        value       TEXT    NOT NULL,
        updated_at  INTEGER NOT NULL,
        PRIMARY KEY (key, workspace_id)
      )
    `).run();
    messages.push('[Migration] app_settings table created');
  } catch {
    messages.push('[Migration] app_settings table already exists (skipped)');
  }
  return messages;
}
