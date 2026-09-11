import type { User, Workspace, Thread, Message, Asset, SocialAccount, PublishRecord, WorkspaceUpload, GenerationJob } from '../types';

// ─── Users ────────────────────────────────────────────────────────────────────

export async function getUser(db: D1Database, id: string) {
  return db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<User>();
}

export async function upsertUser(db: D1Database, id: string) {
  return db.prepare(
    'INSERT OR IGNORE INTO users (id, onboarded) VALUES (?, 0)'
  ).bind(id).run();
}

export async function setUserOnboarded(db: D1Database, id: string) {
  return db.prepare(
    'UPDATE users SET onboarded = 1, updated_at = unixepoch() WHERE id = ?'
  ).bind(id).run();
}

export async function updateUserProfile(db: D1Database, id: string, profile: { email?: string; name?: string }) {
  const fields = Object.entries(profile).map(([k]) => `${k} = ?`).join(', ');
  const values = Object.values(profile);
  return db.prepare(
    `UPDATE users SET ${fields}, updated_at = unixepoch() WHERE id = ?`
  ).bind(...values, id).run();
}

// ─── Workspaces ──────────────────────────────────────────────────────────────

export async function getWorkspaceBySlug(db: D1Database, slug: string) {
  return db.prepare('SELECT * FROM workspaces WHERE slug = ?').bind(slug).first<Workspace>();
}

export async function getWorkspacesByOwner(db: D1Database, ownerId: string) {
  return db.prepare('SELECT * FROM workspaces WHERE owner_id = ? ORDER BY created_at ASC')
    .bind(ownerId).all<Workspace>();
}

export async function createWorkspace(db: D1Database, data: {
  id: string; owner_id: string; name: string; slug: string;
  ai_tone: string; default_caption_style: string; default_platforms: string;
}) {
  return db.prepare(
    `INSERT INTO workspaces (id, owner_id, name, slug, ai_tone, default_caption_style, default_platforms)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(data.id, data.owner_id, data.name, data.slug, data.ai_tone, data.default_caption_style, data.default_platforms).run();
}

export async function updateWorkspace(db: D1Database, id: string, data: Partial<Pick<Workspace, 'name' | 'ai_tone' | 'default_caption_style' | 'default_platforms' | 'avatar_url' | 'brand_name' | 'brand_description' | 'brand_voice' | 'target_audience' | 'agent_instructions' | 'default_image_size' | 'default_video_duration' | 'default_video_dimensions'>>) {
  const fields = Object.entries(data).map(([k]) => `${k} = ?`).join(', ');
  const values = Object.values(data);
  return db.prepare(`UPDATE workspaces SET ${fields}, updated_at = unixepoch() WHERE id = ?`)
    .bind(...values, id).run();
}

// ─── Threads ─────────────────────────────────────────────────────────────────

export async function getThreadsByWorkspace(db: D1Database, workspaceId: string) {
  return db.prepare('SELECT * FROM threads WHERE workspace_id = ? ORDER BY updated_at DESC')
    .bind(workspaceId).all<Thread>();
}

export async function getThread(db: D1Database, id: string) {
  return db.prepare('SELECT * FROM threads WHERE id = ?').bind(id).first<Thread>();
}

export async function createThread(db: D1Database, data: {
  id: string; workspace_id: string; created_by: string; title?: string;
  continue_from_asset_id?: string;
}) {
  return db.prepare(
    'INSERT INTO threads (id, workspace_id, created_by, title, continue_from_asset_id) VALUES (?, ?, ?, ?, ?)'
  ).bind(
    data.id, data.workspace_id, data.created_by, data.title ?? null,
    data.continue_from_asset_id ?? null,
  ).run();
}

export async function updateThread(db: D1Database, id: string, data: Partial<Pick<Thread, 'status' | 'media_type' | 'active_draft_id' | 'title'>>) {
  const fields = Object.entries(data).map(([k]) => `${k} = ?`).join(', ');
  const values = Object.values(data);
  return db.prepare(`UPDATE threads SET ${fields}, updated_at = unixepoch() WHERE id = ?`)
    .bind(...values, id).run();
}

export async function deleteThread(db: D1Database, id: string) {
  return db.prepare('DELETE FROM threads WHERE id = ?').bind(id).run();
}

// ─── Messages ────────────────────────────────────────────────────────────────

export async function getMessages(db: D1Database, threadId: string) {
  return db.prepare('SELECT * FROM messages WHERE thread_id = ? ORDER BY created_at ASC')
    .bind(threadId).all<Message>();
}

export async function createMessage(db: D1Database, data: {
  id: string; thread_id: string; role: 'user' | 'assistant';
  type: 'chat' | 'draft' | 'followup'; content: string; post_package?: string;
  image_references?: string; model?: string; cost_usd?: number;
  input_tokens?: number; output_tokens?: number;
}) {
  return db.prepare(
    `INSERT INTO messages
       (id, thread_id, role, type, content, post_package, image_references, model, cost_usd, input_tokens, output_tokens)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    data.id, data.thread_id, data.role, data.type, data.content,
    data.post_package ?? null, data.image_references ?? null,
    data.model ?? null, data.cost_usd ?? null,
    data.input_tokens ?? null, data.output_tokens ?? null,
  ).run();
}

