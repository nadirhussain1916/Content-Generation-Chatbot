import { Hono } from 'hono';
import { authMiddleware, workspaceMiddleware } from '../middleware/auth';
import {
  getThreadsByWorkspace, getThread, createThread, updateThread, deleteThread,
  getMessages, getAssetsByThread,
} from '../db/queries';
import type { Asset } from '../types';
import type { CloudflareBindings } from '../env';
import type { ContextVariables, TfResponse, Thread, Message } from '../types';
import { Logger } from '../utils/Logger';

type Env = { Bindings: CloudflareBindings; Variables: ContextVariables };

const threadsRouter = new Hono<Env>();

threadsRouter.use('*', authMiddleware);
threadsRouter.use('*', workspaceMiddleware);

// GET /api/workspaces/:slug/threads
threadsRouter.get('/', async (c) => {
  const workspace = c.get('workspace');
  try {
    const result = await getThreadsByWorkspace(c.env.DB, workspace.id);
    return c.json<TfResponse<Thread[]>>({ success: true, data: result.results });
  } catch (error) {
    Logger.log('ListThreadsError', { workspaceId: workspace.id }, error);
    return c.json<TfResponse<null>>({ success: false, message: 'Internal server error' }, 500);
  }
});

// POST /api/workspaces/:slug/threads — create empty thread
threadsRouter.post('/', async (c) => {
  const workspace = c.get('workspace');
  const userId = c.get('userId');
  try {
    const body = await c.req.json().catch(() => ({})) as { title?: string };
    const threadId = crypto.randomUUID();

    await createThread(c.env.DB, {
      id: threadId,
      workspace_id: workspace.id,
      created_by: userId,
      title: body.title,
    });

    const thread = await getThread(c.env.DB, threadId);
    return c.json<TfResponse<Thread>>({ success: true, data: thread! }, 201);
  } catch (error) {
    Logger.log('CreateThreadError', { workspaceId: workspace.id }, error);
    return c.json<TfResponse<null>>({ success: false, message: 'Internal server error' }, 500);
  }
});

// GET /api/workspaces/:slug/threads/:threadId — thread + messages
threadsRouter.get('/:threadId', async (c) => {
  const workspace = c.get('workspace');
  const threadId = c.req.param('threadId');
  try {
    const thread = await getThread(c.env.DB, threadId);
    if (!thread || thread.workspace_id !== workspace.id) {
      return c.json<TfResponse<null>>({ success: false, message: 'Thread not found' }, 404);
    }

    const messagesResult = await getMessages(c.env.DB, threadId);
    return c.json<TfResponse<{ thread: Thread; messages: Message[] }>>({
      success: true,
      data: { thread, messages: messagesResult.results },
    });
  } catch (error) {
    Logger.log('GetThreadError', { threadId }, error);
    return c.json<TfResponse<null>>({ success: false, message: 'Internal server error' }, 500);
  }
});

// PATCH /api/workspaces/:slug/threads/:threadId — update title/status
threadsRouter.patch('/:threadId', async (c) => {
  const workspace = c.get('workspace');
  const threadId = c.req.param('threadId');
  try {
    const thread = await getThread(c.env.DB, threadId);
    if (!thread || thread.workspace_id !== workspace.id) {
      return c.json<TfResponse<null>>({ success: false, message: 'Thread not found' }, 404);
    }

    const body = await c.req.json() as Partial<Pick<Thread, 'title' | 'status' | 'media_type'>>;
    const update: Record<string, unknown> = {};
    if ('title' in body) update['title'] = body.title;
    if ('status' in body) update['status'] = body.status;
    if ('media_type' in body) update['media_type'] = body.media_type;

    if (Object.keys(update).length > 0) {
      await updateThread(c.env.DB, threadId, update as Parameters<typeof updateThread>[2]);
    }

    const updated = await getThread(c.env.DB, threadId);
    return c.json<TfResponse<Thread>>({ success: true, data: updated! });
  } catch (error) {
    Logger.log('UpdateThreadError', { threadId }, error);
    return c.json<TfResponse<null>>({ success: false, message: 'Internal server error' }, 500);
  }
});

// GET /api/workspaces/:slug/threads/:threadId/assets
threadsRouter.get('/:threadId/assets', async (c) => {
  const workspace = c.get('workspace');
  const threadId = c.req.param('threadId');
  try {
    const thread = await getThread(c.env.DB, threadId);
    if (!thread || thread.workspace_id !== workspace.id) {
      return c.json<TfResponse<null>>({ success: false, message: 'Thread not found' }, 404);
    }
    const result = await getAssetsByThread(c.env.DB, threadId);
    return c.json<TfResponse<Asset[]>>({ success: true, data: result.results });
  } catch (error) {
    Logger.log('GetThreadAssetsError', { threadId }, error);
    return c.json<TfResponse<null>>({ success: false, message: 'Internal server error' }, 500);
  }
});

// DELETE /api/workspaces/:slug/threads/:threadId
threadsRouter.delete('/:threadId', async (c) => {
  const workspace = c.get('workspace');
  const threadId = c.req.param('threadId');
  try {
    const thread = await getThread(c.env.DB, threadId);
    if (!thread || thread.workspace_id !== workspace.id) {
      return c.json<TfResponse<null>>({ success: false, message: 'Thread not found' }, 404);
    }
    await deleteThread(c.env.DB, threadId);
    return c.json<TfResponse<null>>({ success: true, message: 'Thread deleted' });
  } catch (error) {
    Logger.log('DeleteThreadError', { threadId }, error);
    return c.json<TfResponse<null>>({ success: false, message: 'Internal server error' }, 500);
  }
});

export default threadsRouter;
