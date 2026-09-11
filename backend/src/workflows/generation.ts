import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers';
import type { CloudflareBindings } from '../env';
import { updateAsset, upsertGenerationJob, sumSucceededJobCost } from '../db/queries';
import { generateDalleImage } from '../services/openai';
import { uploadFromUrl } from '../services/r2';
import { calcVideoClipCost } from '../services/costs';
import { VIDEO_MODEL_CONFIGS, resolveContinuePartPrompts } from '../services/generationConfig';
import type { VideoModelId } from '../services/generationConfig';
import { concatClips, extractLastFrame } from '../services/videoStitch';
import { Logger } from '../utils/Logger';
import { createPrediction, getPrediction } from '../services/replicate';
import { isMockReplicateEnabled } from '../services/mockReplicate';

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
    }
  | {
      // Long video via chunk generation + ffmpeg stitching (works with ANY model).
      //   • generate — produce chunkCount chunks then stitch. mode 'concat' (parallel,
      //     jump-cuts) or 'chain' (sequential; each chunk's last frame seeds the next i2v).
      //   • combine  — no generation; stitch the provided existing clips (sourceClipUrls).
      //   • continue — extend an existing clip: extract its last frame, generate chunkCount
      //     next part(s) as i2v, then stitch [original, ...newParts].
      type: 'video_stitch';
      assetId: string;
      workspaceId: string;
      r2KeyPrefix: string;
      op: 'generate' | 'combine' | 'continue';
      aspectRatio: '16:9' | '9:16';
      prompt?: string;
      modelSlug?: string;
      mode?: 'concat' | 'chain';
      chunkCount?: number;
      chunkDuration?: number;
      referenceImageUrl?: string;   // generate: seed for chunk 1
      sourceClipUrls?: string[];    // combine: all clips; continue: [original]
      // continue (agent-planned storyboard): one i2v prompt per part. When set, its
      // length drives the part count and each chunk uses its own prompt (falls back
      // to `prompt` for any missing entry). Omit for the single-prompt continue.
      partPrompts?: string[];
    };

const KV_TTL = 60 * 60 * 24; // 24 h — long enough to cover any polling window

function kvKey(assetId: string) {
  return `asset:status:${assetId}`;
}

async function writeKv(kv: KVNamespace, assetId: string, value: object) {
  await kv.put(kvKey(assetId), JSON.stringify(value), { expirationTtl: KV_TTL });
}

/**
 * Create a Replicate prediction via the wrapper (mock-aware) and return its ID.
 * Throws on failure so the workflow catch marks the asset as failed — same
 * behaviour as the original direct-fetch implementation.
 */
