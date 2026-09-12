import { Hono } from 'hono';
import { authMiddleware, signImpersonationToken } from '../../middleware/auth';
import { superAdminMiddleware } from '../../middleware/superAdmin';
import { runAllMigrations } from '../../migrations';
import { getAllWorkspacesAssetUsage, getAllWorkspacesMessageUsage, listAppSettings, setAppSetting, deleteAppSetting } from '../../db/queries';
import { parseDateRange } from '../billing';
import { concatClips, extractLastFrame } from '../../services/videoStitch';
import { getPublicUrl } from '../../services/r2';
import { STITCH_MIN_CHUNKS, STITCH_MAX_CHUNKS } from '../../services/generationConfig';
import { parseMockReplicateConfig, validateReplicateInput, type MockReplicateConfig } from '../../services/mockReplicate';
import type { CloudflareBindings } from '../../env';
import type { ContextVariables, TfResponse } from '../../types';
import { Logger } from '../../utils/Logger';

type Env = { Bindings: CloudflareBindings; Variables: ContextVariables };

const adminRouter = new Hono<Env>();

// All admin routes require a valid Clerk JWT + the hardcoded super-admin email.
// Note: authMiddleware is used here (not the impersonation-aware one in the main app)
// because admin access must always be from the real admin's Clerk session.
adminRouter.use('*', authMiddleware, superAdminMiddleware);

// POST /api/admin/migrate — run all DB migrations
adminRouter.post('/migrate', async (c) => {
  try {
    const messages = await runAllMigrations(c.env.DB);
    Logger.log('MigrationsRun', { messages });
    return c.json<TfResponse<{ messages: string[] }>>({ success: true, data: { messages } });
  } catch (error) {
    Logger.log('MigrationsError', undefined, error);
    return c.json<TfResponse<null>>(
      { success: false, message: error instanceof Error ? error.message : 'Migration failed' },
      500,
    );
  }
});

// ─── POST /api/admin/stitch-test ──────────────────────────────────────────────
// Isolated harness for the ffmpeg-in-a-container + R2-egress-mount path. It runs
// concatClips / extractLastFrame DIRECTLY on arbitrary public clip URLs — no
// Replicate generation, no cost, no D1 asset row — so we can verify the parts
// that only work live (real container + mount) and see whether the write went
// straight to R2 (`mounted: true`) or fell back to reading bytes back.

interface StitchTestResult {
  op: 'concat' | 'frame';
  outKey: string;
  publicUrl: string;
  mounted: boolean;       // true = wrote straight to R2 via the egress mount
  sizeBytes: number;
  ms: number;             // wall-clock time for the ffmpeg job
  clipCount?: number;
}

const isHttpUrl = (u: string) => /^https?:\/\/\S+$/i.test(u);