// ─── Assets ──────────────────────────────────────────────────────────────────

export async function getAsset(db: D1Database, id: string) {
  return db.prepare('SELECT * FROM assets WHERE id = ?').bind(id).first<Asset>();
}

export async function getAssetsByWorkspace(db: D1Database, workspaceId: string, limit = 50) {
  // Returns ALL statuses — the UI decides how to render each state
  return db.prepare(
    'SELECT * FROM assets WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?'
  ).bind(workspaceId, limit).all<Asset>();
}

export async function getAssetsByThread(db: D1Database, threadId: string) {
  // Returns ALL statuses so in-progress and failed assets are visible to the UI
  return db.prepare(
    'SELECT * FROM assets WHERE thread_id = ? ORDER BY created_at DESC'
  ).bind(threadId).all<Asset>();
}

export async function createAsset(db: D1Database, data: {
  id: string; thread_id: string; workspace_id: string; type: 'image' | 'video';
  message_id?: string; prompt?: string; prediction_id?: string;
  model?: string; cost_usd?: number; generation_method?: string; stitch_params?: string;
}) {
  return db.prepare(
    'INSERT INTO assets (id, thread_id, workspace_id, message_id, type, status, prompt, prediction_id, model, cost_usd, generation_method, stitch_params) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    data.id, data.thread_id, data.workspace_id, data.message_id ?? null,
    data.type, 'generating', data.prompt ?? null, data.prediction_id ?? null,
    data.model ?? null, data.cost_usd ?? null, data.generation_method ?? 'single',
    data.stitch_params ?? null,
  ).run();
}

// ─── Generation jobs (parts of a multi-part video — see migration 019) ─────────

/**
 * Upsert a sub-job row. `id` is deterministic (`${assetId}-${kind}-${idx}`) so a
 * Workflow step re-running on replay updates the same row instead of duplicating.
 * Only the provided fields are written; omitted fields keep their prior value.
 */
export async function upsertGenerationJob(db: D1Database, data: {
  id: string; asset_id: string; workspace_id: string;
  kind: 'chunk' | 'frame' | 'concat'; idx: number;
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  prediction_id?: string | null; model?: string | null; prompt?: string | null;
  duration_sec?: number | null; seed_url?: string | null; output_url?: string | null;
  cost_usd?: number | null; error_message?: string | null;
}) {
  return db.prepare(`
    INSERT INTO generation_jobs
      (id, asset_id, workspace_id, kind, idx, status, prediction_id, model, prompt,
       duration_sec, seed_url, output_url, cost_usd, error_message, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())
    ON CONFLICT(id) DO UPDATE SET
      status        = excluded.status,
      prediction_id = COALESCE(excluded.prediction_id, generation_jobs.prediction_id),
      model         = COALESCE(excluded.model,         generation_jobs.model),
      prompt        = COALESCE(excluded.prompt,        generation_jobs.prompt),
      duration_sec  = COALESCE(excluded.duration_sec,  generation_jobs.duration_sec),
      seed_url      = COALESCE(excluded.seed_url,      generation_jobs.seed_url),
      output_url    = COALESCE(excluded.output_url,    generation_jobs.output_url),
      cost_usd      = COALESCE(excluded.cost_usd,      generation_jobs.cost_usd),
      error_message = excluded.error_message,
      updated_at    = unixepoch()
  `).bind(
    data.id, data.asset_id, data.workspace_id, data.kind, data.idx, data.status,
    data.prediction_id ?? null, data.model ?? null, data.prompt ?? null,
    data.duration_sec ?? null, data.seed_url ?? null, data.output_url ?? null,
    data.cost_usd ?? null, data.error_message ?? null,
  ).run();
}

