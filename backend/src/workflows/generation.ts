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
    }
  | {
      type: 'video';
      assetId: string;
      workspaceId: string;
      r2KeyPrefix: string;
      prompt: string;
      predictionId: string;
      aspectRatio?: '16:9' | '9:16'; // default '16:9'
    };

const KV_TTL = 60 * 60 * 24; // 24 h — long enough to cover any polling window

function kvKey(assetId: string) {
  return `asset:status:${assetId}`;
}

async function writeKv(kv: KVNamespace, assetId: string, value: object) {
  await kv.put(kvKey(assetId), JSON.stringify(value), { expirationTtl: KV_TTL });
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
          const prediction = await res.json() as {
            status: string;
            output?: string[];
            error?: string;
          };

          // Permanent terminal failures — RETURN (not throw) so no retries are triggered
          if (prediction.status === 'failed' || prediction.status === 'canceled') {
            return {
              ok: false as const,
              reason: `Replicate prediction ${prediction.status}: ${prediction.error ?? 'unknown'}`,
            };
          }

          if (prediction.status !== 'succeeded' || !prediction.output?.[0]) {
            // Non-terminal (starting / processing) — throw to trigger retry with delay
            throw new Error(`Prediction still ${prediction.status}`);
          }

          return { ok: true as const, url: prediction.output[0] };
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
  }
}
