export async function migrateAssetErrorColumn(db: D1Database): Promise<string[]> {
  const messages: string[] = [];
  try {
    await db.prepare('ALTER TABLE assets ADD COLUMN error_message TEXT').run();
    messages.push('[Migration] assets.error_message column added');
  } catch {
    messages.push('[Migration] assets.error_message already exists (skipped)');
  }
  return messages;
}
