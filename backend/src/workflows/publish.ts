import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers';
import type { CloudflareBindings } from '../env';
import { updatePublishRecord } from '../db/queries';
import { initVideoUpload, uploadVideoChunk, checkTikTokPublishStatus } from '../services/tiktok';
import { Logger } from '../utils/Logger';

export type PublishParams = {
  recordId: string;
  workspaceId: string;
  r2Key: string;
  accessToken: string;
  title: string;
  description: string;
};

export type PublishProgress = {
  phase: 'uploading' | 'processing' | 'published' | 'failed';
  chunksUploaded: number;
  totalChunks: number;
  percent: number;
  error?: string;
};

const PROGRESS_TTL = 60 * 60 * 24; // 24 hours

export function publishProgressKey(recordId: string) {
  return `publish:progress:${recordId}`;
}

async function writeProgress(kv: KVNamespace, recordId: string, progress: PublishProgress) {
  await kv.put(publishProgressKey(recordId), JSON.stringify(progress), { expirationTtl: PROGRESS_TTL });
}

export class PublishWorkflow extends WorkflowEntrypoint<CloudflareBindings, PublishParams> {
  async run(event: WorkflowEvent<PublishParams>, step: WorkflowStep) {
    const p = event.payload;

    try {
      // ── Step 1: Get video size from R2 metadata ──────────────────────────────
      const videoSize = await step.do('get-video-size', { retries: { limit: 2, delay: '3 seconds' } }, async () => {
        const obj = await this.env.ASSETS.head(p.r2Key);
        if (!obj) throw new Error(`R2 object not found: ${p.r2Key}`);
        return obj.size;
      });

      // ── Step 2: Init TikTok FILE_UPLOAD session ───────────────────────────────
      const uploadInfo = await step.do('init-tiktok-upload', { retries: { limit: 2, delay: '5 seconds' } }, async () => {
        return initVideoUpload({
          accessToken: p.accessToken,
          title: p.title,
          description: p.description,
          videoSize,
        });
      });

      await step.do('mark-processing', async () => {
        await Promise.all([
          updatePublishRecord(this.env.DB, p.recordId, {
            status: 'processing',
            platform_post_id: uploadInfo.publish_id,
          }),
          writeProgress(this.env.KV, p.recordId, {
            phase: 'uploading',
            chunksUploaded: 0,
            totalChunks: uploadInfo.total_chunk_count,
            percent: 0,
          }),
        ]);
      });

      // ── Step 3: Fetch from R2 and upload chunks to TikTok ────────────────────
      // ArrayBuffer is consumed within this step — not returned (not serializable).
      await step.do('upload-video', { retries: { limit: 2, delay: '10 seconds' }, timeout: '10 minutes' }, async () => {
        const obj = await this.env.ASSETS.get(p.r2Key);
        if (!obj) throw new Error(`R2 object not found: ${p.r2Key}`);
        const videoBuffer = await obj.arrayBuffer();

        const { upload_url, chunk_size, total_chunk_count } = uploadInfo;
        for (let i = 0; i < total_chunk_count; i++) {
          const start = i * chunk_size;
          const chunk = videoBuffer.slice(start, Math.min(start + chunk_size, videoSize));
          await uploadVideoChunk({
            uploadUrl: upload_url,
            chunk,
            chunkIndex: i,
            chunkSize: chunk_size,
            totalSize: videoSize,
          });
          // Write progress after each chunk — frontend can poll this
          await writeProgress(this.env.KV, p.recordId, {
            phase: 'uploading',
            chunksUploaded: i + 1,
            totalChunks: total_chunk_count,
            percent: Math.round(((i + 1) / total_chunk_count) * 80), // 0–80% for upload phase
          });
        }
      });

      // ── Step 4: Poll for TikTok publish status ────────────────────────────────
      // 36 retries × 10s = up to 6 minutes of polling
      await writeProgress(this.env.KV, p.recordId, {
        phase: 'processing',
        chunksUploaded: uploadInfo.total_chunk_count,
        totalChunks: uploadInfo.total_chunk_count,
        percent: 85, // 80–100% for TikTok processing phase
      });

      const finalStatus = await step.do('poll-status', {
        retries: { limit: 36, delay: '10 seconds', backoff: 'constant' },
        timeout: '7 minutes',
      }, async () => {
        const { status } = await checkTikTokPublishStatus({
          accessToken: p.accessToken,
          publishId: uploadInfo.publish_id,
        });
        if (status === 'PUBLISH_COMPLETE') return 'published' as const;
        if (status === 'FAILED') return 'failed' as const;
        // Still processing — throw to trigger retry with delay
        throw new Error(`TikTok publish still processing: ${status}`);
      });

      // ── Step 5: Finalize record ───────────────────────────────────────────────
      await step.do('finalize', async () => {
        await Promise.all([
          updatePublishRecord(this.env.DB, p.recordId, { status: finalStatus }),
          writeProgress(this.env.KV, p.recordId, {
            phase: finalStatus,
            chunksUploaded: uploadInfo.total_chunk_count,
            totalChunks: uploadInfo.total_chunk_count,
            percent: 100,
          }),
        ]);
      });

      Logger.log('TikTokPublishWorkflowComplete', { recordId: p.recordId, status: finalStatus });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      Logger.log('TikTokPublishWorkflowFailed', { recordId: p.recordId }, err);
      await Promise.all([
        updatePublishRecord(this.env.DB, p.recordId, { status: 'failed', error_message: msg }),
        writeProgress(this.env.KV, p.recordId, {
          phase: 'failed',
          chunksUploaded: 0,
          totalChunks: 0,
          percent: 0,
          error: msg,
        }),
      ]);
    }
  }
}
