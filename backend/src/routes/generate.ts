import { Hono } from 'hono';
import { authMiddleware, workspaceMiddleware } from '../middleware/auth';
import { getThread, createAsset, updateAsset, getAsset, getAssetsByWorkspace, getWorkspaceUploadsByIds, updateWorkspaceUploadVisionDescription } from '../db/queries';
import type { CloudflareBindings } from '../env';
import type { ContextVariables, TfResponse, Asset } from '../types';
import { Logger } from '../utils/Logger';
import { withPublicUrl, uploadFromUrl } from '../services/r2';
import { kvRateLimiter } from '../middleware/rateLimiter';
import { analyzeImageForDescription } from '../services/openai';
import { calcImageCost, calcVideoClipCost, calcLtxChainCost } from '../services/costs';
import { characterBlock } from '../services/prompts';
import {
  coerceImageModel, coerceImageSize, coerceGenerationMode,
  coerceVideoModel, snapDuration, I2V_MODELS,
} from '../services/generationConfig';

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
      referenceUploadId?: string;      // legacy single reference
      referenceUploadIds?: string[];   // draft references (preferred)
      generationMode?: 'edit' | 'inspire';
      includeCharacter?: boolean;
    };
    if (!body.threadId || !body.prompt) {
      return c.json<TfResponse<null>>({ success: false, message: 'threadId and prompt are required' }, 400);
    }

    const thread = await getThread(c.env.DB, body.threadId);
    if (!thread || thread.workspace_id !== workspace.id) {
      return c.json<TfResponse<null>>({ success: false, message: 'Thread not found' }, 404);
    }

    // Validate/coerce the requested settings. These may have been chosen by the
    // agent (they ride in from the draft package via the frontend) or overridden
    // by the user — snap anything invalid back to a safe default and log why.
    const rawSize = body.size ?? workspace.default_image_size ?? '1024x1024';
    const sizeC = coerceImageSize(rawSize);
    const modelC = coerceImageModel(body.imageModel);
    const imageSize = sizeC.value;
    const imageModel = modelC.value;
    const includeCharacter = body.includeCharacter ?? true;
    if (sizeC.warning || modelC.warning) {
      Logger.log('ImageParamCoerced', { workspaceId: workspace.id, threadId: body.threadId, size: sizeC.warning, model: modelC.warning });
    }

    const assetId = crypto.randomUUID();
    await createAsset(c.env.DB, {
      id: assetId,
      thread_id: body.threadId,
      workspace_id: workspace.id,
      type: 'image',
      message_id: body.messageId,
      prompt: body.prompt,
      model: imageModel,
      cost_usd: calcImageCost(imageModel, imageSize),
    });

    // Write initial KV status
    await c.env.KV.put(
      `asset:status:${assetId}`,
      JSON.stringify({ status: 'generating' }),
      { expirationTtl: 60 * 60 * 24 }
    );

    // ── Resolve reference images (character pixels + draft references) ──────────
    // gpt-image-2 accepts up to 16 input images on /edits and can composite them
    // (e.g. drop the locked character into an uploaded scene). We combine:
    //   • ALL workspace character reference images (when "include character" is on)
    //   • the draft's own reference uploads
    // Draft refs in "edit" mode are sent as pixels; in "inspire" mode they are
    // folded into the prompt as a text description instead — the character images
    // still go as pixels either way, so identity is preserved.
    const modeC = coerceGenerationMode(body.generationMode);
    const mode = modeC.value;
    if (modeC.warning) {
      Logger.log('ImageParamCoerced', { workspaceId: workspace.id, threadId: body.threadId, mode: modeC.warning });
    }
    const pixelImageUrls: string[] = [];
    const imageRoles: string[] = []; // parallel to pixelImageUrls — drives the compositing preamble
    let referenceVisionDescription: string | undefined;

    // 1. Character reference images → always pixels (identity lock)
    if (includeCharacter && workspace.character_reference_ids) {
      try {
        const charRefIds: string[] = JSON.parse(workspace.character_reference_ids);
        if (charRefIds.length > 0) {
          const charUploads = await getWorkspaceUploadsByIds(c.env.DB, charRefIds, workspace.id);
          for (const u of charUploads.results) {
            pixelImageUrls.push(u.public_url);
            imageRoles.push('the locked character — reproduce this exact person/subject, keeping their appearance identical');
          }
        }
      } catch { /* malformed JSON — ignore */ }
    }

    // 2. Draft reference uploads (edit → pixels, inspire → text description)
    const draftRefIds = body.referenceUploadIds?.length
      ? body.referenceUploadIds
      : (body.referenceUploadId ? [body.referenceUploadId] : []);
    if (draftRefIds.length > 0) {
      const uploads = await getWorkspaceUploadsByIds(c.env.DB, draftRefIds, workspace.id);
      for (const u of uploads.results) {
        if (mode === 'inspire') {
          let desc: string | undefined = u.vision_description ?? undefined;
          if (!desc) {
            try {
              desc = await analyzeImageForDescription({ apiKey: c.env.OPENAI_API_KEY, imageUrl: u.public_url });
              await updateWorkspaceUploadVisionDescription(c.env.DB, u.id, desc);
            } catch (err) {
              Logger.log('VisionAnalysisError', { uploadId: u.id }, err);
            }
          }
          if (desc) referenceVisionDescription = referenceVisionDescription ? `${referenceVisionDescription}\n\n${desc}` : desc;
        } else {
          pixelImageUrls.push(u.public_url);
          imageRoles.push('a scene/style reference — use it for setting, composition, and styling');
        }
      }
    }

    // gpt-image-2 accepts up to 16 input images.
    const referenceImageUrls = pixelImageUrls.slice(0, 16);
    const referenceRoles = imageRoles.slice(0, referenceImageUrls.length);

    // ── Build the final prompt ─────────────────────────────────────────────────
    let imagePrompt = body.prompt;
    // Locked-character appearance text (complements the character image pixels).
    if (includeCharacter) {
      const charBlock = characterBlock(workspace);
      if (charBlock) imagePrompt = `${charBlock}\n\n${imagePrompt}`;
    }
    // Multi-image compositing guidance: name each image by index and role so the
    // model knows how to combine them (per OpenAI's multi-image prompting guidance).
    if (referenceImageUrls.length > 1) {
      const manifest = referenceRoles.map((role, i) => `Image ${i + 1} is ${role}.`).join('\n');
      imagePrompt = `You are given ${referenceImageUrls.length} reference images.\n${manifest}\nCompose a single new image as described below — combine the references rather than copying any one of them verbatim.\n\n${imagePrompt}`;
    }

    await c.env.GENERATION_WORKFLOW.create({
      id: assetId,
      params: {
        type: 'image',
        assetId,
        workspaceId: workspace.id,
        r2KeyPrefix: `${workspace.id}/${body.threadId}/${assetId}`,
        prompt: imagePrompt,
        size: imageSize as '1024x1024' | '1024x1792' | '1792x1024',
        imageModel,
        referenceImageUrls: referenceImageUrls.length ? referenceImageUrls : undefined,
        referenceVisionDescription,
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
      includeCharacter?: boolean;
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

    const includeCharacter = body.includeCharacter ?? true;

    // ── Resolve reference image for video generation ──────────────────────────
    // Priority: explicit upload from the draft > first character reference image
    // (the character fallback only applies when the "include character" toggle is on)
    let videoReferenceImageUrl: string | undefined;
    if (body.referenceUploadId) {
      const refUploads = await getWorkspaceUploadsByIds(c.env.DB, [body.referenceUploadId], workspace.id);
      videoReferenceImageUrl = refUploads.results[0]?.public_url;
    } else if (includeCharacter && workspace.character_reference_ids) {
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
    if (includeCharacter) {
      const charBlock = characterBlock(workspace);
      if (charBlock) videoPrompt = `${charBlock}\n\n${body.prompt}`;
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
        // Image-to-video: the starting frame MUST be passed as `first_frame`
        // (the model rejects the request with a ValueError otherwise).
        buildInput: (prompt, aspectRatio, duration, referenceImageUrl) => ({
          prompt,
          aspect_ratio: aspectRatio,
          duration,
          resolution: '720p',
          ...(referenceImageUrl && { first_frame: referenceImageUrl }),
        }),
      },
    };

    // Validate/coerce the video model. It may have been chosen by the agent (it
    // rides in from the draft package via the frontend) or overridden by the user.
    const modelC = coerceVideoModel(body.videoModel);
    const modelId = modelC.value;
    if (modelC.warning) {
      Logger.log('VideoParamCoerced', { workspaceId: workspace.id, threadId: body.threadId, model: modelC.warning });
    }
    const modelConfig = VIDEO_MODEL_CONFIGS[modelId] ?? VIDEO_MODEL_CONFIGS['lightricks/ltx-2.3-fast'];

    // Image-to-video models need a starting frame — fail fast with a clear message
    // rather than letting Replicate reject it with an opaque ValueError.
    if (I2V_MODELS.has(modelId) && !videoReferenceImageUrl) {
      return c.json<TfResponse<null>>({
        success: false,
        message: 'This image-to-video model requires a reference image. Attach one (or include the character) and generate again.',
      }, 400);
    }

    // Aspect ratio: prefer explicit body param, fall back to workspace default
    const VALID_ASPECT_RATIOS = new Set(['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', '9:21']);
    let videoAspectRatio = '9:16';
    if (body.aspectRatio && VALID_ASPECT_RATIOS.has(body.aspectRatio)) {
      videoAspectRatio = body.aspectRatio;
    } else {
      const videoDimensions = workspace.default_video_dimensions ?? '720x1280';
      const [videoWidth, videoHeight] = videoDimensions.split('x').map(Number);
      videoAspectRatio = videoWidth >= videoHeight ? '16:9' : '9:16';
    }

    // Duration: prefer explicit body param, fall back to workspace default clip length,
    // then snap to the SELECTED model's allowed set (see MODEL_VALID_DURATIONS) so we
    // never send a value Replicate will 422 on (e.g. 5s/20s to LTX Pro).
    const requestedDuration = body.duration ?? workspace.default_video_duration ?? 5;
    const durationC = snapDuration(modelId, requestedDuration);
    const videoDuration = durationC.value;
    if (durationC.warning) {
      Logger.log('VideoParamCoerced', { workspaceId: workspace.id, threadId: body.threadId, duration: durationC.warning });
    }

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
      // Both the initial clip and every extend call must use a model-valid duration
      // (LTX Pro only accepts 6/8/10 for input.duration on text/image/extend tasks).
      const requestedExtend = body.extendDuration && body.extendDuration >= 1 ? Math.round(body.extendDuration) : 10;
      const extendDuration = snapDuration(modelId, requestedExtend).value;
      const initialDuration = snapDuration(modelId, videoDuration).value;
      await createAsset(c.env.DB, {
        id: assetId,
        thread_id: body.threadId,
        workspace_id: workspace.id,
        type: 'video',
        message_id: body.messageId,
        prompt: body.prompt,
        model: modelId,
        cost_usd: calcLtxChainCost(modelId, initialDuration, chainCount, extendDuration),
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
          initialDuration,
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
      model: modelId,
      cost_usd: calcVideoClipCost(modelId, videoDuration),
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

// POST /api/workspaces/:slug/generate/assets/:assetId/recover
// Rescues a generation that succeeded on Replicate but failed to save (e.g. the
// "Too many subrequests" chain failure). Give it EITHER a Replicate predictionId
// (preferred — the Worker re-reads the fresh output URL) OR a direct sourceUrl.
// Downloads the output into R2 under the asset's canonical key and marks it ready.
generateRouter.post('/assets/:assetId/recover', async (c) => {
  const workspace = c.get('workspace');
  const assetId = c.req.param('assetId');

  try {
    const asset = await getAsset(c.env.DB, assetId);
    if (!asset || asset.workspace_id !== workspace.id) {
      return c.json<TfResponse<null>>({ success: false, message: 'Asset not found' }, 404);
    }

    const body = await c.req.json() as { predictionId?: string; sourceUrl?: string };

    // Resolve the source URL — prefer looking it up fresh from Replicate by id.
    let sourceUrl = body.sourceUrl;
    if (!sourceUrl && body.predictionId) {
      const res = await fetch(`https://api.replicate.com/v1/predictions/${body.predictionId}`, {
        headers: { Authorization: `Bearer ${c.env.REPLICATE_API_TOKEN}` },
      });
      if (!res.ok) {
        return c.json<TfResponse<null>>({ success: false, message: `Replicate lookup failed (${res.status})` }, 502);
      }
      const pred = await res.json() as { status: string; output?: string | string[] };
      if (pred.status !== 'succeeded') {
        return c.json<TfResponse<null>>({ success: false, message: `Prediction is "${pred.status}", not succeeded — nothing to recover` }, 409);
      }
      sourceUrl = Array.isArray(pred.output) ? pred.output[0] : pred.output;
    }
    if (!sourceUrl) {
      return c.json<TfResponse<null>>({ success: false, message: 'Provide a predictionId or a sourceUrl' }, 400);
    }

    // Only allow Replicate-hosted sources (avoids turning this into an open proxy).
    let host: string;
    try { host = new URL(sourceUrl).hostname; } catch { return c.json<TfResponse<null>>({ success: false, message: 'Invalid sourceUrl' }, 400); }
    const isReplicate = host === 'replicate.delivery' || host.endsWith('.replicate.delivery') || host === 'replicate.com' || host.endsWith('.replicate.com');
    if (!isReplicate) {
      return c.json<TfResponse<null>>({ success: false, message: 'sourceUrl must be a replicate.delivery URL' }, 400);
    }

    const ext = asset.type === 'video' ? 'mp4' : 'png';
    const contentType = asset.type === 'video' ? 'video/mp4' : 'image/png';
    const key = `${asset.workspace_id}/${asset.thread_id}/${asset.id}.${ext}`;

    await uploadFromUrl({ bucket: c.env.ASSETS, url: sourceUrl, key, contentType });
    await updateAsset(c.env.DB, assetId, { status: 'ready', r2_key: key, error_message: null });
    await c.env.KV.put(
      `asset:status:${assetId}`,
      JSON.stringify({ status: 'ready', r2_key: key }),
      { expirationTtl: 60 * 60 * 24 }
    );

    const updated = await getAsset(c.env.DB, assetId);
    Logger.log('AssetRecovered', { assetId, key, via: body.predictionId ? 'predictionId' : 'sourceUrl' });
    return c.json<TfResponse<Asset>>({ success: true, data: withPublicUrl(updated!, c.env.ASSETS_PUBLIC_URL) });
  } catch (error) {
    Logger.log('AssetRecoverError', { assetId }, error);
    return c.json<TfResponse<null>>({ success: false, message: 'Recovery failed' }, 500);
  }
});

export default generateRouter;
