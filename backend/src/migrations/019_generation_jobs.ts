/**
 * generation_jobs — one row per sub-job of a multi-part video generation.
 *
 * A long video (Flow A generate-stitch, Flow B combine, Flow C continue) is a SINGLE
 * `assets` row, but under the hood it's assembled from several Replicate predictions
 * (each chunk), last-frame extractions, and one ffmpeg concat. Previously all of that
 * lived only in Cloudflare Workflow step state — invisible to the DB. This table makes
 * every sub-job a first-class, queryable record so we can bill actuals, show real
 * progress, list parts in the UI, and retry only the failed parts.
 *
 *   kind   — 'chunk' (a Replicate generation) | 'frame' (last-frame extraction) | 'concat'
 *   idx    — order within the asset (chunk index; frame i sits after chunk i)
 *   status — pending | running | succeeded | failed
 *   id     — deterministic (`${assetId}-${kind}-${idx}`) so Workflow replays upsert
 *            the same row instead of duplicating it.
 */
export async function migrateGenerationJobsTable(db: D1Database): Promise<string[]> {
  const messages: string[] = [];
  try {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS generation_jobs (
        id            TEXT    PRIMARY KEY,
        asset_id      TEXT    NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        workspace_id  TEXT    NOT NULL,
        kind          TEXT    NOT NULL CHECK(kind IN ('chunk','frame','concat')),
        idx           INTEGER NOT NULL,
        status        TEXT    NOT NULL DEFAULT 'pending'
                        CHECK(status IN ('pending','running','succeeded','failed')),
        prediction_id TEXT,
        model         TEXT,
        prompt        TEXT,
        duration_sec  REAL,
        seed_url      TEXT,
        output_url    TEXT,
        cost_usd      REAL,
        error_message TEXT,
        created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
      )
    `).run();
    await db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_generation_jobs_asset ON generation_jobs(asset_id)`
    ).run();
    messages.push('[Migration] generation_jobs table OK');
  } catch (error) {
    messages.push(`[Migration] generation_jobs table error: ${error}`);
  }
  return messages;
}