export async function getGenerationJobsByAsset(db: D1Database, assetId: string) {
  return db.prepare(
    'SELECT * FROM generation_jobs WHERE asset_id = ? ORDER BY kind, idx'
  ).bind(assetId).all<GenerationJob>();
}

/** Sum of the actual cost of every SUCCEEDED job for an asset (billing reconciliation). */
export async function sumSucceededJobCost(db: D1Database, assetId: string): Promise<number> {
  const row = await db.prepare(
    "SELECT COALESCE(SUM(cost_usd), 0) AS total FROM generation_jobs WHERE asset_id = ? AND status = 'succeeded'"
  ).bind(assetId).first<{ total: number }>();
  return row?.total ?? 0;
}

export async function updateAsset(db: D1Database, id: string, data: Partial<Pick<Asset, 'status' | 'r2_key' | 'public_url' | 'prediction_id' | 'error_message' | 'cost_usd'>>) {
  const fields = Object.entries(data).map(([k]) => `${k} = ?`).join(', ');
  const values = Object.values(data);
  return db.prepare(`UPDATE assets SET ${fields} WHERE id = ?`).bind(...values, id).run();
}

// ─── Social Accounts ─────────────────────────────────────────────────────────

export async function getSocialAccounts(db: D1Database, workspaceId: string) {
  return db.prepare('SELECT * FROM social_accounts WHERE workspace_id = ?')
    .bind(workspaceId).all<SocialAccount>();
}

export async function getSocialAccount(db: D1Database, workspaceId: string, platform: string) {
  return db.prepare('SELECT * FROM social_accounts WHERE workspace_id = ? AND platform = ?')
    .bind(workspaceId, platform).first<SocialAccount>();
}

export async function upsertSocialAccount(db: D1Database, data: {
  id: string; workspace_id: string; platform: string; access_token: string;
  refresh_token?: string; account_id: string; username?: string;
  token_expires_at?: number; refresh_token_expires_at?: number;
}) {
  return db.prepare(
    `INSERT INTO social_accounts (id, workspace_id, platform, access_token, refresh_token, account_id, username, token_expires_at, refresh_token_expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(workspace_id, platform) DO UPDATE SET
       access_token = excluded.access_token,
       refresh_token = COALESCE(excluded.refresh_token, refresh_token),
       account_id = excluded.account_id,
       username = excluded.username,
       token_expires_at = excluded.token_expires_at,
       refresh_token_expires_at = excluded.refresh_token_expires_at,
       connected_at = unixepoch()`
  ).bind(
    data.id, data.workspace_id, data.platform, data.access_token,
    data.refresh_token ?? null, data.account_id, data.username ?? null,
    data.token_expires_at ?? null, data.refresh_token_expires_at ?? null
  ).run();
}

export async function deleteSocialAccount(db: D1Database, workspaceId: string, platform: string) {
  return db.prepare('DELETE FROM social_accounts WHERE workspace_id = ? AND platform = ?')
    .bind(workspaceId, platform).run();
}

// ─── Publish Records ─────────────────────────────────────────────────────────

