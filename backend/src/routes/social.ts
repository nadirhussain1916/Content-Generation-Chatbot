import { Hono } from 'hono';
import { authMiddleware, workspaceMiddleware } from '../middleware/auth';
import { getSocialAccounts, upsertSocialAccount, deleteSocialAccount } from '../db/queries';
import {
  getOAuthUrl, exchangeCodeForToken, getLongLivedToken, getInstagramAccountId,
} from '../services/instagram';
import { getTikTokOAuthUrl, exchangeTikTokCode, getTikTokUserInfo } from '../services/tiktok';
import type { CloudflareBindings } from '../env';
import type { ContextVariables, TfResponse, SocialAccount } from '../types';
import { Logger } from '../utils/Logger';

type Env = { Bindings: CloudflareBindings; Variables: ContextVariables };

const socialRouter = new Hono<Env>();

socialRouter.use('*', authMiddleware);
socialRouter.use('*', workspaceMiddleware);

// GET /api/workspaces/:slug/social/accounts
socialRouter.get('/accounts', async (c) => {
  const workspace = c.get('workspace');
  try {
    const result = await getSocialAccounts(c.env.DB, workspace.id);
    // Strip tokens before returning
    const safe = result.results.map(({ access_token: _, refresh_token: __, ...rest }) => rest);
    return c.json<TfResponse<typeof safe>>({ success: true, data: safe });
  } catch (error) {
    Logger.log('GetSocialAccountsError', { workspaceId: workspace.id }, error);
    return c.json<TfResponse<null>>({ success: false, message: 'Internal server error' }, 500);
  }
});

// ─── Instagram OAuth ──────────────────────────────────────────────────────────

// GET /api/workspaces/:slug/social/connect/instagram
socialRouter.get('/connect/instagram', async (c) => {
  const workspace = c.get('workspace');
  if (!c.env.META_APP_ID) {
    return c.json<TfResponse<null>>({ success: false, message: 'Instagram integration not configured' }, 501);
  }
  const state = `ig:${workspace.id}:${crypto.randomUUID()}`;
  await c.env.KV.put(`oauth-state:${state}`, workspace.id, { expirationTtl: 600 });

  const redirectUri = `${c.env.BACKEND_URL}/api/workspaces/${workspace.slug}/social/callback/instagram`;
  const url = getOAuthUrl({ appId: c.env.META_APP_ID, redirectUri, state });
  return c.redirect(url, 302);
});

// GET /api/workspaces/:slug/social/callback/instagram
socialRouter.get('/callback/instagram', async (c) => {
  const workspace = c.get('workspace');
  const { code, state, error } = c.req.query() as { code?: string; state?: string; error?: string };

  if (error || !code || !state) {
    return c.redirect(`${c.env.FRONTEND_URL}/workspaces/${workspace.slug}/settings?error=instagram_denied`);
  }

  try {
    const savedWorkspaceId = await c.env.KV.get(`oauth-state:${state}`);
    if (savedWorkspaceId !== workspace.id) {
      return c.redirect(`${c.env.FRONTEND_URL}/workspaces/${workspace.slug}/settings?error=invalid_state`);
    }
    await c.env.KV.delete(`oauth-state:${state}`);

    const redirectUri = `${c.env.BACKEND_URL}/api/workspaces/${workspace.slug}/social/callback/instagram`;
    const { access_token: shortToken } = await exchangeCodeForToken({
      code,
      appId: c.env.META_APP_ID,
      appSecret: c.env.META_APP_SECRET,
      redirectUri,
    });

    const { access_token: longToken, expires_in } = await getLongLivedToken({
      shortLivedToken: shortToken,
      appSecret: c.env.META_APP_SECRET,
    });

    const { id: accountId, username } = await getInstagramAccountId(longToken);
    const tokenExpiresAt = Math.floor(Date.now() / 1000) + expires_in;

    await upsertSocialAccount(c.env.DB, {
      id: crypto.randomUUID(),
      workspace_id: workspace.id,
      platform: 'instagram',
      access_token: longToken,
      account_id: accountId,
      username,
      token_expires_at: tokenExpiresAt,
    });

    return c.redirect(`${c.env.FRONTEND_URL}/workspaces/${workspace.slug}/settings?connected=instagram`);
  } catch (err) {
    Logger.log('InstagramCallbackError', { workspaceId: workspace.id }, err);
    return c.redirect(`${c.env.FRONTEND_URL}/workspaces/${workspace.slug}/settings?error=instagram_failed`);
  }
});

