export async function migrateMessageImageReferences(db: D1Database): Promise<string[]> {
  const messages: string[] = [];
  try {
    await db.prepare(
      `ALTER TABLE messages ADD COLUMN image_references TEXT`
    ).run();
    messages.push('[Migration] messages.image_references column added');
  } catch (error) {
    // Column already exists — safe to ignore
    const msg = String(error);
    if (msg.includes('duplicate column name') || msg.includes('already exists')) {
      messages.push('[Migration] messages.image_references column already exists — skipped');
    } else {
      messages.push(`[Migration] messages.image_references error: ${error}`);
    }
  }
  return messages;
}
