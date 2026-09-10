import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers';
import type { CloudflareBindings } from '../env';
import { updateAsset } from '../db/queries';
import { generateDalleImage } from '../services/openai';
import { uploadFromUrl } from '../services/r2';
import { calcVideoClipCost } from '../services/costs';
import { Logger } from '../utils/Logger';

// LTX extend chains always run on this model (see createReplicatePrediction calls below).
const CHAIN_MODEL = 'lightricks/ltx-2.3-pro';

export type GenerationParams =
  | {
      type: 'image';
      assetId: string;
      workspaceId: string;
      r2KeyPrefix: string;
      prompt: string;
      size?: '1024x1024' | '1024x1792' | '1792x1024';
      imageModel?: string;
      referenceImageUrls?: string[];
      referenceVisionDescription?: string;
    }
  | {
      type: 'video';
      assetId: string;
      workspaceId: string;
      r2KeyPrefix: string;
      prompt: string;
      predictionId: string;
      aspectRatio?: '16:9' | '9:16';
      referenceImageUrl?: string;
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
      referenceImageUrl?: string;
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

/**
 * Poll a Replicate prediction to completion using HIBERNATING sleeps.
 *
 * Why not a tight `step.do` retry-loop? Cloudflare caps subrequests per Worker
 * invocation (50 on the Free plan, 1000 on Paid). A retry-based poll keeps the
 * Workflow in ONE warm invocation, so every create + poll + D1 write across a long
 * extend-chain accumulates against that single budget. We observed a 6-extend / 70s
 * chain die at the 4th extend's `create` with "Too many subrequests" — it had already
 * burned ~50 subrequests on the initial + 3 extends' creates and ~15s polls.
 *
 * `step.sleep()` puts the Workflow to sleep and lets it be evicted from memory, then
 * resumes it as a FRESH invocation — which resets the per-invocation subrequest counter.
 * By sleeping between each single-fetch check, every poll runs in its own invocation, so
 * subrequests never accumulate and the chain length is no longer bounded by the limit.
 *
 * Belt-and-suspenders: the wide first delay skips guaranteed no-op polls (LTX clips need
 * ~75s+ to render) and the 45s spacing keeps the total check count low (~1–3 per clip),
 * so we'd stay under 50 even in the unlikely event a sleep fails to reset the counter.
 */
async function waitForPrediction(
  step: WorkflowStep,
  token: string,
  predictionId: string,
  label: string,
): Promise<{ ok: true; url: string; durationSec?: number } | { ok: false; reason: string }> {
  const MAX_CHECKS = 26; // 75s + 25×45s ≈ 20 min total polling window
  for (let i = 0; i < MAX_CHECKS; i++) {
    await step.sleep(`${label}-sleep-${i}`, i === 0 ? '75 seconds' : '45 seconds');

    const res = await step.do(`${label}-check-${i}`, async () => {
      const r = await fetch(`https://api.replicate.com/v1/predictions/${predictionId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const prediction = await r.json() as {
        status: string;
        output?: string | string[];
        error?: string;
        metrics?: { video_output_duration_seconds?: number };
      };

      if (prediction.status === 'failed' || prediction.status === 'canceled') {
        return {
          state: 'failed' as const,
          reason: `Replicate prediction ${prediction.status}: ${prediction.error ?? 'unknown'}`,
        };
      }

      const outputUrl = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
      if (prediction.status === 'succeeded' && outputUrl) {
        return {
          state: 'done' as const,
          url: outputUrl,
          durationSec: prediction.metrics?.video_output_duration_seconds,
        };
      }
      return { state: 'pending' as const };
    });

    if (res.state === 'done') return { ok: true, url: res.url, durationSec: res.durationSec };
    if (res.state === 'failed') return { ok: false, reason: res.reason };
  }

  return { ok: false, reason: 'Replicate prediction timed out after ~20 minutes of polling' };
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
            referenceImageUrls: p.referenceImageUrls,
            referenceVisionDescription: p.referenceVisionDescription,
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
        // Poll Replicate with hibernating sleeps (see waitForPrediction) so a single
        // long generation can never exhaust the per-invocation subrequest budget.
        const pollResult = await waitForPrediction(step, this.env.REPLICATE_API_TOKEN, p.predictionId, 'video');

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

      try {
        // Step 1 — create and wait for the initial clip (image_to_video if reference provided)
        const initialPredId = await step.do('create-initial-prediction', async () => {
          const input: Record<string, unknown> = {
            task: p.referenceImageUrl ? 'image_to_video' : 'text_to_video',
            prompt: p.prompt,
            aspect_ratio: p.aspectRatio,
            duration: p.initialDuration,
            resolution: '1080p',
            generate_audio: true,
          };
          if (p.referenceImageUrl) {
            input['image'] = p.referenceImageUrl;
          }
          return createReplicatePrediction(token, CHAIN_MODEL, input);
        });

        const initialResult = await waitForPrediction(step, token, initialPredId, 'wait-initial');

        if (!initialResult.ok) {
          Logger.log('VideoChainInitialFailed', { assetId: p.assetId, reason: initialResult.reason });
          await updateAsset(this.env.DB, p.assetId, { status: 'failed', error_message: initialResult.reason });
          await writeKv(this.env.KV, p.assetId, { status: 'failed' });
          return;
        }

        // Track ACTUAL accrued cost as we go. LTX bills per second of output video and
        // every extend re-emits the full cumulative clip, so cost = Σ (each step's output
        // length × rate). We accrue from real metrics (falling back to configured lengths),
        // which is why the final figure exceeds a naive "final length × rate" estimate.
        let accruedCostUsd = calcVideoClipCost(CHAIN_MODEL, initialResult.durationSec ?? p.initialDuration);

        // Persist the last known-good prediction ID + accrued cost. Each LTX extend output is
        // the FULL cumulative video, so this ID always points at the most complete clip
        // generated so far — letting the Recover endpoint rescue it (with the correct cost) if
        // a later step (or the Worker's subrequest limit) kills the chain before the final upload.
        await step.do('save-initial-progress', async () => {
          await updateAsset(this.env.DB, p.assetId, { prediction_id: initialPredId, cost_usd: accruedCostUsd });
        });

        // Steps 2..N+1 — sequential extend calls, each receiving the full previous video
        let currentVideoUrl = initialResult.url;

        for (let i = 0; i < p.chainCount; i++) {
          const extendPredId = await step.do(`create-extend-${i}`, async () => {
            return createReplicatePrediction(token, CHAIN_MODEL, {
              task: 'extend',
              video: currentVideoUrl,
              prompt: p.prompt,
              duration: p.extendDuration,
              extend_mode: 'end',
              resolution: '1080p',
              generate_audio: true,
            });
          });

          const extendResult = await waitForPrediction(step, token, extendPredId, `wait-extend-${i}`);

          if (!extendResult.ok) {
            Logger.log('VideoChainExtendFailed', { assetId: p.assetId, step: i, reason: extendResult.reason });
            await updateAsset(this.env.DB, p.assetId, { status: 'failed', error_message: extendResult.reason });
            await writeKv(this.env.KV, p.assetId, { status: 'failed' });
            return;
          }

          currentVideoUrl = extendResult.url;

          // This extend's output IS the full cumulative video, so bill its whole length.
          const stepDurationSec = extendResult.durationSec ?? (p.initialDuration + (i + 1) * p.extendDuration);
          accruedCostUsd += calcVideoClipCost(CHAIN_MODEL, stepDurationSec);

          // Advance the recoverable checkpoint to this extend's output + updated real cost.
          await step.do(`save-extend-${i}-progress`, async () => {
            await updateAsset(this.env.DB, p.assetId, { prediction_id: extendPredId, cost_usd: accruedCostUsd });
          });
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
