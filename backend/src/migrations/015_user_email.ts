export async function migrateUserEmail(db: D1Database): Promise<string[]> {
  const messages: string[] = [];
  try {
    await db.prepare(`ALTER TABLE users ADD COLUMN email TEXT`).run();
    messages.push('[Migration] users.email column added');
  } catch (error) {
    const msg = String(error);
    if (msg.includes('duplicate column name') || msg.includes('already exists')) {
      messages.push('[Migration] users.email column already exists — skipped');
    } else {
      messages.push(`[Migration] users.email error: ${error}`);
    }
  }
  return messages;
}
