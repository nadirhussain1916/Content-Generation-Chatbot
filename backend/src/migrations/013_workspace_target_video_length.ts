export async function migrateWorkspaceTargetVideoLength(db: D1Database): Promise<string[]> {
  const messages: string[] = [];
  try {
    await db.prepare(
      `ALTER TABLE workspaces ADD COLUMN target_video_length INTEGER NOT NULL DEFAULT 45`
    ).run();
    messages.push('[Migration] workspaces.target_video_length column added');
  } catch {
    messages.push('[Migration] workspaces.target_video_length already exists (skipped)');
  }
  return messages;
}
