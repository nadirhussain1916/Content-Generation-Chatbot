export async function migrateWorkspacePlatformSettings(db: D1Database): Promise<string[]> {
  const messages: string[] = [];
  try {
    await db.prepare(`ALTER TABLE workspaces ADD COLUMN platform_settings TEXT`).run();
    messages.push('[Migration] workspaces.platform_settings column added');
  } catch {
    messages.push('[Migration] workspaces.platform_settings already exists (skipped)');
  }
  return messages;
}
