/**
 * assets.generation_method — how a video/image asset was produced.
 *
 *   'single'          — one Replicate prediction (default; ordinary image/video)
 *   'generate_stitch' — Flow A: N generated chunks stitched together
 *   'combine'         — Flow B: existing clips concatenated (ffmpeg only)
 *   'continue'        — Flow C: an existing clip extended with new i2v parts
 *
 * This replaces the previous, fuzzy "infer the method from prediction_id being null"
 * heuristic in the UI with an explicit, authoritative field. Existing rows are
 * backfilled: ffmpeg-concat assets → 'combine', everything else → 'single'.
 */
export async function migrateAssetGenerationMethod(db: D1Database): Promise<string[]> {
  const messages: string[] = [];
  try {
    await db.prepare(`ALTER TABLE assets ADD COLUMN generation_method TEXT`).run();
    messages.push('[Migration] assets.generation_method column added');
  } catch {
    messages.push('[Migration] assets.generation_method already exists (skipped)');
  }
  // Backfill legacy rows so old assets render with a correct badge. Safe to re-run.
  try {
    await db.prepare(
      `UPDATE assets SET generation_method = 'combine'
         WHERE generation_method IS NULL AND model = 'ffmpeg-concat'`
    ).run();
    await db.prepare(
      `UPDATE assets SET generation_method = 'single'
         WHERE generation_method IS NULL`
    ).run();
    messages.push('[Migration] assets.generation_method backfilled');
  } catch (error) {
    messages.push(`[Migration] assets.generation_method backfill error: ${error}`);
  }
  return messages;
}
