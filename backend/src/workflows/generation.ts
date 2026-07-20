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
        Logger.log('WorkflowImageFailed', { assetId: p.assetId }, err);
        await updateAsset(this.env.DB, p.assetId, { status: 'failed' });
        await writeKv(this.env.KV, p.assetId, { status: 'failed' });
      }
      return;
    }

    // ── Video (Replicate) ─────────────────────────────────────────────────────
    if (p.type === 'video') {
      try {
        // Poll Replicate until prediction completes — Workflow handles durable sleeping
        const videoUrl = await step.do('wait-for-video', {
          retries: { limit: 30, delay: '10 seconds', backoff: 'constant' },
          timeout: '5 minutes',
        }, async () => {
          const res = await fetch(`https://api.replicate.com/v1/predictions/${p.predictionId}`, {
            headers: { Authorization: `Bearer ${this.env.REPLICATE_API_TOKEN}` },
          });
          const prediction = await res.json() as { status: string; output?: string[] };

          if (prediction.status === 'failed') throw new Error('Replicate prediction failed');
          if (prediction.status !== 'succeeded' || !prediction.output?.[0]) {
            // Non-terminal — throw to trigger retry with delay
            throw new Error(`Prediction still ${prediction.status}`);
          }
          return prediction.output[0];
        });

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
        Logger.log('WorkflowVideoFailed', { assetId: p.assetId }, err);
        await updateAsset(this.env.DB, p.assetId, { status: 'failed' });
        await writeKv(this.env.KV, p.assetId, { status: 'failed' });
      }
    }
  }
}
