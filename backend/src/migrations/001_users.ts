export async function migrateUsersTable(db: D1Database): Promise<string[]> {
  const messages: string[] = [];
  try {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        onboarded INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      )
    `).run();
    messages.push('[Migration] users table OK');
  } catch (error) {
    messages.push(`[Migration] users table error: ${error}`);
  }
  return messages;
}