adminRouter.post('/stitch-test', async (c) => {
  const body = await c.req
    .json<{ op?: string; clipUrls?: unknown; clipUrl?: unknown; aspectRatio?: string }>()
    .catch(() => ({} as { op?: string; clipUrls?: unknown; clipUrl?: unknown; aspectRatio?: string }));

  const op: 'concat' | 'frame' = body.op === 'frame' ? 'frame' : 'concat';
  const aspectRatio: '16:9' | '9:16' = body.aspectRatio === '16:9' ? '16:9' : '9:16';
  const testId = crypto.randomUUID();
  const startedAt = Date.now();

  try {
    if (op === 'frame') {
      const clipUrl = typeof body.clipUrl === 'string' ? body.clipUrl.trim() : '';
      if (!isHttpUrl(clipUrl)) {
        return c.json<TfResponse<null>>({ success: false, message: 'Provide a valid http(s) clip URL.' }, 400);
      }
      const outKey = `_admin-stitch-tests/${testId}-frame.png`;
      const r = await extractLastFrame(c.env, { assetId: `admin-${testId}`, clipUrl, outKey });
      return c.json<TfResponse<StitchTestResult>>({
        success: true,
        data: { op, outKey, publicUrl: r.publicUrl, mounted: r.mounted, sizeBytes: r.sizeBytes, ms: Date.now() - startedAt },
      });
    }

    // op === 'concat'
    const clipUrls = Array.isArray(body.clipUrls)
      ? body.clipUrls.filter((u): u is string => typeof u === 'string').map((u) => u.trim()).filter(Boolean)
      : [];
    if (clipUrls.length < STITCH_MIN_CHUNKS) {
      return c.json<TfResponse<null>>({ success: false, message: `Need at least ${STITCH_MIN_CHUNKS} clip URLs.` }, 400);
    }
    if (clipUrls.length > STITCH_MAX_CHUNKS) {
      return c.json<TfResponse<null>>({ success: false, message: `At most ${STITCH_MAX_CHUNKS} clip URLs.` }, 400);
    }
    const bad = clipUrls.find((u) => !isHttpUrl(u));
    if (bad) {
      return c.json<TfResponse<null>>({ success: false, message: `Not a valid http(s) URL: ${bad}` }, 400);
    }

    const outKey = `_admin-stitch-tests/${testId}.mp4`;
    const r = await concatClips(c.env, { assetId: `admin-${testId}`, clipUrls, outKey, aspectRatio });
    return c.json<TfResponse<StitchTestResult>>({
      success: true,
      data: {
        op,
        outKey,
        publicUrl: getPublicUrl(c.env.ASSETS_PUBLIC_URL, outKey),
        mounted: r.mounted,
        sizeBytes: r.sizeBytes,
        ms: Date.now() - startedAt,
        clipCount: clipUrls.length,
      },
    });
  } catch (error) {
    Logger.log('AdminStitchTestError', { op, ms: Date.now() - startedAt }, error);
    return c.json<TfResponse<null>>(
      { success: false, message: error instanceof Error ? error.message : 'Stitch test failed' },
      500,
    );
  }
});

// ─── Admin types ──────────────────────────────────────────────────────────────

interface AdminStats {
  totalUsers: number;
  totalWorkspaces: number;
  totalThreads: number;
}

interface AdminUser {
  id: string;
  email: string | null;
  name: string | null;
  onboarded: number;
  created_at: number;
  workspaceCount: number;
  workspaceSlug: string | null;
}

// ─── GET /api/admin/stats ─────────────────────────────────────────────────────

adminRouter.get('/stats', async (c) => {
  try {
    const [users, workspaces, threads] = await Promise.all([
      c.env.DB.prepare('SELECT COUNT(*) as count FROM users').first<{ count: number }>(),
      c.env.DB.prepare('SELECT COUNT(*) as count FROM workspaces').first<{ count: number }>(),
      c.env.DB.prepare('SELECT COUNT(*) as count FROM threads').first<{ count: number }>(),
    ]);

    return c.json<TfResponse<AdminStats>>({
      success: true,
      data: {
        totalUsers: users?.count ?? 0,
        totalWorkspaces: workspaces?.count ?? 0,
        totalThreads: threads?.count ?? 0,
      },
    });
  } catch (error) {
    Logger.log('AdminStatsError', undefined, error);
    return c.json<TfResponse<null>>({ success: false, message: 'Failed to fetch stats' }, 500);
  }
});

// ─── GET /api/admin/users?search=<query> ─────────────────────────────────────

adminRouter.get('/users', async (c) => {
  try {
    const search = c.req.query('search')?.trim() ?? '';
    const like = search ? `%${search}%` : null;

    const result = await c.env.DB
      .prepare(
        `SELECT u.id, u.email, u.name, u.onboarded, u.created_at,
                COUNT(w.id) as workspaceCount,
                MIN(w.slug) as workspaceSlug
         FROM users u
         LEFT JOIN workspaces w ON w.owner_id = u.id
         ${like ? 'WHERE u.id LIKE ? OR u.email LIKE ? OR u.name LIKE ?' : ''}
         GROUP BY u.id
         ORDER BY u.created_at DESC`
      )
      .bind(...(like ? [like, like, like] : []))
      .all<AdminUser>();

    return c.json<TfResponse<AdminUser[]>>({ success: true, data: result.results });
  } catch (error) {
    Logger.log('AdminListUsersError', undefined, error);
    return c.json<TfResponse<null>>({ success: false, message: 'Failed to fetch users' }, 500);
  }
});

