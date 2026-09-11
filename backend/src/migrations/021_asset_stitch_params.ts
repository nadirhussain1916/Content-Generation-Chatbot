/**
 * assets.stitch_params — the exact GenerationWorkflow `video_stitch` params a long
 * video was dispatched with (JSON). Persisted so a failed stitch can be RETRIED:
 * we re-dispatch the same params and the workflow reuses the parts whose
 * generation_jobs already succeeded, regenerating only the failed/missing ones.
 *
 * Null for ordinary single-clip generations (nothing to stitch/retry).
 */
export async function migrateAssetStitchParams(db: D1Database): Promise<string[]> {
  const messages: string[] = [];
  try {
    await db.prepare(`ALTER TABLE assets ADD COLUMN stitch_params TEXT`).run();
    messages.push('[Migration] assets.stitch_params column added');
  } catch {
    messages.push('[Migration] assets.stitch_params already exists (skipped)');
  }
  return messages;
}