// ─── TikTok OAuth ─────────────────────────────────────────────────────────────

// GET /api/workspaces/:slug/social/connect/tiktok
socialRouter.get('/connect/tiktok', async (c) => {
  const workspace = c.get('workspace');
  if (!c.env.TIKTOK_APP_ID) {
    return c.json<TfResponse<null>>({ success: false, message: 'TikTok integration not configured' }, 501);
  }
  const state = `tt:${workspace.id}:${crypto.randomUUID()}`;
  await c.env.KV.put(`oauth-state:${state}`, workspace.id, { expirationTtl: 600 });

  const redirectUri = `${c.env.BACKEND_URL}/api/workspaces/${workspace.slug}/social/callback/tiktok`;
  const url = getTikTokOAuthUrl({ clientKey: c.env.TIKTOK_APP_ID, redirectUri, state });
  return c.redirect(url, 302);
});

// GET /api/workspaces/:slug/social/callback/tiktok
socialRouter.get('/callback/tiktok', async (c) => {
  const workspace = c.get('workspace');
  const { code, state, error } = c.req.query() as { code?: string; state?: string; error?: string };

  if (error || !code || !state) {
    return c.redirect(`${c.env.FRONTEND_URL}/workspaces/${workspace.slug}/settings?error=tiktok_denied`);
  }

  try {
    const savedWorkspaceId = await c.env.KV.get(`oauth-state:${state}`);
    if (savedWorkspaceId !== workspace.id) {
      return c.redirect(`${c.env.FRONTEND_URL}/workspaces/${workspace.slug}/settings?error=invalid_state`);
    }
    await c.env.KV.delete(`oauth-state:${state}`);

    const redirectUri = `${c.env.BACKEND_URL}/api/workspaces/${workspace.slug}/social/callback/tiktok`;
    const tokens = await exchangeTikTokCode({
      code,
      clientKey: c.env.TIKTOK_APP_ID,
      clientSecret: c.env.TIKTOK_APP_SECRET,
      redirectUri,
    });

    const userInfo = await getTikTokUserInfo(tokens.access_token);
    const now = Math.floor(Date.now() / 1000);

    await upsertSocialAccount(c.env.DB, {
      id: crypto.randomUUID(),
      workspace_id: workspace.id,
      platform: 'tiktok',
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      account_id: tokens.open_id,
      username: userInfo.display_name,
      token_expires_at: now + tokens.expires_in,
      refresh_token_expires_at: now + tokens.refresh_expires_in,
    });

    return c.redirect(`${c.env.FRONTEND_URL}/workspaces/${workspace.slug}/settings?connected=tiktok`);
  } catch (err) {
    Logger.log('TikTokCallbackError', { workspaceId: workspace.id }, err);
    return c.redirect(`${c.env.FRONTEND_URL}/workspaces/${workspace.slug}/settings?error=tiktok_failed`);
  }
});

// DELETE /api/workspaces/:slug/social/disconnect/:platform
socialRouter.delete('/disconnect/:platform', async (c) => {
  const workspace = c.get('workspace');
  const platform = c.req.param('platform');
  if (!['instagram', 'tiktok'].includes(platform)) {
    return c.json<TfResponse<null>>({ success: false, message: 'Invalid platform' }, 400);
  }
  try {
    await deleteSocialAccount(c.env.DB, workspace.id, platform);
    return c.json<TfResponse<null>>({ success: true, message: `${platform} disconnected` });
  } catch (error) {
    Logger.log('DisconnectSocialError', { workspaceId: workspace.id, platform }, error);
    return c.json<TfResponse<null>>({ success: false, message: 'Internal server error' }, 500);
  }
});

export default socialRouter;
