export async function migrateWorkspaceBrandFields(db: D1Database): Promise<string[]> {
  const messages: string[] = [];
  const columns = [
    { name: 'brand_name',         sql: 'TEXT' },
    { name: 'brand_description',  sql: 'TEXT' },
    { name: 'brand_voice',        sql: 'TEXT' },
    { name: 'target_audience',    sql: 'TEXT' },
    { name: 'agent_instructions', sql: 'TEXT' },
  ];

  for (const col of columns) {
    try {
      await db.prepare(`ALTER TABLE workspaces ADD COLUMN ${col.name} ${col.sql}`).run();
      messages.push(`[Migration] workspaces.${col.name} column added`);
    } catch {
      // Column already exists — safe to ignore
      messages.push(`[Migration] workspaces.${col.name} already exists (skipped)`);
    }
  }

  return messages;
}