// ─── GET /api/admin/usage ─────────────────────────────────────────────────────

interface WorkspaceUsage {
  workspaceId: string;
  name: string;
  slug: string;
  textCost: number;
  imageCost: number;
  videoCost: number;
  totalCost: number;
  messageCount: number;
  imageCount: number;
  videoCount: number;
  inputTokens: number;
  outputTokens: number;
}

interface AdminUsageUser {
  userId: string;
  email: string | null;
  name: string | null;
  textCost: number;
  imageCost: number;
  videoCost: number;
  totalCost: number;
  messageCount: number;
  imageCount: number;
  videoCount: number;
  inputTokens: number;
  outputTokens: number;
  workspaces: WorkspaceUsage[];
}

interface AdminUsageResponse {
  totals: {
    totalCost: number;
    textCost: number;
    imageCost: number;
    videoCost: number;
    payingUsers: number;
    messageCount: number;
    imageCount: number;
    videoCount: number;
  };
  users: AdminUsageUser[];
}

function emptyWorkspaceUsage(workspaceId: string, name: string, slug: string): WorkspaceUsage {
  return {
    workspaceId, name, slug,
    textCost: 0, imageCost: 0, videoCost: 0, totalCost: 0,
    messageCount: 0, imageCount: 0, videoCount: 0,
    inputTokens: 0, outputTokens: 0,
  };
}

