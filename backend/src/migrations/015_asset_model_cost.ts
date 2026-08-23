export async function migrateAssetModelCost(db: D1Database): Promise<string[]> {
  const messages: string[] = [];
  const columns = [
    { name: 'model',    sql: 'TEXT' },
    { name: 'cost_usd', sql: 'REAL' },
  ];
  for (const col of columns) {
    try {
      await db.prepare(`ALTER TABLE assets ADD COLUMN ${col.name} ${col.sql}`).run();
      messages.push(`[Migration] assets.${col.name} column added`);
    } catch {
      messages.push(`[Migration] assets.${col.name} already exists (skipped)`);
    }
  }
  return messages;
}
