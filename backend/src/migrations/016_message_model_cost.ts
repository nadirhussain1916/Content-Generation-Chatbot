export async function migrateMessageModelCost(db: D1Database): Promise<string[]> {
  const messages: string[] = [];
  const columns = [
    { name: 'model',          sql: 'TEXT' },
    { name: 'cost_usd',       sql: 'REAL' },
    { name: 'input_tokens',   sql: 'INTEGER' },
    { name: 'output_tokens',  sql: 'INTEGER' },
  ];
  for (const col of columns) {
    try {
      await db.prepare(`ALTER TABLE messages ADD COLUMN ${col.name} ${col.sql}`).run();
      messages.push(`[Migration] messages.${col.name} column added`);
    } catch {
      messages.push(`[Migration] messages.${col.name} already exists (skipped)`);
    }
  }
  return messages;
}
