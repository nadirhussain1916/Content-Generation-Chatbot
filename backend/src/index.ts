import { Hono } from 'hono';
import type { CloudflareBindings } from './env';
import type { ContextVariables } from './types';
export { GenerationWorkflow } from './workflows/generation';
export { PublishWorkflow } from './workflows/publish';
import { runAllMigrations } from './migrations';
import { Logger } from './utils/Logger';

import onboardingRouter from './routes/onboarding';
import workspacesRouter from './routes/workspaces';
import threadsRouter from './routes/threads';
import messagesRouter from './routes/messages';
import generateRouter from './routes/generate';
import socialRouter, { socialCallbackRouter } from './routes/social';
import publishRouter from './routes/publish';
import adminRouter from './routes/admin/index';
import { getExpiringTokens, getProcessingInstagramPublishes, getSocialAccount, upsertSocialAccount, updatePublishRecord } from './db/queries';
import { refreshLongLivedToken, checkContainerStatus, publishContainer } from './services/instagram';
import { refreshTikTokToken } from './services/tiktok';

const app = new Hono<{ Bindings: CloudflareBindings; Variables: ContextVariables }>();

// ─── CORS ─────────────────────────────────────────────────────────────────────

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

app.use('*', async (c, next) => {
  if (c.req.method === 'OPTIONS') {
    return c.newResponse(null, 204, corsHeaders);
  }
  await next();
  Object.entries(corsHeaders).forEach(([k, v]) => c.header(k, v));
});

// ─── Health ───────────────────────────────────────────────────────────────────

app.get('/', (c) => c.redirect(c.env.FRONTEND_URL, 302));
app.get('/api', (c) =>
  c.json({ success: true, message: 'CreatorOS API', version: '1.0.0' })
);

// ─── Routes ───────────────────────────────────────────────────────────────────

app.route('/api/onboarding', onboardingRouter);
app.route('/api/workspaces', workspacesRouter);
app.route('/api/workspaces/:slug/threads', threadsRouter);
app.route('/api/workspaces/:slug/threads', messagesRouter);
app.route('/api/workspaces/:slug/generate', generateRouter);
app.route('/api/workspaces/:slug/social', socialRouter);
app.route('/api/social', socialCallbackRouter);
app.route('/api/workspaces/:slug/publish', publishRouter);
app.route('/api/admin', adminRouter);

// Run migrations — protected by MIGRATE_SECRET header
app.get('/api/migrate', async (c) => {
  const secret = c.req.header('X-Migrate-Secret');
  if (!secret || secret !== c.env.MIGRATE_SECRET) {
    return c.json({ success: false, message: 'Unauthorized' }, 401);
  }
  const messages = await runAllMigrations(c.env.DB);
  return c.json({ success: true, data: { messages } });
});

// ─── Cron: Refresh expiring social tokens every 6 hours ─────────────────────

async function refreshTokens(env: CloudflareBindings) {
  // Refresh tokens expiring within 8 hours (28800 seconds)
  const THRESHOLD = 28800;
  const expiring = await getExpiringTokens(env.DB, THRESHOLD);

  for (const account of expiring.results) {
    try {
      if (account.platform === 'instagram') {
        const { access_token, expires_in } = await refreshLongLivedToken({
          accessToken: account.access_token,
        });
        await upsertSocialAccount(env.DB, {
          id: account.id,
          workspace_id: account.workspace_id,
          platform: account.platform,
          access_token,
          account_id: account.account_id,
          username: account.username ?? undefined,
          token_expires_at: Math.floor(Date.now() / 1000) + expires_in,
        });
        Logger.log('InstagramTokenRefreshed', { accountId: account.account_id });
      } else if (account.platform === 'tiktok' && account.refresh_token) {
        const tokens = await refreshTikTokToken({
          refreshToken: account.refresh_token,
          clientKey: env.TIKTOK_APP_ID,
          clientSecret: env.TIKTOK_APP_SECRET,
        });
        const now = Math.floor(Date.now() / 1000);
        await upsertSocialAccount(env.DB, {
          id: account.id,
          workspace_id: account.workspace_id,
          platform: account.platform,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          account_id: account.account_id,
          username: account.username ?? undefined,
          token_expires_at: now + tokens.expires_in,
          refresh_token_expires_at: now + tokens.refresh_expires_in,
        });
        Logger.log('TikTokTokenRefreshed', { accountId: account.account_id });
      }
    } catch (error) {
      Logger.log('TokenRefreshFailed', { accountId: account.account_id, platform: account.platform }, error);
    }
  }
}

// ─── Cron: Check pending Instagram Reels containers every 5 minutes ──────────

async function checkInstagramReels(env: CloudflareBindings) {
  const { results } = await getProcessingInstagramPublishes(env.DB);
  if (results.length === 0) return;

  Logger.log('InstagramReelsCronStart', { count: results.length });

  for (const row of results) {
    try {
      const { status_code } = await checkContainerStatus({
        containerId: row.container_id,
        accessToken: row.access_token,
      });
      Logger.log('InstagramReelsCronPoll', { recordId: row.record_id, containerId: row.container_id, status_code });

      if (status_code === 'FINISHED') {
        const postId = await publishContainer({
          igUserId: row.ig_user_id,
          containerId: row.container_id,
          accessToken: row.access_token,
        });
        await updatePublishRecord(env.DB, row.record_id, { status: 'published', platform_post_id: postId });
        Logger.log('InstagramReelsPublishedViaCron', { recordId: row.record_id, postId });
      } else if (status_code === 'ERROR' || status_code === 'EXPIRED') {
        await updatePublishRecord(env.DB, row.record_id, { status: 'failed', error_message: `Container ${status_code.toLowerCase()}` });
        Logger.log('InstagramReelsFailedViaCron', { recordId: row.record_id, status_code });
      }
      // IN_PROGRESS → do nothing, next cron tick will check again
    } catch (err) {
      Logger.log('InstagramReelsCronError', { recordId: row.record_id }, err);
    }
  }
}

// ─── Worker export ────────────────────────────────────────────────────────────

export default {
  fetch: app.fetch,

  async scheduled(event: ScheduledEvent, env: CloudflareBindings, ctx: ExecutionContext) {
    if (event.cron === '*/5 * * * *') {
      ctx.waitUntil(checkInstagramReels(env));
    } else {
      // Every 6 hours: refresh expiring social tokens
      ctx.waitUntil(refreshTokens(env));
    }
  },
};