adminRouter.get('/usage', async (c) => {
  const range = parseDateRange(c.req.query('from'), c.req.query('to'));
  try {
    const [users, workspaces, assetUsage, messageUsage] = await Promise.all([
      c.env.DB.prepare('SELECT id, email, name FROM users').all<{ id: string; email: string | null; name: string | null }>(),
      c.env.DB.prepare('SELECT id, owner_id, name, slug FROM workspaces').all<{ id: string; owner_id: string; name: string; slug: string }>(),
      getAllWorkspacesAssetUsage(c.env.DB, range),
      getAllWorkspacesMessageUsage(c.env.DB, range),
    ]);

    // User rows (seeded so everyone is listed) + a nested workspace map per user.
    const userMeta = new Map<string, { email: string | null; name: string | null }>();
    for (const u of users.results) userMeta.set(u.id, { email: u.email, name: u.name });

    const wsByUser = new Map<string, Map<string, WorkspaceUsage>>();

    const ensureUserMap = (userId: string): Map<string, WorkspaceUsage> => {
      let m = wsByUser.get(userId);
      if (!m) { m = new Map(); wsByUser.set(userId, m); }
      return m;
    };

    const ensureWorkspace = (userId: string, workspaceId: string, name: string, slug: string): WorkspaceUsage => {
      const m = ensureUserMap(userId);
      let ws = m.get(workspaceId);
      if (!ws) { ws = emptyWorkspaceUsage(workspaceId, name, slug); m.set(workspaceId, ws); }
      return ws;
    };

    // Seed every user (even with no workspaces) and every workspace (even with no usage).
    for (const u of users.results) ensureUserMap(u.id);
    for (const w of workspaces.results) ensureWorkspace(w.owner_id, w.id, w.name, w.slug);

    for (const row of assetUsage.results) {
      const ws = ensureWorkspace(row.userId, row.workspaceId, row.name, row.slug);
      const cost = row.cost ?? 0;
      if (row.type === 'video') { ws.videoCost += cost; ws.videoCount += row.count; }
      else { ws.imageCost += cost; ws.imageCount += row.count; }
    }

    for (const row of messageUsage.results) {
      const ws = ensureWorkspace(row.userId, row.workspaceId, row.name, row.slug);
      ws.textCost += row.cost ?? 0;
      ws.messageCount += row.count;
      ws.inputTokens += row.input_tokens ?? 0;
      ws.outputTokens += row.output_tokens ?? 0;
    }

    // Roll workspace usage up into per-user totals.
    const usersList: AdminUsageUser[] = [...wsByUser.entries()].map(([userId, wsMap]) => {
      const meta = userMeta.get(userId) ?? { email: null, name: null };
      const workspaceList = [...wsMap.values()];
      for (const ws of workspaceList) ws.totalCost = ws.textCost + ws.imageCost + ws.videoCost;
      workspaceList.sort((a, b) => b.totalCost - a.totalCost);

      const u: AdminUsageUser = {
        userId, email: meta.email, name: meta.name,
        textCost: 0, imageCost: 0, videoCost: 0, totalCost: 0,
        messageCount: 0, imageCount: 0, videoCount: 0,
        inputTokens: 0, outputTokens: 0,
        workspaces: workspaceList,
      };
      for (const ws of workspaceList) {
        u.textCost += ws.textCost;
        u.imageCost += ws.imageCost;
        u.videoCost += ws.videoCost;
        u.messageCount += ws.messageCount;
        u.imageCount += ws.imageCount;
        u.videoCount += ws.videoCount;
        u.inputTokens += ws.inputTokens;
        u.outputTokens += ws.outputTokens;
      }
      u.totalCost = u.textCost + u.imageCost + u.videoCost;
      return u;
    });
    usersList.sort((a, b) => b.totalCost - a.totalCost);

    const totals = usersList.reduce(
      (acc, u) => {
        acc.totalCost += u.totalCost;
        acc.textCost += u.textCost;
        acc.imageCost += u.imageCost;
        acc.videoCost += u.videoCost;
        acc.messageCount += u.messageCount;
        acc.imageCount += u.imageCount;
        acc.videoCount += u.videoCount;
        if (u.totalCost > 0) acc.payingUsers += 1;
        return acc;
      },
      { totalCost: 0, textCost: 0, imageCost: 0, videoCost: 0, payingUsers: 0, messageCount: 0, imageCount: 0, videoCount: 0 }
    );

    return c.json<TfResponse<AdminUsageResponse>>({
      success: true,
      data: { totals, users: usersList },
    });
  } catch (error) {
    Logger.log('AdminUsageError', undefined, error);
    return c.json<TfResponse<null>>({ success: false, message: 'Failed to fetch usage' }, 500);
  }
});

// ─── POST /api/admin/impersonate/:userId ─────────────────────────────────────

adminRouter.post('/impersonate/:userId', async (c) => {
  try {
    const targetUserId = c.req.param('userId');
    const adminId = c.get('userId');

    if (targetUserId === adminId) {
      return c.json<TfResponse<null>>({ success: false, message: 'Cannot impersonate yourself' }, 400);
    }

    const [targetUser, targetWorkspace] = await Promise.all([
      c.env.DB.prepare('SELECT id, email, name, onboarded, created_at FROM users WHERE id = ?')
        .bind(targetUserId)
        .first<{ id: string; email: string | null; name: string | null; onboarded: number; created_at: number }>(),
      c.env.DB.prepare('SELECT slug FROM workspaces WHERE owner_id = ? LIMIT 1')
        .bind(targetUserId)
        .first<{ slug: string }>(),
    ]);

    if (!targetUser) {
      return c.json<TfResponse<null>>({ success: false, message: 'User not found' }, 404);
    }

    const token = await signImpersonationToken(c.env.SUPER_ADMIN_SECRET, {
      sub: targetUserId,
      admin: adminId,
      type: 'impersonation',
    });

    Logger.log('AdminImpersonateStart', { adminId, targetUserId });

    return c.json<TfResponse<{ token: string; user: typeof targetUser; workspaceSlug: string | null }>>({
      success: true,
      data: { token, user: targetUser, workspaceSlug: targetWorkspace?.slug ?? null },
    });
  } catch (error) {
    Logger.log('AdminImpersonateError', undefined, error);
    return c.json<TfResponse<null>>({ success: false, message: 'Failed to issue impersonation token' }, 500);
  }
});

