import { Hono } from 'hono';
import { authAdminMiddleware } from '../../middleware/auth';
import { runAllMigrations } from '../../migrations';
import type { CloudflareBindings } from '../../env';
import type { ContextVariables, TfResponse } from '../../types';
import { Logger } from '../../utils/Logger';

type Env = { Bindings: CloudflareBindings; Variables: ContextVariables };

const adminRouter = new Hono<Env>();

adminRouter.use('*', authAdminMiddleware);

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

export default adminRouter;