async function createReplicatePrediction(
  env: CloudflareBindings,
  workspaceId: string,
  modelSlug: string,
  input: Record<string, unknown>,
): Promise<string> {
  const result = await createPrediction(env, workspaceId, modelSlug, input);
  if (!result.ok) {
    throw new Error(`Replicate create failed: ${result.status} ${result.errorText}`);
  }
  return result.id;
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
/**
 * Mock fast-path: when the mock is enabled, sleep durations are shortened to ~2
 * seconds so mocked generations complete in seconds rather than ~90 seconds.
 */
async function waitForPrediction(
  step: WorkflowStep,
  env: CloudflareBindings,
  workspaceId: string,
  predictionId: string,
  label: string,
): Promise<{ ok: true; url: string; durationSec?: number } | { ok: false; reason: string }> {
  // Read the mock flag once — used to shorten sleep durations for fast testing.
  const isMock = await isMockReplicateEnabled(env, workspaceId);

  const MAX_CHECKS = 26; // 75s + 25×45s ≈ 20 min total polling window
  for (let i = 0; i < MAX_CHECKS; i++) {
    // Mock: short 2-second sleep so tests complete quickly.
    // Real: 75 seconds first (LTX needs ~75s+ to render), then 45-second spacing.
    const sleepDuration = isMock ? '2 seconds' : (i === 0 ? '75 seconds' : '45 seconds');
    await step.sleep(`${label}-sleep-${i}`, sleepDuration);

    const res = await step.do(`${label}-check-${i}`, async () => {
      const prediction = await getPrediction(env, workspaceId, predictionId);

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
        const pollResult = await waitForPrediction(step, this.env, p.workspaceId, p.predictionId, 'video');

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
      const env = this.env;
      const workspaceId = p.workspaceId;

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
          return createReplicatePrediction(env, workspaceId, CHAIN_MODEL, input);
        });

        const initialResult = await waitForPrediction(step, env, workspaceId, initialPredId, 'wait-initial');

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
            return createReplicatePrediction(env, workspaceId, CHAIN_MODEL, {
              task: 'extend',
              video: currentVideoUrl,
              prompt: p.prompt,
              duration: p.extendDuration,
              extend_mode: 'end',
              resolution: '1080p',
              generate_audio: true,
            });
          });

          const extendResult = await waitForPrediction(step, env, workspaceId, extendPredId, `wait-extend-${i}`);

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

    // ── Long video (chunk + ffmpeg stitch): generate / combine / continue ─────
    if (p.type === 'video_stitch') {
      const env = this.env;
      const workspaceId = p.workspaceId;

      // Reconcile the asset's billed cost to the ACTUAL cost of the parts that
      // succeeded (calcVideoClipCost per chunk, using Replicate's reported output
      // duration). A run that dies partway bills only for delivered parts — never the
      // full up-front estimate. This is the "charge whatever we're actually charged" rule.
      const reconcileCost = () => sumSucceededJobCost(this.env.DB, p.assetId);

      const failStitch = async (reason: string, ctx: Record<string, unknown> = {}) => {
        Logger.log('VideoStitchFailed', { assetId: p.assetId, op: p.op, reason, ...ctx });
        const cost_usd = await reconcileCost();
        await updateAsset(this.env.DB, p.assetId, { status: 'failed', error_message: reason, cost_usd });
        await writeKv(this.env.KV, p.assetId, { status: 'failed' });
      };

      try {
        // Resolve the per-model Replicate input builder for generate/continue.
        const config = p.modelSlug ? VIDEO_MODEL_CONFIGS[p.modelSlug as VideoModelId] : undefined;
        const chunkCount = p.chunkCount ?? 1;
        const chunkDuration = p.chunkDuration ?? 5;
        const prompt = p.prompt ?? '';
        const wsId = p.workspaceId;
        const jid = (kind: 'chunk' | 'frame' | 'concat', idx: number) => `${p.assetId}-${kind}-${idx}`;

        // Parts we intend to GENERATE (drives the progress fraction). Combine generates
        // nothing; continue reuses the original and generates the new storyboard parts.
        const resolvedParts =
          p.op === 'continue' ? resolveContinuePartPrompts(p.partPrompts, prompt, chunkCount) : [];
        const total = p.op === 'generate' ? chunkCount : p.op === 'continue' ? resolvedParts.length : 0;
        let done = 0;
        const writeProgress = (stage: string) =>
          writeKv(this.env.KV, p.assetId, { status: 'generating', done, total, stage });

        // Retry-remaining support: reuse a part whose job already succeeded so a
        // re-dispatched run regenerates only the failed/missing parts.
        const cachedOutput = (kind: 'chunk' | 'frame', idx: number) =>
          step.do(`stitch-${kind}-${idx}-check`, async () => {
            const row = await this.env.DB
              .prepare("SELECT output_url FROM generation_jobs WHERE id = ? AND status = 'succeeded'")
              .bind(jid(kind, idx)).first<{ output_url: string | null }>();
            return row?.output_url ?? null;
          });

        // Dispatch a chunk prediction (or signal reuse). Records the running job + id.
        const startChunk = async (
          idx: number, chunkPrompt: string, seedUrl: string | undefined,
        ): Promise<{ cached: string } | { predId: string }> => {
          const cached = await cachedOutput('chunk', idx);
          if (cached) return { cached };
          const predId = await step.do(`stitch-chunk-${idx}-create`, async () => {
            const id = await createReplicatePrediction(env, workspaceId, p.modelSlug!, config!.buildInput(chunkPrompt, p.aspectRatio, chunkDuration, seedUrl));
            await upsertGenerationJob(this.env.DB, {
              id: jid('chunk', idx), asset_id: p.assetId, workspace_id: wsId, kind: 'chunk', idx,
              status: 'running', prediction_id: id, model: p.modelSlug, prompt: chunkPrompt,
              duration_sec: chunkDuration, seed_url: seedUrl ?? null,
            });
            return id;
          });
          return { predId };
        };

        // Await a chunk to completion, record ACTUAL cost/duration, return its clip URL.
        const finishChunk = async (
          idx: number, marker: { cached: string } | { predId: string },
        ): Promise<string> => {
          if ('cached' in marker) { done++; await writeProgress(`part ${idx + 1}/${total} (reused)`); return marker.cached; }
          const r = await waitForPrediction(step, env, workspaceId, marker.predId, `stitch-chunk-${idx}-wait`);
          if (!r.ok) {
            await step.do(`stitch-chunk-${idx}-fail`, async () => {
              await upsertGenerationJob(this.env.DB, {
                id: jid('chunk', idx), asset_id: p.assetId, workspace_id: wsId, kind: 'chunk', idx,
                status: 'failed', error_message: r.reason,
              });
            });
            throw new Error(`part ${idx + 1}: ${r.reason}`);
          }
          const cost = calcVideoClipCost(p.modelSlug!, r.durationSec ?? chunkDuration);
          await step.do(`stitch-chunk-${idx}-done`, async () => {
            await upsertGenerationJob(this.env.DB, {
              id: jid('chunk', idx), asset_id: p.assetId, workspace_id: wsId, kind: 'chunk', idx,
              status: 'succeeded', output_url: r.url, duration_sec: r.durationSec ?? chunkDuration, cost_usd: cost,
            });
          });
          done++; await writeProgress(`part ${idx + 1}/${total}`);
          return r.url;
        };

        // Extract (or reuse) a clip's last frame, tracked as a 'frame' job.
        const ensureFrame = async (idx: number, clipUrl: string, outKey: string): Promise<string> => {
          const cached = await cachedOutput('frame', idx);
          if (cached) return cached;
          return step.do(`stitch-frame-${idx}-run`, async () => {
            await upsertGenerationJob(this.env.DB, { id: jid('frame', idx), asset_id: p.assetId, workspace_id: wsId, kind: 'frame', idx, status: 'running', seed_url: clipUrl });
            const out = (await extractLastFrame(this.env, { assetId: p.assetId, clipUrl, outKey })).publicUrl;
            await upsertGenerationJob(this.env.DB, { id: jid('frame', idx), asset_id: p.assetId, workspace_id: wsId, kind: 'frame', idx, status: 'succeeded', seed_url: clipUrl, output_url: out });
            return out;
          });
        };

        // The ordered list of clip URLs to stitch at the end.
        const clipUrls: string[] = [];

        if (p.op === 'combine') {
          // No generation — just stitch the caller-supplied clips in order.
          clipUrls.push(...(p.sourceClipUrls ?? []));
          if (clipUrls.length < 2) { await failStitch('Combine needs at least 2 clips'); return; }
        } else if (p.op === 'generate') {
          if (!p.modelSlug || !config) { await failStitch(`Unknown video model: ${p.modelSlug}`); return; }
          await writeProgress(`part 1/${total}`);
          if (p.mode === 'chain') {
            // Sequential: each chunk's last frame seeds the next chunk (image-to-video).
            let seedUrl = p.referenceImageUrl;
            for (let i = 0; i < chunkCount; i++) {
              const url = await finishChunk(i, await startChunk(i, prompt, seedUrl));
              clipUrls.push(url);
              if (i < chunkCount - 1) seedUrl = await ensureFrame(i, url, `${p.r2KeyPrefix}-frame-${i}.png`);
            }
          } else {
            // Concat: fire all predictions up front (parallel on Replicate), then await.
            // Only chunk 0 may use the seed reference image.
            const markers: ({ cached: string } | { predId: string })[] = [];
            for (let i = 0; i < chunkCount; i++) markers.push(await startChunk(i, prompt, i === 0 ? p.referenceImageUrl : undefined));
            for (let i = 0; i < chunkCount; i++) clipUrls.push(await finishChunk(i, markers[i]));
          }
        } else {
          // op === 'continue': extend an existing clip into a longer one.
          if (!p.modelSlug || !config) { await failStitch(`Unknown video model: ${p.modelSlug}`); return; }
          const original = p.sourceClipUrls?.[0];
          if (!original) { await failStitch('Continue needs a source clip'); return; }
          clipUrls.push(original);
          await writeProgress(`part 1/${total}`);
          // Frame k seeds part k: init frame (from the original) seeds part 0; the frame
          // after part i seeds part i+1.
          let seedUrl = await ensureFrame(0, original, `${p.r2KeyPrefix}-frame-init.png`);
          for (let i = 0; i < resolvedParts.length; i++) {
            const url = await finishChunk(i, await startChunk(i, resolvedParts[i], seedUrl));
            clipUrls.push(url);
            if (i < resolvedParts.length - 1) seedUrl = await ensureFrame(i + 1, url, `${p.r2KeyPrefix}-frame-c${i}.png`);
          }
        }

        // Stitch every collected clip into the final video (ffmpeg in a container),
        // tracked as a 'concat' job for observability.
        const r2Key = await step.do('stitch-clips', { retries: { limit: 1, delay: '5 seconds' } }, async () => {
          const key = `${p.r2KeyPrefix}.mp4`;
          await upsertGenerationJob(this.env.DB, { id: jid('concat', 0), asset_id: p.assetId, workspace_id: wsId, kind: 'concat', idx: 0, status: 'running', prompt: `concat ${clipUrls.length} clips` });
          await concatClips(this.env, { assetId: p.assetId, clipUrls, outKey: key, aspectRatio: p.aspectRatio });
          await upsertGenerationJob(this.env.DB, { id: jid('concat', 0), asset_id: p.assetId, workspace_id: wsId, kind: 'concat', idx: 0, status: 'succeeded', output_url: key });
          return key;
        });

        const finalCost = await reconcileCost();
        await step.do('finalize-stitch-video', async () => {
          await updateAsset(this.env.DB, p.assetId, { status: 'ready', r2_key: r2Key, cost_usd: finalCost });
          await writeKv(this.env.KV, p.assetId, { status: 'ready', r2_key: r2Key });
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        Logger.log('VideoStitchWorkflowFailed', { assetId: p.assetId, op: p.op }, err);
        const cost_usd = await reconcileCost();
        await updateAsset(this.env.DB, p.assetId, { status: 'failed', error_message: msg, cost_usd });
        await writeKv(this.env.KV, p.assetId, { status: 'failed' });
      }
    }
  }
}