// ─── Mock Replicate — global default + per-workspace overrides ────────────────
//
// Setting key:   mock_replicate
// Scope '*':     global default (applies when no workspace override exists)
// Other scopes:  workspace-id specific override
//
// Config JSON: { enabled: boolean, videoUrls: string[] }
//   videoUrls: one URL per line; empty = auto-pick from existing ready videos.
//   Special sentinel: "FAIL" or "FAIL: <reason>" forces a failed prediction.

interface MockWorkspaceOverride extends MockReplicateConfig {
  workspaceId: string;
  name: string;
  slug: string;
}

interface MockReplicateResponse {
  global: MockReplicateConfig;
  overrides: MockWorkspaceOverride[];
}

// POST /api/admin/mock-replicate/validate
// Dry-run input validation against our local schema — returns a 422-shaped error
// body if the input would be rejected, or { valid: true } if it looks correct.
// No Replicate API call is made; this costs nothing and works with no token.
adminRouter.post('/mock-replicate/validate', async (c) => {
  try {
    const body = await c.req.json() as { modelSlug?: string; input?: Record<string, unknown> };
    if (!body.modelSlug || typeof body.modelSlug !== 'string') {
      return c.json<TfResponse<null>>({ success: false, message: 'modelSlug is required' }, 400);
    }
    const input = (typeof body.input === 'object' && body.input !== null) ? body.input : {};
    const error = validateReplicateInput(body.modelSlug, input);
    if (error) {
      return c.json<TfResponse<{ valid: false; error: typeof error }>>({
        success: true,
        data: { valid: false, error },
      });
    }
    return c.json<TfResponse<{ valid: true }>>({ success: true, data: { valid: true } });
  } catch (error) {
    Logger.log('AdminMockReplicateValidateError', undefined, error);
    return c.json<TfResponse<null>>({ success: false, message: 'Validation check failed' }, 500);
  }
});

// GET /api/admin/mock-replicate/r2-videos — list ready R2 video public URLs available for the mock pool
//   ?scope=<workspaceId>  → videos owned by that workspace
//   ?scope=global (or omit) → up to 20 ready videos from any workspace on the platform
adminRouter.get('/mock-replicate/r2-videos', async (c) => {
  try {
    const scope = c.req.query('scope') ?? 'global';

    let rows: { r2_key: string }[];
    if (scope && scope !== 'global') {
      // Workspace-scoped: videos owned by this workspace
      const result = await c.env.DB
        .prepare(
          "SELECT r2_key FROM assets WHERE workspace_id = ? AND type = 'video' AND status = 'ready' AND r2_key IS NOT NULL ORDER BY created_at DESC LIMIT 30",
        )
        .bind(scope)
        .all<{ r2_key: string }>();
      rows = result.results;
    } else {
      // Global: sample across all workspaces (useful for seeding the global default)
      const result = await c.env.DB
        .prepare(
          "SELECT r2_key FROM assets WHERE type = 'video' AND status = 'ready' AND r2_key IS NOT NULL ORDER BY created_at DESC LIMIT 20",
        )
        .all<{ r2_key: string }>();
      rows = result.results;
    }

    const urls = rows.map((r) => getPublicUrl(c.env.ASSETS_PUBLIC_URL, r.r2_key));
    return c.json<TfResponse<{ urls: string[]; scope: string }>>({
      success: true,
      data: { urls, scope },
    });
  } catch (error) {
    Logger.log('AdminMockReplicateR2VideosError', undefined, error);
    return c.json<TfResponse<null>>({ success: false, message: 'Failed to list R2 videos' }, 500);
  }
});

