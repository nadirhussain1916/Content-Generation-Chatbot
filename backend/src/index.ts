import { Hono } from 'hono';
import type { CloudflareBindings } from './env';
import type { ContextVariables } from './types';
export { GenerationWorkflow } from './workflows/generation';
import { runAllMigrations } from './migrations';
import { Logger } from './utils/Logger';

import onboardingRouter from './routes/onboarding';
import workspacesRouter from './routes/workspaces';
import threadsRouter from './routes/threads';
import messagesRouter from './routes/messages';
import generateRouter from './routes/generate';
import socialRouter from './routes/social';
import publishRouter from './routes/publish';
import adminRouter from './routes/admin/index';
import { getExpiringTokens, getSocialAccount, upsertSocialAccount } from './db/queries';
import { refreshLongLivedToken } from './services/instagram';
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
  c.json({ success: true, message: 'ThreadForge API', version: '1.0.0' })
);

// ─── Routes ───────────────────────────────────────────────────────────────────

app.route('/api/onboarding', onboardingRouter);
app.route('/api/workspaces', workspacesRouter);
app.route('/api/workspaces/:slug/threads', threadsRouter);
app.route('/api/workspaces/:slug/threads', messagesRouter);
app.route('/api/workspaces/:slug/generate', generateRouter);
app.route('/api/workspaces/:slug/social', socialRouter);
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

// ─── Worker export ────────────────────────────────────────────────────────────

export default {
  fetch: app.fetch,

  async scheduled(_event: ScheduledEvent, env: CloudflareBindings, ctx: ExecutionContext) {
    ctx.waitUntil(refreshTokens(env));
  },
};
