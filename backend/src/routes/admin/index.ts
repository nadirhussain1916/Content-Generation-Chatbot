import { Hono } from 'hono';
import { authMiddleware, signImpersonationToken } from '../../middleware/auth';
import { superAdminMiddleware } from '../../middleware/superAdmin';
import { runAllMigrations } from '../../migrations';
import { getAllUsersAssetUsage, getAllUsersMessageUsage } from '../../db/queries';
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
    return c.json<TfResponse<null>>({ success: false, message: 'Migration failed' }, 500);
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

adminRouter.get('/usage', async (c) => {
  try {
    const [users, assetUsage, messageUsage] = await Promise.all([
      c.env.DB.prepare('SELECT id, email, name FROM users').all<{ id: string; email: string | null; name: string | null }>(),
      getAllUsersAssetUsage(c.env.DB),
      getAllUsersMessageUsage(c.env.DB),
    ]);

    // Seed a row for every user so the table lists everyone.
    const byUser = new Map<string, AdminUsageUser>();
    for (const u of users.results) {
      byUser.set(u.id, {
        userId: u.id, email: u.email, name: u.name,
        textCost: 0, imageCost: 0, videoCost: 0, totalCost: 0,
        messageCount: 0, imageCount: 0, videoCount: 0,
        inputTokens: 0, outputTokens: 0,
      });
    }

    const ensure = (userId: string): AdminUsageUser => {
      let row = byUser.get(userId);
      if (!row) {
        // Usage attributed to a workspace whose owner is missing from users — still surface it.
        row = {
          userId, email: null, name: null,
          textCost: 0, imageCost: 0, videoCost: 0, totalCost: 0,
          messageCount: 0, imageCount: 0, videoCount: 0,
          inputTokens: 0, outputTokens: 0,
        };
        byUser.set(userId, row);
      }
      return row;
    };

    for (const row of assetUsage.results) {
      const u = ensure(row.userId);
      const cost = row.cost ?? 0;
      if (row.type === 'video') { u.videoCost += cost; u.videoCount += row.count; }
      else { u.imageCost += cost; u.imageCount += row.count; }
    }

    for (const row of messageUsage.results) {
      const u = ensure(row.userId);
      u.textCost += row.cost ?? 0;
      u.messageCount += row.count;
      u.inputTokens += row.input_tokens ?? 0;
      u.outputTokens += row.output_tokens ?? 0;
    }

    const usersList = [...byUser.values()];
    for (const u of usersList) u.totalCost = u.textCost + u.imageCost + u.videoCost;
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
