export async function migrateThreadContinueFromAsset(db: D1Database): Promise<string[]> {
  const messages: string[] = [];
  try {
    await db.prepare(
      `ALTER TABLE threads ADD COLUMN continue_from_asset_id TEXT`
    ).run();
    messages.push('[Migration] threads.continue_from_asset_id column added');
  } catch {
    messages.push('[Migration] threads.continue_from_asset_id already exists (skipped)');
  }
  return messages;
}
