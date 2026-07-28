import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers';
import type { CloudflareBindings } from '../env';
import { updateAsset } from '../db/queries';
import { generateDalleImage } from '../services/openai';
import { uploadFromUrl } from '../services/r2';
import { Logger } from '../utils/Logger';

export type GenerationParams =
  | {
      type: 'image';
      assetId: string;
      workspaceId: string;
      r2KeyPrefix: string;
      prompt: string;
      size?: '1024x1024' | '1024x1792' | '1792x1024';
      imageModel?: string;
    }
  | {
      type: 'video';
      assetId: string;
      workspaceId: string;
      r2KeyPrefix: string;
      prompt: string;
      predictionId: string;
      aspectRatio?: '16:9' | '9:16';
    }
  | {
      // LTX 2.3 Pro extend chaining — generates an initial clip then extends it N times.
      // Each extend call receives the full previous video and appends extendDuration seconds.
      // The final output is a single coherent video with near-seamless continuity.
      type: 'video_chain';
      assetId: string;
      workspaceId: string;
      r2KeyPrefix: string;
      prompt: string;
      aspectRatio: '16:9' | '9:16';
      initialDuration: number;  // 6, 8, or 10 — LTX Pro initial clip length
      extendDuration: number;   // seconds to add per extend call (max 20)
      chainCount: number;       // number of extend calls after the initial clip (1–6)
    };

const KV_TTL = 60 * 60 * 24; // 24 h — long enough to cover any polling window

function kvKey(assetId: string) {
  return `asset:status:${assetId}`;
}

async function writeKv(kv: KVNamespace, assetId: string, value: object) {
  await kv.put(kvKey(assetId), JSON.stringify(value), { expirationTtl: KV_TTL });
}

