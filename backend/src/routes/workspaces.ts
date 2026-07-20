import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { getWorkspacesByOwner, getWorkspaceBySlug, createWorkspace, updateWorkspace } from '../db/queries';
import type { CloudflareBindings } from '../env';
import type { ContextVariables, TfResponse, Workspace } from '../types';
import { Logger } from '../utils/Logger';

type Env = { Bindings: CloudflareBindings; Variables: ContextVariables };

const workspacesRouter = new Hono<Env>();

workspacesRouter.use('*', authMiddleware);

// GET /api/workspaces — list all workspaces for the authenticated user
workspacesRouter.get('/', async (c) => {
  const userId = c.get('userId');
  try {
    const result = await getWorkspacesByOwner(c.env.DB, userId);
    return c.json<TfResponse<Workspace[]>>({ success: true, data: result.results });
  } catch (error) {
    Logger.log('ListWorkspacesError', { userId }, error);
    return c.json<TfResponse<null>>({ success: false, message: 'Internal server error' }, 500);
  }
});

const CreateWorkspaceSchema = z.object({
  name: z.string().min(1).max(60),
  aiTone: z.enum(['professional', 'casual', 'witty', 'formal', 'inspirational']).default('professional'),
  defaultCaptionStyle: z.enum(['short', 'medium', 'long']).default('short'),
  defaultPlatforms: z.array(z.enum(['instagram', 'tiktok'])).min(1).default(['instagram']),
});

// POST /api/workspaces — create a new workspace
workspacesRouter.post('/', async (c) => {
  const userId = c.get('userId');
  try {
    const body = await c.req.json();
    const parsed = CreateWorkspaceSchema.safeParse(body);
    if (!parsed.success) {
      return c.json<TfResponse<null>>({ success: false, message: parsed.error.message }, 400);
    }

    const { name, aiTone, defaultCaptionStyle, defaultPlatforms } = parsed.data;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + crypto.randomUUID().slice(0, 6);
    const workspaceId = crypto.randomUUID();

    await createWorkspace(c.env.DB, {
      id: workspaceId,
      owner_id: userId,
      name,
      slug,
      ai_tone: aiTone,
      default_caption_style: defaultCaptionStyle,
      default_platforms: JSON.stringify(defaultPlatforms),
    });

    const workspace = await getWorkspaceBySlug(c.env.DB, slug);
    return c.json<TfResponse<Workspace>>({ success: true, data: workspace! }, 201);
  } catch (error) {
    Logger.log('CreateWorkspaceError', { userId }, error);
    return c.json<TfResponse<null>>({ success: false, message: 'Internal server error' }, 500);
  }
});

// GET /api/workspaces/:slug — get one workspace (must be owner)
workspacesRouter.get('/:slug', async (c) => {
  const userId = c.get('userId');
  const slug = c.req.param('slug');
  try {
    const workspace = await getWorkspaceBySlug(c.env.DB, slug);
    if (!workspace || workspace.owner_id !== userId) {
      return c.json<TfResponse<null>>({ success: false, message: 'Not found' }, 404);
    }
    return c.json<TfResponse<Workspace>>({ success: true, data: workspace });
  } catch (error) {
    Logger.log('GetWorkspaceError', { slug, userId }, error);
    return c.json<TfResponse<null>>({ success: false, message: 'Internal server error' }, 500);
  }
});

const UpdateWorkspaceSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  ai_tone: z.enum(['professional', 'casual', 'witty', 'formal', 'inspirational']).optional(),
  default_caption_style: z.enum(['short', 'medium', 'long']).optional(),
  default_platforms: z.array(z.enum(['instagram', 'tiktok'])).optional(),
  avatar_url: z.string().url().optional().nullable(),
});

// PATCH /api/workspaces/:slug — update workspace settings
workspacesRouter.patch('/:slug', async (c) => {
  const userId = c.get('userId');
  const slug = c.req.param('slug');
  try {
    const workspace = await getWorkspaceBySlug(c.env.DB, slug);
    if (!workspace || workspace.owner_id !== userId) {
      return c.json<TfResponse<null>>({ success: false, message: 'Not found' }, 404);
    }

    const body = await c.req.json();
    const parsed = UpdateWorkspaceSchema.safeParse(body);
    if (!parsed.success) {
      return c.json<TfResponse<null>>({ success: false, message: parsed.error.message }, 400);
    }

    const update: Record<string, unknown> = {};
    if (parsed.data.name) update.name = parsed.data.name;
    if (parsed.data.ai_tone) update.ai_tone = parsed.data.ai_tone;
    if (parsed.data.default_caption_style) update.default_caption_style = parsed.data.default_caption_style;
    if (parsed.data.default_platforms) update.default_platforms = JSON.stringify(parsed.data.default_platforms);
    if ('avatar_url' in parsed.data) update.avatar_url = parsed.data.avatar_url;

    if (Object.keys(update).length > 0) {
      await updateWorkspace(c.env.DB, workspace.id, update as Parameters<typeof updateWorkspace>[2]);
    }

    const updated = await getWorkspaceBySlug(c.env.DB, slug);
    return c.json<TfResponse<Workspace>>({ success: true, data: updated! });
  } catch (error) {
    Logger.log('UpdateWorkspaceError', { slug, userId }, error);
    return c.json<TfResponse<null>>({ success: false, message: 'Internal server error' }, 500);
  }
});

export default workspacesRouter;
