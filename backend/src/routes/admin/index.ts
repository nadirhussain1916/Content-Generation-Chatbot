import { Hono } from 'hono';
import { authMiddleware, signImpersonationToken } from '../../middleware/auth';
import { superAdminMiddleware } from '../../middleware/superAdmin';
import { runAllMigrations } from '../../migrations';
import { getAllWorkspacesAssetUsage, getAllWorkspacesMessageUsage } from '../../db/queries';
import { parseDateRange } from '../billing';
import { concatClips, extractLastFrame } from '../../services/videoStitch';
import { getPublicUrl } from '../../services/r2';
import { STITCH_MIN_CHUNKS, STITCH_MAX_CHUNKS } from '../../services/generationConfig';
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

export default adminRouter;
