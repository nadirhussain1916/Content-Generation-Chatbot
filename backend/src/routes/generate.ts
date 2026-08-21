import { Hono } from 'hono';
import { authMiddleware, workspaceMiddleware } from '../middleware/auth';
import { getThread, createAsset, updateAsset, getAsset, getAssetsByWorkspace, getWorkspaceUploadsByIds, updateWorkspaceUploadVisionDescription } from '../db/queries';
import type { CloudflareBindings } from '../env';
import type { ContextVariables, TfResponse, Asset } from '../types';
import { Logger } from '../utils/Logger';
import { withPublicUrl } from '../services/r2';
import { kvRateLimiter } from '../middleware/rateLimiter';
import { analyzeImageForDescription } from '../services/openai';

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
    const enriched = result.results.map((a) => withPublicUrl(a, c.env.ASSETS_PUBLIC_URL));
    return c.json<TfResponse<Asset[]>>({ success: true, data: enriched });
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
      referenceUploadId?: string;
      generationMode?: 'edit' | 'inspire';
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
    // Resolve reference image if provided
    let referenceImageUrl: string | undefined;
    let referenceVisionDescription: string | undefined;
    if (body.referenceUploadId) {
      const uploads = await getWorkspaceUploadsByIds(c.env.DB, [body.referenceUploadId], workspace.id);
      const upload = uploads.results[0];
      if (upload) {
        referenceImageUrl = upload.public_url;
        if (body.generationMode === 'inspire') {
          if (upload.vision_description) {
            referenceVisionDescription = upload.vision_description;
          } else {
            try {
              referenceVisionDescription = await analyzeImageForDescription({
                apiKey: c.env.OPENAI_API_KEY,
                imageUrl: upload.public_url,
              });
              await updateWorkspaceUploadVisionDescription(c.env.DB, upload.id, referenceVisionDescription);
            } catch (err) {
              Logger.log('VisionAnalysisError', { uploadId: upload.id }, err);
            }
          }
        }
      }
    }

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
        referenceImageUrl,
        referenceVisionDescription,
        generationMode: body.generationMode,
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
      aspectRatio?: string;
      duration?: number;
      // LTX 2.3 Pro extend chaining — only honoured when videoModel is 'lightricks/ltx-2.3-pro'
      chainCount?: number;    // number of extend calls to append (1–6); 0 or absent = no chaining
      extendDuration?: number; // seconds per extend (1–20); defaults to 20
      referenceUploadId?: string;
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

    // ── Resolve reference image for video generation ──────────────────────────
    // Priority: explicit upload from the draft > first character reference image
    let videoReferenceImageUrl: string | undefined;
    if (body.referenceUploadId) {
      const refUploads = await getWorkspaceUploadsByIds(c.env.DB, [body.referenceUploadId], workspace.id);
      videoReferenceImageUrl = refUploads.results[0]?.public_url;
    } else if (workspace.character_reference_ids) {
      try {
        const charRefIds: string[] = JSON.parse(workspace.character_reference_ids);
        if (charRefIds.length > 0) {
          const charUploads = await getWorkspaceUploadsByIds(c.env.DB, [charRefIds[0]], workspace.id);
          videoReferenceImageUrl = charUploads.results[0]?.public_url;
        }
      } catch { /* malformed JSON — ignore */ }
    }

    // ── Prepend locked character block to video prompt ────────────────────────
    let videoPrompt = body.prompt;
    if (workspace.character_name || workspace.character_appearance) {
      const charBlock = [
        `CHARACTER (maintain consistent appearance throughout every scene):`,
        workspace.character_name        ? `Name: ${workspace.character_name}` : '',
        workspace.character_appearance  ? `Appearance: ${workspace.character_appearance}` : '',
      ].filter(Boolean).join('\n');
      videoPrompt = `${charBlock}\n\n${body.prompt}`;
    }

    // ── Per-model config ──────────────────────────────────────────────────────
    // Each entry defines the Replicate model slug and how to build its input.
    // The workflow just polls the prediction ID — it doesn't need to know the model.
    type VideoModelConfig = {
      slug: string;
      buildInput: (prompt: string, aspectRatio: string, duration: number, referenceImageUrl?: string) => Record<string, unknown>;
    };

    const VIDEO_MODEL_CONFIGS: Record<string, VideoModelConfig> = {
      'google/veo-2': {
        slug: 'google/veo-2',
        buildInput: (prompt, aspectRatio, duration, referenceImageUrl) => ({
          prompt,
          aspect_ratio: aspectRatio,
          duration,
          ...(referenceImageUrl && { image_url: referenceImageUrl }),
        }),
      },
      'lightricks/ltx-2.3-fast': {
        slug: 'lightricks/ltx-2.3-fast',
        buildInput: (prompt, aspectRatio, duration, referenceImageUrl) => ({
          prompt,
          aspect_ratio: aspectRatio,
          duration,
          ...(referenceImageUrl && { image: referenceImageUrl }),
        }),
      },
      'lightricks/ltx-2.3-pro': {
        slug: 'lightricks/ltx-2.3-pro',
        buildInput: (prompt, aspectRatio, duration, referenceImageUrl) => ({
          prompt,
          aspect_ratio: aspectRatio,
          duration,
          ...(referenceImageUrl && { image: referenceImageUrl }),
        }),
      },
      'bytedance/seedance-2.0': {
        slug: 'bytedance/seedance-2.0',
        buildInput: (prompt, aspectRatio, duration, referenceImageUrl) => ({
          prompt,
          aspect_ratio: aspectRatio,
          duration,
          ...(referenceImageUrl && { image: referenceImageUrl }),
        }),
      },
      'bytedance/seedance-2.0-fast': {
        slug: 'bytedance/seedance-2.0-fast',
        buildInput: (prompt, aspectRatio, duration, referenceImageUrl) => ({
          prompt,
          aspect_ratio: aspectRatio,
          duration,
          ...(referenceImageUrl && { image: referenceImageUrl }),
        }),
      },
      'wan-video/wan-2.7-t2v': {
        slug: 'wan-video/wan-2.7-t2v',
        // Text-only model — ignores referenceImageUrl
        buildInput: (prompt, aspectRatio, duration) => ({
          prompt,
          aspect_ratio: aspectRatio,
          duration,
          resolution: '720p',
        }),
      },
      'wan-video/wan-2.7-i2v': {
        slug: 'wan-video/wan-2.7-i2v',
        buildInput: (prompt, aspectRatio, duration, referenceImageUrl) => ({
          prompt,
          aspect_ratio: aspectRatio,
          duration,
          resolution: '720p',
          ...(referenceImageUrl && { image_url: referenceImageUrl }),
        }),
      },
    };

    const modelId = body.videoModel ?? 'lightricks/ltx-2.3-fast';
    const modelConfig = VIDEO_MODEL_CONFIGS[modelId] ?? VIDEO_MODEL_CONFIGS['lightricks/ltx-2.3-fast'];

    // Aspect ratio: prefer explicit body param, fall back to workspace default
    const VALID_ASPECT_RATIOS = new Set(['16:9', '9:16', '1:1', '4:3', '3:4']);
    let videoAspectRatio = '9:16';
    if (body.aspectRatio && VALID_ASPECT_RATIOS.has(body.aspectRatio)) {
      videoAspectRatio = body.aspectRatio;
    } else {
      const videoDimensions = workspace.default_video_dimensions ?? '720x1280';
      const [videoWidth, videoHeight] = videoDimensions.split('x').map(Number);
      videoAspectRatio = videoWidth >= videoHeight ? '16:9' : '9:16';
    }

    // Veo-2: 5-8 | LTX Fast: 6,8,10,12,14,16,18,20 | LTX Pro: 6,8,10
    // Seedance 2.0/Fast: 5,8,10,12,15 | Wan 2.7: 2,3,4,5,8,10,12,15
    const VALID_DURATIONS = new Set([2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 15, 16, 18, 20]);
    const videoDuration = body.duration && VALID_DURATIONS.has(body.duration) ? body.duration : 5;

    const assetId = crypto.randomUUID();
    const r2KeyPrefix = `${workspace.id}/${body.threadId}/${assetId}`;

    // ── LTX 2.3 Pro extend chain ──────────────────────────────────────────────
    // When chainCount > 0 the Workflow itself creates all Replicate predictions so
    // it can feed each output URL into the next extend call durably.
    const isLtxPro = modelId === 'lightricks/ltx-2.3-pro';
    const chainCount = isLtxPro && body.chainCount && body.chainCount >= 1
      ? Math.min(Math.round(body.chainCount), 6)
      : 0;

    if (chainCount > 0) {
      const extendDuration = body.extendDuration && body.extendDuration >= 1
        ? Math.min(Math.round(body.extendDuration), 20)
        : 20;

      await createAsset(c.env.DB, {
        id: assetId,
        thread_id: body.threadId,
        workspace_id: workspace.id,
        type: 'video',
        message_id: body.messageId,
        prompt: body.prompt,
      });

      await c.env.KV.put(
        `asset:status:${assetId}`,
        JSON.stringify({ status: 'generating' }),
        { expirationTtl: 60 * 60 * 24 }
      );

      await c.env.GENERATION_WORKFLOW.create({
        id: assetId,
        params: {
          type: 'video_chain',
          assetId,
          workspaceId: workspace.id,
          r2KeyPrefix,
          prompt: videoPrompt,
          aspectRatio: videoAspectRatio as '16:9' | '9:16',
          initialDuration: VALID_DURATIONS.has(videoDuration) ? videoDuration : 10,
          extendDuration,
          chainCount,
          referenceImageUrl: videoReferenceImageUrl,
        },
      });

      Logger.log('VideoChainDispatched', { assetId, chainCount, extendDuration, prompt: body.prompt });

      return c.json<TfResponse<{ assetId: string; status: string }>>({
        success: true,
        data: { assetId, status: 'generating' },
      }, 202);
    }

    // ── Single-clip prediction (all other models + LTX Pro without chain) ─────
    const replicateRes = await fetch(
      `https://api.replicate.com/v1/models/${modelConfig.slug}/predictions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${c.env.REPLICATE_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input: modelConfig.buildInput(videoPrompt, videoAspectRatio, videoDuration, videoReferenceImageUrl),
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

    await createAsset(c.env.DB, {
      id: assetId,
      thread_id: body.threadId,
      workspace_id: workspace.id,
      type: 'video',
      message_id: body.messageId,
      prompt: body.prompt,
      prediction_id: prediction.id,
    });

    await c.env.KV.put(
      `asset:status:${assetId}`,
      JSON.stringify({ status: 'generating' }),
      { expirationTtl: 60 * 60 * 24 }
    );

    await c.env.GENERATION_WORKFLOW.create({
      id: assetId,
      params: {
        type: 'video',
        assetId,
        workspaceId: workspace.id,
        r2KeyPrefix,
        prompt: videoPrompt,
        predictionId: prediction.id,
        aspectRatio: videoAspectRatio as '16:9' | '9:16',
        referenceImageUrl: videoReferenceImageUrl,
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
          return c.json<TfResponse<Asset>>({ success: true, data: withPublicUrl(asset, c.env.ASSETS_PUBLIC_URL) });
        }
      }
      // Still generating — return lightweight status without a D1 hit
      const asset = await getAsset(c.env.DB, assetId);
      if (!asset || asset.workspace_id !== workspace.id) {
        return c.json<TfResponse<null>>({ success: false, message: 'Asset not found' }, 404);
      }
      return c.json<TfResponse<Asset>>({ success: true, data: withPublicUrl({ ...asset, status: kvData.status as Asset['status'] }, c.env.ASSETS_PUBLIC_URL) });
    }

    // Fallback: no KV entry yet (e.g. Workflow hasn't started) — read D1
    const asset = await getAsset(c.env.DB, assetId);
    if (!asset || asset.workspace_id !== workspace.id) {
      return c.json<TfResponse<null>>({ success: false, message: 'Asset not found' }, 404);
    }
    return c.json<TfResponse<Asset>>({ success: true, data: withPublicUrl(asset, c.env.ASSETS_PUBLIC_URL) });
  } catch (error) {
    Logger.log('AssetStatusError', { assetId }, error);
    return c.json<TfResponse<null>>({ success: false, message: 'Internal server error' }, 500);
  }
});

export default generateRouter;
