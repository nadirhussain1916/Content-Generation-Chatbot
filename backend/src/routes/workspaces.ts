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

// ─── Platform settings helpers ────────────────────────────────────────────────

type AspectRatio = '9:16' | '16:9' | '1:1' | '4:3' | '3:4' | '21:9' | '9:21';
interface PlatformConfig { enabled: boolean; aspectRatio: AspectRatio }

/** Derive workspace-level image size from an aspect ratio. */
function imageSizeFromRatio(ratio: AspectRatio): '1024x1024' | '1024x1792' | '1792x1024' {
  if (ratio === '9:16' || ratio === '3:4' || ratio === '9:21') return '1024x1792';
  if (ratio === '16:9' || ratio === '4:3' || ratio === '21:9') return '1792x1024';
  return '1024x1024';
}

/** Derive workspace-level video dimensions from an aspect ratio. */
function videoDimsFromRatio(ratio: AspectRatio): '1280x720' | '720x1280' | '1080x1080' {
  if (ratio === '9:16' || ratio === '3:4' || ratio === '9:21') return '720x1280';
  if (ratio === '16:9' || ratio === '4:3' || ratio === '21:9') return '1280x720';
  return '1080x1080';
}

const PLATFORM_ORDER = ['instagram', 'tiktok', 'youtube_shorts', 'youtube', 'twitter', 'linkedin'];

/**
 * Given a parsed platform_settings map, derive the three legacy workspace columns
 * that the generation pipeline and LLM prompt still rely on.
 */
function deriveFromPlatformSettings(settings: Record<string, PlatformConfig>): {
  default_platforms: string;
  default_image_size: '1024x1024' | '1024x1792' | '1792x1024';
  default_video_dimensions: '1280x720' | '720x1280' | '1080x1080';
} {
  const enabled = PLATFORM_ORDER.filter((id) => settings[id]?.enabled);
  // Primary = first enabled platform in canonical order
  const primary = enabled[0];
  const primaryRatio: AspectRatio = primary ? (settings[primary]?.aspectRatio ?? '9:16') : '9:16';
  return {
    default_platforms: JSON.stringify(enabled),
    default_image_size: imageSizeFromRatio(primaryRatio),
    default_video_dimensions: videoDimsFromRatio(primaryRatio),
  };
}

// ─── Zod schema ───────────────────────────────────────────────────────────────

const UpdateWorkspaceSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  ai_tone: z.enum(['professional', 'casual', 'witty', 'formal', 'inspirational']).optional(),
  default_caption_style: z.enum(['short', 'medium', 'long']).optional(),
  avatar_url: z.string().url().optional().nullable(),
  // Brand context
  brand_name: z.string().max(120).optional().nullable(),
  brand_description: z.string().max(500).optional().nullable(),
  brand_voice: z.string().max(500).optional().nullable(),
  target_audience: z.string().max(300).optional().nullable(),
  agent_instructions: z.string().max(2000).optional().nullable(),
  // Per-platform settings (replaces default_platforms / sizes)
  platform_settings: z.string().optional(), // stringified JSON
  // Duration settings (remain independent of platform)
  default_video_duration: z.number().int().min(1).max(300).optional(),
  target_video_length: z.number().int().min(10).max(600).optional(),
  // Locked character
  character_name: z.string().max(120).optional().nullable(),
  character_appearance: z.string().max(2000).optional().nullable(),
  character_reference_ids: z.array(z.string().uuid()).max(8).optional(),
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
    if ('avatar_url' in parsed.data) update.avatar_url = parsed.data.avatar_url;
    // Brand context (nullable fields)
    if ('brand_name' in parsed.data) update.brand_name = parsed.data.brand_name ?? null;
    if ('brand_description' in parsed.data) update.brand_description = parsed.data.brand_description ?? null;
    if ('brand_voice' in parsed.data) update.brand_voice = parsed.data.brand_voice ?? null;
    if ('target_audience' in parsed.data) update.target_audience = parsed.data.target_audience ?? null;
    if ('agent_instructions' in parsed.data) update.agent_instructions = parsed.data.agent_instructions ?? null;
    // Per-platform settings — save raw JSON and derive legacy columns automatically
    if (parsed.data.platform_settings) {
      try {
        const settings = JSON.parse(parsed.data.platform_settings) as Record<string, PlatformConfig>;
        update.platform_settings = parsed.data.platform_settings;
        const derived = deriveFromPlatformSettings(settings);
        update.default_platforms = derived.default_platforms;
        update.default_image_size = derived.default_image_size;
        update.default_video_dimensions = derived.default_video_dimensions;
      } catch {
        return c.json<TfResponse<null>>({ success: false, message: 'platform_settings must be valid JSON' }, 400);
      }
    }
    // Duration settings
    if (parsed.data.default_video_duration) update.default_video_duration = parsed.data.default_video_duration;
    if (parsed.data.target_video_length) update.target_video_length = parsed.data.target_video_length;
    // Locked character
    if ('character_name' in parsed.data) update.character_name = parsed.data.character_name ?? null;
    if ('character_appearance' in parsed.data) update.character_appearance = parsed.data.character_appearance ?? null;
    if ('character_reference_ids' in parsed.data) update.character_reference_ids = JSON.stringify(parsed.data.character_reference_ids ?? []);

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
