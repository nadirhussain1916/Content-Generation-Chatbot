import { Hono } from 'hono';
import { authMiddleware, workspaceMiddleware } from '../middleware/auth';
import { getThread, createAsset, updateAsset, getAsset, getAssetsByWorkspace } from '../db/queries';
import type { CloudflareBindings } from '../env';
import type { ContextVariables, TfResponse, Asset } from '../types';
import { Logger } from '../utils/Logger';
import { kvRateLimiter } from '../middleware/rateLimiter';

type Env = { Bindings: CloudflareBindings; Variables: ContextVariables };

const generateRouter = new Hono<Env>();

generateRouter.use('*', authMiddleware);
generateRouter.use('*', workspaceMiddleware);
// generateRouter.use('/image', kvRateLimiter({ windowMs: 60 * 1000, limit: 5, message: 'Max 5 image generations per minute' }));
// generateRouter.use('/video', kvRateLimiter({ windowMs: 60 * 1000, limit: 3, message: 'Max 3 video generations per minute' }));

// GET /api/workspaces/:slug/generate/assets — list all ready assets for workspace
generateRouter.get('/assets', async (c) => {
  const workspace = c.get('workspace');
  try {
    const result = await getAssetsByWorkspace(c.env.DB, workspace.id);
    return c.json<TfResponse<Asset[]>>({ success: true, data: result.results });
  } catch (error) {
    Logger.log('ListAssetsError', { workspaceId: workspace.id }, error);
    return c.json<TfResponse<null>>({ success: false, message: 'Internal server error' }, 500);
  }
});

// POST /api/workspaces/:slug/generate/image
generateRouter.post('/image', async (c) => {
  const workspace = c.get('workspace');

  try {
    const body = await c.req.json() as {
      threadId: string; prompt: string; messageId?: string;
      size?: '1024x1024' | '1024x1792' | '1792x1024';
      imageModel?: string;
    };
    if (!body.threadId || !body.prompt) {
      return c.json<TfResponse<null>>({ success: false, message: 'threadId and prompt are required' }, 400);
    }

    const thread = await getThread(c.env.DB, body.threadId);
    if (!thread || thread.workspace_id !== workspace.id) {
      return c.json<TfResponse<null>>({ success: false, message: 'Thread not found' }, 404);
    }

    // Use explicit size from request, then workspace default, then global default
    const imageSize = body.size ?? workspace.default_image_size ?? '1024x1024';

    const assetId = crypto.randomUUID();
    await createAsset(c.env.DB, {
      id: assetId,
      thread_id: body.threadId,
      workspace_id: workspace.id,
      type: 'image',
      message_id: body.messageId,
      prompt: body.prompt,
    });

    // Write initial KV status
    await c.env.KV.put(
      `asset:status:${assetId}`,
      JSON.stringify({ status: 'generating' }),
      { expirationTtl: 60 * 60 * 24 }
    );

    // Trigger Workflow — durable, retriable, no 30 s CPU limit
    await c.env.GENERATION_WORKFLOW.create({
      id: assetId,
      params: {
        type: 'image',
        assetId,
        workspaceId: workspace.id,
        r2KeyPrefix: `${workspace.id}/${body.threadId}/${assetId}`,
        prompt: body.prompt,
        size: imageSize as '1024x1024' | '1024x1792' | '1792x1024',
        imageModel: body.imageModel,
      },
    });

    return c.json<TfResponse<{ assetId: string; status: string }>>({
      success: true,
      data: { assetId, status: 'generating' },
    }, 202);
  } catch (error) {
    Logger.log('ImageGenerationError', { workspaceId: workspace.id }, error);
    return c.json<TfResponse<null>>({ success: false, message: 'Image generation failed' }, 500);
  }
});