export async function createPublishRecord(db: D1Database, data: {
  id: string; workspace_id: string; asset_id?: string; platform: string;
  caption?: string; hashtags?: string;
}) {
  return db.prepare(
    'INSERT INTO publish_records (id, workspace_id, asset_id, platform, caption, hashtags) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(data.id, data.workspace_id, data.asset_id ?? null, data.platform, data.caption ?? null, data.hashtags ?? null).run();
}

export async function updatePublishRecord(db: D1Database, id: string, data: Partial<Pick<PublishRecord, 'status' | 'platform_post_id' | 'container_id' | 'error_message'>>) {
  const fields = Object.entries(data).map(([k]) => `${k} = ?`).join(', ');
  const values = Object.values(data);
  return db.prepare(`UPDATE publish_records SET ${fields} WHERE id = ?`).bind(...values, id).run();
}

export async function getPublishRecord(db: D1Database, id: string) {
  return db.prepare('SELECT * FROM publish_records WHERE id = ?').bind(id).first<PublishRecord>();
}

export async function getPublishRecordsByWorkspace(db: D1Database, workspaceId: string) {
  return db.prepare('SELECT * FROM publish_records WHERE workspace_id = ? ORDER BY created_at DESC')
    .bind(workspaceId).all<PublishRecord>();
}

// ─── Cron helpers ─────────────────────────────────────────────────────────────

export async function getProcessingInstagramPublishes(db: D1Database) {
  return db.prepare(`
    SELECT pr.id as record_id, pr.container_id, pr.workspace_id,
           sa.access_token, sa.account_id as ig_user_id
    FROM publish_records pr
    JOIN social_accounts sa ON sa.workspace_id = pr.workspace_id AND sa.platform = 'instagram'
    WHERE pr.platform = 'instagram' AND pr.status = 'processing' AND pr.container_id IS NOT NULL
    ORDER BY pr.created_at ASC
  `).all<{ record_id: string; container_id: string; workspace_id: string; access_token: string; ig_user_id: string }>();
}

// ─── Token refresh helpers (for cron) ────────────────────────────────────────

export async function getExpiringTokens(db: D1Database, thresholdSecs: number) {
  const now = Math.floor(Date.now() / 1000);
  return db.prepare(
    'SELECT * FROM social_accounts WHERE token_expires_at IS NOT NULL AND token_expires_at < ?'
  ).bind(now + thresholdSecs).all<SocialAccount>();
}

// ─── Workspace Uploads ────────────────────────────────────────────────────────

export async function createWorkspaceUpload(db: D1Database, data: {
  id: string;
  workspace_id: string;
  thread_id?: string | null;
  uploaded_by: string;
  name: string;
  r2_key: string;
  public_url: string;
  mime_type?: string | null;
}) {
  return db.prepare(
    `INSERT INTO workspace_uploads (id, workspace_id, thread_id, uploaded_by, name, r2_key, public_url, mime_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    data.id, data.workspace_id, data.thread_id ?? null, data.uploaded_by,
    data.name, data.r2_key, data.public_url, data.mime_type ?? null
  ).run();
}

export async function getWorkspaceUploads(db: D1Database, workspaceId: string) {
  return db.prepare(
    'SELECT * FROM workspace_uploads WHERE workspace_id = ? ORDER BY created_at DESC'
  ).bind(workspaceId).all<WorkspaceUpload>();
}

export async function getWorkspaceUploadsByIds(db: D1Database, ids: string[], workspaceId: string) {
  if (ids.length === 0) return { results: [] as WorkspaceUpload[] };
  const placeholders = ids.map(() => '?').join(', ');
  return db.prepare(
    `SELECT * FROM workspace_uploads WHERE id IN (${placeholders}) AND workspace_id = ?`
  ).bind(...ids, workspaceId).all<WorkspaceUpload>();
}

export async function getWorkspaceUploadById(db: D1Database, id: string, workspaceId: string) {
  return db.prepare(
    'SELECT * FROM workspace_uploads WHERE id = ? AND workspace_id = ?'
  ).bind(id, workspaceId).first<WorkspaceUpload>();
}

export async function deleteWorkspaceUpload(db: D1Database, id: string, workspaceId: string) {
  return db.prepare(
    'DELETE FROM workspace_uploads WHERE id = ? AND workspace_id = ?'
  ).bind(id, workspaceId).run();
}

export async function updateWorkspaceUploadVisionDescription(db: D1Database, id: string, description: string) {
  return db.prepare(
    'UPDATE workspace_uploads SET vision_description = ? WHERE id = ?'
  ).bind(description, id).run();
}

// ─── Message update (for PATCH references) ───────────────────────────────────

export async function updateMessage(db: D1Database, id: string, data: { post_package: string }) {
  return db.prepare(
    'UPDATE messages SET post_package = ? WHERE id = ?'
  ).bind(data.post_package, id).run();
}

// ─── Usage / billing aggregation ──────────────────────────────────────────────

export interface DateRange {
  from?: number; // unix seconds, inclusive
  to?: number;   // unix seconds, exclusive
}

/** Builds an optional `AND col >= ? AND col < ?` clause + bind params. */
function dateClause(col: string, range?: DateRange): { sql: string; params: number[] } {
  const parts: string[] = [];
  const params: number[] = [];
  if (range?.from != null) { parts.push(`${col} >= ?`); params.push(range.from); }
  if (range?.to != null) { parts.push(`${col} < ?`); params.push(range.to); }
  return { sql: parts.length ? ` AND ${parts.join(' AND ')}` : '', params };
}

export interface ModelUsageRow {
  model: string | null;
  count: number;
  cost: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
}

export interface AssetUsageRow {
  type: 'image' | 'video';
  model: string | null;
  count: number;
  cost: number | null;
}

/** Per-model text (message) usage for one workspace. */
export async function getWorkspaceMessageUsage(db: D1Database, workspaceId: string, range?: DateRange) {
  const { sql, params } = dateClause('m.created_at', range);
  return db.prepare(
    `SELECT m.model as model,
            COUNT(*) as count,
            SUM(m.cost_usd) as cost,
            SUM(m.input_tokens) as input_tokens,
            SUM(m.output_tokens) as output_tokens
       FROM messages m
       JOIN threads t ON t.id = m.thread_id
      WHERE t.workspace_id = ? AND m.cost_usd IS NOT NULL${sql}
      GROUP BY m.model
      ORDER BY cost DESC`
  ).bind(workspaceId, ...params).all<ModelUsageRow>();
}

/** Per-type/model image+video (asset) usage for one workspace. */
export async function getWorkspaceAssetUsage(db: D1Database, workspaceId: string, range?: DateRange) {
  const { sql, params } = dateClause('created_at', range);
  return db.prepare(
    `SELECT type, model, COUNT(*) as count, SUM(cost_usd) as cost
       FROM assets
      WHERE workspace_id = ? AND cost_usd IS NOT NULL${sql}
      GROUP BY type, model
      ORDER BY cost DESC`
  ).bind(workspaceId, ...params).all<AssetUsageRow>();
}

export interface WorkspaceAssetUsageRow {
  userId: string;
  workspaceId: string;
  name: string;
  slug: string;
  type: 'image' | 'video';
  count: number;
  cost: number | null;
}

export interface WorkspaceMessageUsageRow {
  userId: string;
  workspaceId: string;
  name: string;
  slug: string;
  count: number;
  cost: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
}

/** Image+video asset usage grouped by workspace (with owner), across all users. */
export async function getAllWorkspacesAssetUsage(db: D1Database, range?: DateRange) {
  const { sql, params } = dateClause('a.created_at', range);
  return db.prepare(
    `SELECT w.owner_id as userId, w.id as workspaceId, w.name as name, w.slug as slug,
            a.type as type, COUNT(*) as count, SUM(a.cost_usd) as cost
       FROM assets a
       JOIN workspaces w ON w.id = a.workspace_id
      WHERE a.cost_usd IS NOT NULL${sql}
      GROUP BY w.id, a.type`
  ).bind(...params).all<WorkspaceAssetUsageRow>();
}

/** Text message usage grouped by workspace (with owner), across all users. */
export async function getAllWorkspacesMessageUsage(db: D1Database, range?: DateRange) {
  const { sql, params } = dateClause('m.created_at', range);
  return db.prepare(
    `SELECT w.owner_id as userId, w.id as workspaceId, w.name as name, w.slug as slug,
            COUNT(*) as count,
            SUM(m.cost_usd) as cost,
            SUM(m.input_tokens) as input_tokens,
            SUM(m.output_tokens) as output_tokens
       FROM messages m
       JOIN threads t ON t.id = m.thread_id
       JOIN workspaces w ON w.id = t.workspace_id
      WHERE m.cost_usd IS NOT NULL${sql}
      GROUP BY w.id`
  ).bind(...params).all<WorkspaceMessageUsageRow>();
}