// Create a Replicate prediction and return its ID.
async function createReplicatePrediction(
  token: string,
  modelSlug: string,
  input: Record<string, unknown>
): Promise<string> {
  const res = await fetch(`https://api.replicate.com/v1/models/${modelSlug}/predictions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ input }),
  });
  if (!res.ok) throw new Error(`Replicate create failed: ${res.status} ${await res.text()}`);
  const data = await res.json() as { id: string };
  return data.id;
}

export class GenerationWorkflow extends WorkflowEntrypoint<CloudflareBindings, GenerationParams> {
  async run(event: WorkflowEvent<GenerationParams>, step: WorkflowStep) {
    const p = event.payload;

    // ── Image ─────────────────────────────────────────────────────────────────
    if (p.type === 'image') {
      try {
        const imageUrl = await step.do('generate-image', { retries: { limit: 2, delay: '5 seconds' } }, async () => {
          return generateDalleImage({
            apiKey: this.env.OPENAI_API_KEY,
            prompt: p.prompt,
            size: p.size,
            imageModel: p.imageModel,
          });
        });

        const r2Key = await step.do('upload-image', { retries: { limit: 2, delay: '3 seconds' } }, async () => {
          const key = `${p.r2KeyPrefix}.png`;
          await uploadFromUrl({ bucket: this.env.ASSETS, url: imageUrl, key, contentType: 'image/png' });
          return key;
        });

        await step.do('finalize-image', async () => {
          await updateAsset(this.env.DB, p.assetId, { status: 'ready', r2_key: r2Key });
          await writeKv(this.env.KV, p.assetId, { status: 'ready', r2_key: r2Key });
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        Logger.log('WorkflowImageFailed', { assetId: p.assetId }, err);
        await updateAsset(this.env.DB, p.assetId, { status: 'failed', error_message: msg });
        await writeKv(this.env.KV, p.assetId, { status: 'failed' });
      }
      return;
    }

    // ── Video (Replicate) ─────────────────────────────────────────────────────
    if (p.type === 'video') {
      try {
        // Poll Replicate until prediction completes — Workflow handles durable sleeping.
        // Returns { ok: true; url: string } on success, { ok: false; reason: string } on
        // permanent failure — returning (not throwing) avoids triggering further retries.
        const pollResult = await step.do('wait-for-video', {
          // 60 retries × 15 s = up to 15 minutes of polling (covers slow cold starts)
          retries: { limit: 60, delay: '15 seconds', backoff: 'constant' },
          timeout: '20 minutes',
        }, async () => {
          const res = await fetch(`https://api.replicate.com/v1/predictions/${p.predictionId}`, {
            headers: { Authorization: `Bearer ${this.env.REPLICATE_API_TOKEN}` },
          });
          // minimax/video-01 returns output as a string URL; some models return string[]
          const prediction = await res.json() as {
            status: string;
            output?: string | string[];
            error?: string;
          };

          // Permanent terminal failures — RETURN (not throw) so no retries are triggered
          if (prediction.status === 'failed' || prediction.status === 'canceled') {
            return {
              ok: false as const,
              reason: `Replicate prediction ${prediction.status}: ${prediction.error ?? 'unknown'}`,
            };
          }

          const outputUrl = Array.isArray(prediction.output)
            ? prediction.output[0]
            : prediction.output;

          if (prediction.status !== 'succeeded' || !outputUrl) {
            // Non-terminal (starting / processing) — throw to trigger retry with delay
            throw new Error(`Prediction still ${prediction.status}`);
          }

          return { ok: true as const, url: outputUrl };
        });

        // Handle permanent failure from Replicate
        if (!pollResult.ok) {
          Logger.log('ReplicatePredictionFailed', { assetId: p.assetId, reason: pollResult.reason });
          await updateAsset(this.env.DB, p.assetId, { status: 'failed', error_message: pollResult.reason });
          await writeKv(this.env.KV, p.assetId, { status: 'failed' });
          return;
        }

        const videoUrl = pollResult.url;

        const r2Key = await step.do('upload-video', { retries: { limit: 2, delay: '5 seconds' } }, async () => {
          const key = `${p.r2KeyPrefix}.mp4`;
          await uploadFromUrl({ bucket: this.env.ASSETS, url: videoUrl, key, contentType: 'video/mp4' });
          return key;
        });

        await step.do('finalize-video', async () => {
          await updateAsset(this.env.DB, p.assetId, { status: 'ready', r2_key: r2Key });
          await writeKv(this.env.KV, p.assetId, { status: 'ready', r2_key: r2Key });
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        Logger.log('WorkflowVideoFailed', { assetId: p.assetId }, err);
        await updateAsset(this.env.DB, p.assetId, { status: 'failed', error_message: msg });
        await writeKv(this.env.KV, p.assetId, { status: 'failed' });
      }
    }

    // ── LTX 2.3 Pro extend chaining ───────────────────────────────────────────
    if (p.type === 'video_chain') {
      const token = this.env.REPLICATE_API_TOKEN;

      // Shared poll helper — throws on non-terminal status so step.do retries it.
      // Returns the output URL on success, returns { ok: false } on permanent failure.
      const pollPrediction = async (predictionId: string): Promise<{ ok: true; url: string } | { ok: false; reason: string }> => {
        const res = await fetch(`https://api.replicate.com/v1/predictions/${predictionId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const prediction = await res.json() as { status: string; output?: string | string[]; error?: string };

        if (prediction.status === 'failed' || prediction.status === 'canceled') {
          return { ok: false, reason: `Prediction ${prediction.status}: ${prediction.error ?? 'unknown'}` };
        }

        const outputUrl = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
        if (prediction.status !== 'succeeded' || !outputUrl) {
          throw new Error(`Prediction still ${prediction.status}`);
        }
        return { ok: true, url: outputUrl };
      };

      try {
        // Step 1 — create and wait for the initial text_to_video clip
        const initialPredId = await step.do('create-initial-prediction', async () => {
          return createReplicatePrediction(token, 'lightricks/ltx-2.3-pro', {
            task: 'text_to_video',
            prompt: p.prompt,
            aspect_ratio: p.aspectRatio,
            duration: p.initialDuration,
            resolution: '1080p',
            generate_audio: true,
          });
        });

        const initialResult = await step.do('wait-for-initial', {
          retries: { limit: 60, delay: '15 seconds', backoff: 'constant' },
          timeout: '20 minutes',
        }, () => pollPrediction(initialPredId));

        if (!initialResult.ok) {
          Logger.log('VideoChainInitialFailed', { assetId: p.assetId, reason: initialResult.reason });
          await updateAsset(this.env.DB, p.assetId, { status: 'failed', error_message: initialResult.reason });
          await writeKv(this.env.KV, p.assetId, { status: 'failed' });
          return;
        }

        // Steps 2..N+1 — sequential extend calls, each receiving the full previous video
        let currentVideoUrl = initialResult.url;

        for (let i = 0; i < p.chainCount; i++) {
          const extendPredId = await step.do(`create-extend-${i}`, async () => {
            return createReplicatePrediction(token, 'lightricks/ltx-2.3-pro', {
              task: 'extend',
              video: currentVideoUrl,
              prompt: p.prompt,
              duration: p.extendDuration,
              extend_mode: 'end',
              resolution: '1080p',
              generate_audio: true,
            });
          });

          const extendResult = await step.do(`wait-for-extend-${i}`, {
            retries: { limit: 60, delay: '15 seconds', backoff: 'constant' },
            timeout: '20 minutes',
          }, () => pollPrediction(extendPredId));

          if (!extendResult.ok) {
            Logger.log('VideoChainExtendFailed', { assetId: p.assetId, step: i, reason: extendResult.reason });
            await updateAsset(this.env.DB, p.assetId, { status: 'failed', error_message: extendResult.reason });
            await writeKv(this.env.KV, p.assetId, { status: 'failed' });
            return;
          }

          currentVideoUrl = extendResult.url;
        }

        // Upload final (fully extended) video to R2
        const r2Key = await step.do('upload-chain-video', { retries: { limit: 2, delay: '5 seconds' } }, async () => {
          const key = `${p.r2KeyPrefix}.mp4`;
          await uploadFromUrl({ bucket: this.env.ASSETS, url: currentVideoUrl, key, contentType: 'video/mp4' });
          return key;
        });

        await step.do('finalize-chain-video', async () => {
          await updateAsset(this.env.DB, p.assetId, { status: 'ready', r2_key: r2Key });
          await writeKv(this.env.KV, p.assetId, { status: 'ready', r2_key: r2Key });
        });

      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        Logger.log('VideoChainFailed', { assetId: p.assetId }, err);
        await updateAsset(this.env.DB, p.assetId, { status: 'failed', error_message: msg });
        await writeKv(this.env.KV, p.assetId, { status: 'failed' });
      }
    }
  }
}