// POST /api/workspaces/:slug/generate/video
generateRouter.post('/video', async (c) => {
  const workspace = c.get('workspace');

  try {
    const body = await c.req.json() as {
      threadId: string;
      prompt: string;
      messageId?: string;
      videoModel?: string;
    };
    if (!body.threadId || !body.prompt) {
      return c.json<TfResponse<null>>({ success: false, message: 'threadId and prompt are required' }, 400);
    }

    const thread = await getThread(c.env.DB, body.threadId);
    if (!thread || thread.workspace_id !== workspace.id) {
      return c.json<TfResponse<null>>({ success: false, message: 'Thread not found' }, 404);
    }

    if (!c.env.REPLICATE_API_TOKEN) {
      return c.json<TfResponse<null>>({ success: false, message: 'Video generation is not configured' }, 501);
    }

    // ── Per-model config ──────────────────────────────────────────────────────
    // Each entry defines the Replicate model slug and how to build its input.
    // The workflow just polls the prediction ID — it doesn't need to know the model.
    type VideoModelConfig = {
      slug: string;
      buildInput: (prompt: string, aspectRatio: string) => Record<string, unknown>;
    };

    const VIDEO_MODEL_CONFIGS: Record<string, VideoModelConfig> = {
      'minimax/video-01': {
        slug: 'minimax/video-01',
        buildInput: (prompt) => ({
          prompt,
          prompt_optimizer: true,
        }),
      },
      'wavespeedai/wan-2.1-t2v-480p': {
        slug: 'wavespeedai/wan-2.1-t2v-480p',
        buildInput: (prompt, aspectRatio) => ({
          prompt,
          aspect_ratio: aspectRatio,
          disable_safety_checker: true,
          negative_prompt: 'nsfw, nude, explicit, adult, sexual, violence, gore, disturbing',
        }),
      },
      'wavespeedai/wan-2.1-t2v-720p': {
        slug: 'wavespeedai/wan-2.1-t2v-720p',
        buildInput: (prompt, aspectRatio) => ({
          prompt,
          aspect_ratio: aspectRatio,
          disable_safety_checker: true,
          negative_prompt: 'nsfw, nude, explicit, adult, sexual, violence, gore, disturbing',
        }),
      },
    };

    const modelId = body.videoModel ?? 'minimax/video-01';
    const modelConfig = VIDEO_MODEL_CONFIGS[modelId] ?? VIDEO_MODEL_CONFIGS['minimax/video-01'];

    // Resolve aspect ratio from workspace defaults (used by WAN models)
    const videoDimensions = workspace.default_video_dimensions ?? '1280x720';
    const [videoWidth, videoHeight] = videoDimensions.split('x').map(Number);
    const videoAspectRatio = videoWidth >= videoHeight ? '16:9' : '9:16';

    // Create the Replicate prediction — no Prefer:wait=5 to avoid Workers connection issues.
    // The Workflow handles all polling durably.
    const replicateRes = await fetch(
      `https://api.replicate.com/v1/models/${modelConfig.slug}/predictions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${c.env.REPLICATE_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input: modelConfig.buildInput(body.prompt, videoAspectRatio),
        }),
      }
    );

    if (!replicateRes.ok) {
      const errText = await replicateRes.text();
      Logger.log('ReplicateCreateFailed', { workspaceId: workspace.id, status: replicateRes.status, body: errText });
      return c.json<TfResponse<null>>({ success: false, message: `Replicate rejected prediction (${replicateRes.status}): ${errText}` }, 502);
    }

    const prediction = await replicateRes.json() as { id: string; status: string; error?: string };

    if (!prediction.id) {
      Logger.log('ReplicateCreateFailed', { workspaceId: workspace.id, error: prediction.error });
      return c.json<TfResponse<null>>({ success: false, message: `Failed to create Replicate prediction: ${prediction.error ?? 'unknown'}` }, 502);
    }

    Logger.log('ReplicatePredictionCreated', { predictionId: prediction.id, prompt: body.prompt });

    const assetId = crypto.randomUUID();
    await createAsset(c.env.DB, {
      id: assetId,
      thread_id: body.threadId,
      workspace_id: workspace.id,
      type: 'video',
      message_id: body.messageId,
      prompt: body.prompt,       // store original user prompt
      prediction_id: prediction.id,
    });

    // Write initial KV status
    await c.env.KV.put(
      `asset:status:${assetId}`,
      JSON.stringify({ status: 'generating' }),
      { expirationTtl: 60 * 60 * 24 }
    );

    // Trigger Workflow — handles polling Replicate + uploading to R2 durably
    await c.env.GENERATION_WORKFLOW.create({
      id: assetId,
        params: {
        type: 'video',
        assetId,
        workspaceId: workspace.id,
        r2KeyPrefix: `${workspace.id}/${body.threadId}/${assetId}`,
        prompt: body.prompt,
        predictionId: prediction.id,
        aspectRatio: videoAspectRatio,
      },
    });

    return c.json<TfResponse<{ assetId: string; status: string }>>({
      success: true,
      data: { assetId, status: 'generating' },
    }, 202);
  } catch (error) {
    Logger.log('VideoGenerationError', { workspaceId: workspace.id }, error);
    return c.json<TfResponse<null>>({ success: false, message: 'Video generation failed' }, 500);
  }
});

// GET /api/workspaces/:slug/generate/assets/:assetId/file — stream R2 object
generateRouter.get('/assets/:assetId/file', async (c) => {
  const workspace = c.get('workspace');
  const assetId = c.req.param('assetId');

  try {
    const asset = await getAsset(c.env.DB, assetId);
    if (!asset || asset.workspace_id !== workspace.id) {
      return c.json<TfResponse<null>>({ success: false, message: 'Asset not found' }, 404);
    }
    if (asset.status !== 'ready' || !asset.r2_key) {
      return c.json<TfResponse<null>>({ success: false, message: 'Asset not ready' }, 425);
    }

    const object = await c.env.ASSETS.get(asset.r2_key);
    if (!object) {
      return c.json<TfResponse<null>>({ success: false, message: 'File not found in storage' }, 404);
    }

    const contentType = asset.type === 'video' ? 'video/mp4' : 'image/png';
    return new Response(object.body, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (error) {
    Logger.log('AssetFileError', { assetId }, error);
    return c.json<TfResponse<null>>({ success: false, message: 'Internal server error' }, 500);
  }
});

// GET /api/workspaces/:slug/generate/assets/:assetId/status
// Reads KV first (fast), falls back to D1 — Workflow writes both on completion
generateRouter.get('/assets/:assetId/status', async (c) => {
  const workspace = c.get('workspace');
  const assetId = c.req.param('assetId');

  try {
    // Fast path: KV has the latest status written by the Workflow
    const kvRaw = await c.env.KV.get(`asset:status:${assetId}`);
    if (kvRaw) {
      const kvData = JSON.parse(kvRaw) as { status: string; r2_key?: string };
      if (kvData.status === 'ready' || kvData.status === 'failed') {
        // Fetch full asset from D1 for a complete response
        const asset = await getAsset(c.env.DB, assetId);
        if (asset && asset.workspace_id === workspace.id) {
          return c.json<TfResponse<Asset>>({ success: true, data: asset });
        }
      }
      // Still generating — return lightweight status without a D1 hit
      const asset = await getAsset(c.env.DB, assetId);
      if (!asset || asset.workspace_id !== workspace.id) {
        return c.json<TfResponse<null>>({ success: false, message: 'Asset not found' }, 404);
      }
      return c.json<TfResponse<Asset>>({ success: true, data: { ...asset, status: kvData.status as Asset['status'] } });
    }

    // Fallback: no KV entry yet (e.g. Workflow hasn't started) — read D1
    const asset = await getAsset(c.env.DB, assetId);
    if (!asset || asset.workspace_id !== workspace.id) {
      return c.json<TfResponse<null>>({ success: false, message: 'Asset not found' }, 404);
    }
    return c.json<TfResponse<Asset>>({ success: true, data: asset });
  } catch (error) {
    Logger.log('AssetStatusError', { assetId }, error);
    return c.json<TfResponse<null>>({ success: false, message: 'Internal server error' }, 500);
  }
});

export default generateRouter;
