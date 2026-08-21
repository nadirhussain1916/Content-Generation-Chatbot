import { Hono } from 'hono';
import { authMiddleware, signImpersonationToken } from '../../middleware/auth';
import { superAdminMiddleware } from '../../middleware/superAdmin';
import { runAllMigrations } from '../../migrations';
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
        `SELECT u.id, u.onboarded, u.created_at,
                COUNT(w.id) as workspaceCount,
                MIN(w.slug) as workspaceSlug
         FROM users u
         LEFT JOIN workspaces w ON w.owner_id = u.id
         ${like ? 'WHERE u.id LIKE ?' : ''}
         GROUP BY u.id
         ORDER BY u.created_at DESC`
      )
      .bind(...(like ? [like] : []))
      .all<AdminUser>();

    return c.json<TfResponse<AdminUser[]>>({ success: true, data: result.results });
  } catch (error) {
    Logger.log('AdminListUsersError', undefined, error);
    return c.json<TfResponse<null>>({ success: false, message: 'Failed to fetch users' }, 500);
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
      c.env.DB.prepare('SELECT id, onboarded, created_at FROM users WHERE id = ?')
        .bind(targetUserId)
        .first<{ id: string; onboarded: number; created_at: number }>(),
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
