export async function migrateUserName(db: D1Database): Promise<string[]> {
  const messages: string[] = [];
  try {
    await db.prepare(`ALTER TABLE users ADD COLUMN name TEXT`).run();
    messages.push('[Migration] users.name column added');
  } catch (error) {
    const msg = String(error);
    if (msg.includes('duplicate column name') || msg.includes('already exists')) {
      messages.push('[Migration] users.name column already exists — skipped');
    } else {
      messages.push(`[Migration] users.name error: ${error}`);
    }
  }
  return messages;
}
