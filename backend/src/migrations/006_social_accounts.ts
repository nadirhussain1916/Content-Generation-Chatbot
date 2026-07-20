export async function migrateSocialAccountsTable(db: D1Database): Promise<string[]> {
  const messages: string[] = [];
  try {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS social_accounts (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        platform TEXT NOT NULL CHECK(platform IN ('instagram','tiktok')),
        access_token TEXT NOT NULL,
        refresh_token TEXT,
        account_id TEXT NOT NULL,
        username TEXT,
        token_expires_at INTEGER,
        refresh_token_expires_at INTEGER,
        connected_at INTEGER NOT NULL DEFAULT (unixepoch()),
        UNIQUE(workspace_id, platform)
      )
    `).run();
    messages.push('[Migration] social_accounts table OK');
  } catch (error) {
    messages.push(`[Migration] social_accounts table error: ${error}`);
  }
  return messages;
}
