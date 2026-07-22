export async function migrateWorkspaceMediaDefaults(db: D1Database): Promise<string[]> {
  const messages: string[] = [];
  const columns = [
    { name: 'default_image_size',       sql: "TEXT NOT NULL DEFAULT '1024x1024'" },
    { name: 'default_video_duration',   sql: 'INTEGER NOT NULL DEFAULT 5' },
    { name: 'default_video_dimensions', sql: "TEXT NOT NULL DEFAULT '1280x720'" },
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
