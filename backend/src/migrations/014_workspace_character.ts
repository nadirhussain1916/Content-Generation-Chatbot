export async function migrateWorkspaceCharacter(db: D1Database): Promise<string[]> {
  const messages: string[] = [];
  const columns = [
    { name: 'character_name',          sql: 'TEXT' },
    { name: 'character_appearance',    sql: 'TEXT' },
    { name: 'character_reference_ids', sql: "TEXT NOT NULL DEFAULT '[]'" },
    { name: 'character_voice_id',      sql: 'TEXT' },
  ];

  for (const col of columns) {
    try {
      await db.prepare(`ALTER TABLE workspaces ADD COLUMN ${col.name} ${col.sql}`).run();
      messages.push(`[Migration] workspaces.${col.name} column added`);
    } catch {
      messages.push(`[Migration] workspaces.${col.name} already exists (skipped)`);
    }
  }

  return messages;
}
