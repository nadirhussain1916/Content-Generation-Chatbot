import type { User, Workspace, Thread, Message, Asset, SocialAccount, PublishRecord } from '../types';

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

export async function updateWorkspace(db: D1Database, id: string, data: Partial<Pick<Workspace, 'name' | 'ai_tone' | 'default_caption_style' | 'default_platforms' | 'avatar_url' | 'brand_name' | 'brand_description' | 'brand_voice' | 'target_audience' | 'agent_instructions'>>) {
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
}) {
  return db.prepare(
    'INSERT INTO threads (id, workspace_id, created_by, title) VALUES (?, ?, ?, ?)'
  ).bind(data.id, data.workspace_id, data.created_by, data.title ?? null).run();
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
}) {
  return db.prepare(
    'INSERT INTO messages (id, thread_id, role, type, content, post_package) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(data.id, data.thread_id, data.role, data.type, data.content, data.post_package ?? null).run();
}

// ─── Assets ──────────────────────────────────────────────────────────────────

export async function getAsset(db: D1Database, id: string) {
  return db.prepare('SELECT * FROM assets WHERE id = ?').bind(id).first<Asset>();
}

export async function getAssetsByWorkspace(db: D1Database, workspaceId: string, limit = 50) {
  return db.prepare(
    'SELECT * FROM assets WHERE workspace_id = ? AND status = ? ORDER BY created_at DESC LIMIT ?'
  ).bind(workspaceId, 'ready', limit).all<Asset>();
}

export async function getAssetsByThread(db: D1Database, threadId: string) {
  return db.prepare(
    'SELECT * FROM assets WHERE thread_id = ? AND status = ? ORDER BY created_at DESC'
  ).bind(threadId, 'ready').all<Asset>();
}

export async function createAsset(db: D1Database, data: {
  id: string; thread_id: string; workspace_id: string; type: 'image' | 'video';
  message_id?: string; prompt?: string; prediction_id?: string;
}) {
  return db.prepare(
    'INSERT INTO assets (id, thread_id, workspace_id, message_id, type, status, prompt, prediction_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(data.id, data.thread_id, data.workspace_id, data.message_id ?? null, data.type, 'generating', data.prompt ?? null, data.prediction_id ?? null).run();
}

export async function updateAsset(db: D1Database, id: string, data: Partial<Pick<Asset, 'status' | 'r2_key' | 'public_url' | 'prediction_id'>>) {
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

// ─── Token refresh helpers (for cron) ────────────────────────────────────────

export async function getExpiringTokens(db: D1Database, thresholdSecs: number) {
  const now = Math.floor(Date.now() / 1000);
  return db.prepare(
    'SELECT * FROM social_accounts WHERE token_expires_at IS NOT NULL AND token_expires_at < ?'
  ).bind(now + thresholdSecs).all<SocialAccount>();
}