// GET /api/admin/mock-replicate — current global config + all workspace overrides
adminRouter.get('/mock-replicate', async (c) => {
  try {
    const rows = await listAppSettings(c.env.DB, 'mock_replicate');

    const globalRow = rows.find((r) => r.workspace_id === '*');
    const overrideRows = rows.filter((r) => r.workspace_id !== '*');

    const globalConfig = parseMockReplicateConfig(globalRow?.value ?? null);

    // Join overrides with workspaces table for human-readable name + slug.
    let workspaceMeta: Record<string, { name: string; slug: string }> = {};
    if (overrideRows.length > 0) {
      const ids = overrideRows.map((r) => r.workspace_id);
      const placeholders = ids.map(() => '?').join(', ');
      const ws = await c.env.DB
        .prepare(`SELECT id, name, slug FROM workspaces WHERE id IN (${placeholders})`)
        .bind(...ids)
        .all<{ id: string; name: string; slug: string }>();
      workspaceMeta = Object.fromEntries(ws.results.map((w) => [w.id, { name: w.name, slug: w.slug }]));
    }

    const overrides: MockWorkspaceOverride[] = overrideRows.map((r) => ({
      workspaceId: r.workspace_id,
      name: workspaceMeta[r.workspace_id]?.name ?? r.workspace_id,
      slug: workspaceMeta[r.workspace_id]?.slug ?? r.workspace_id,
      ...parseMockReplicateConfig(r.value),
    }));

    return c.json<TfResponse<MockReplicateResponse>>({
      success: true,
      data: { global: globalConfig, overrides },
    });
  } catch (error) {
    Logger.log('AdminMockReplicateGetError', undefined, error);
    return c.json<TfResponse<null>>({ success: false, message: 'Failed to fetch mock Replicate config' }, 500);
  }
});

// PUT /api/admin/mock-replicate — create or update a scope (global or workspace)
adminRouter.put('/mock-replicate', async (c) => {
  try {
    const body = await c.req.json() as { scope?: string; enabled?: boolean; videoUrls?: unknown };

    if (typeof body.scope !== 'string' || !body.scope.trim()) {
      return c.json<TfResponse<null>>({ success: false, message: 'scope is required ("global" or a workspace id)' }, 400);
    }
    if (typeof body.enabled !== 'boolean') {
      return c.json<TfResponse<null>>({ success: false, message: 'enabled (boolean) is required' }, 400);
    }
    const videoUrls = Array.isArray(body.videoUrls)
      ? body.videoUrls.filter((u): u is string => typeof u === 'string')
      : [];

    const workspaceId = body.scope.trim() === 'global' ? '*' : body.scope.trim();
    const value = JSON.stringify({ enabled: body.enabled, videoUrls } satisfies MockReplicateConfig);

    await setAppSetting(c.env.DB, 'mock_replicate', workspaceId, value);
    Logger.log('AdminMockReplicateUpdated', { scope: body.scope, enabled: body.enabled });
    return c.json<TfResponse<null>>({ success: true });
  } catch (error) {
    Logger.log('AdminMockReplicatePutError', undefined, error);
    return c.json<TfResponse<null>>({ success: false, message: 'Failed to update mock Replicate config' }, 500);
  }
});

// DELETE /api/admin/mock-replicate/:workspaceId — remove a workspace override
// (the workspace then inherits the global default)
adminRouter.delete('/mock-replicate/:workspaceId', async (c) => {
  try {
    const workspaceId = c.req.param('workspaceId');
    if (workspaceId === '*' || workspaceId === 'global') {
      return c.json<TfResponse<null>>({
        success: false,
        message: 'Cannot delete the global default — use PUT to disable it instead',
      }, 400);
    }
    await deleteAppSetting(c.env.DB, 'mock_replicate', workspaceId);
    Logger.log('AdminMockReplicateDeleted', { workspaceId });
    return c.json<TfResponse<null>>({ success: true });
  } catch (error) {
    Logger.log('AdminMockReplicateDeleteError', undefined, error);
    return c.json<TfResponse<null>>({ success: false, message: 'Failed to delete mock Replicate override' }, 500);
  }
});

export default adminRouter;
