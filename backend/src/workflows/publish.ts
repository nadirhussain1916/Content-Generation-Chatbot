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

    Logger.log('PublishWorkflowStarted', { recordId: p.recordId, r2Key: p.r2Key, title: p.title });

    try {
      // ── Step 1: Get video size from R2 metadata ──────────────────────────────
      Logger.log('PublishStep1Start', { recordId: p.recordId, step: 'get-video-size' });
      const videoSize = await step.do('get-video-size', { retries: { limit: 2, delay: '3 seconds' } }, async () => {
        Logger.log('R2HeadStart', { r2Key: p.r2Key });
        const obj = await this.env.ASSETS.head(p.r2Key);
        Logger.log('R2HeadResult', { r2Key: p.r2Key, found: !!obj, size: obj?.size });
        if (!obj) throw new Error(`R2 object not found: ${p.r2Key}`);
        return obj.size;
      });
      Logger.log('PublishStep1Done', { recordId: p.recordId, videoSize });

      // ── Step 2: Init TikTok FILE_UPLOAD session ───────────────────────────────
      Logger.log('PublishStep2Start', { recordId: p.recordId, step: 'init-tiktok-upload', videoSize });
      const uploadInfo = await step.do('init-tiktok-upload', { retries: { limit: 2, delay: '5 seconds' } }, async () => {
        Logger.log('TikTokInitUploadStart', { videoSize, title: p.title });
        const result = await initVideoUpload({
          accessToken: p.accessToken,
          title: p.title,
          description: p.description,
          videoSize,
        });
        Logger.log('TikTokInitUploadDone', { publishId: result.publish_id, chunkSize: result.chunk_size, totalChunks: result.total_chunk_count });
        return result;
      });
      Logger.log('PublishStep2Done', { recordId: p.recordId, publishId: uploadInfo.publish_id });

      await step.do('mark-processing', async () => {
        Logger.log('MarkProcessingStart', { recordId: p.recordId });
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
        Logger.log('MarkProcessingDone', { recordId: p.recordId });
      });

      // ── Step 3: Fetch from R2 and upload chunks to TikTok ────────────────────
      Logger.log('PublishStep3Start', { recordId: p.recordId, step: 'upload-video', totalChunks: uploadInfo.total_chunk_count });
      await step.do('upload-video', { retries: { limit: 2, delay: '10 seconds' }, timeout: '10 minutes' }, async () => {
        Logger.log('R2GetStart', { r2Key: p.r2Key });
        const obj = await this.env.ASSETS.get(p.r2Key);
        Logger.log('R2GetResult', { r2Key: p.r2Key, found: !!obj });
        if (!obj) throw new Error(`R2 object not found: ${p.r2Key}`);

        Logger.log('ArrayBufferStart', { r2Key: p.r2Key, size: videoSize });
        const videoBuffer = await obj.arrayBuffer();
        Logger.log('ArrayBufferDone', { byteLength: videoBuffer.byteLength });

        const { upload_url, chunk_size, total_chunk_count } = uploadInfo;
        for (let i = 0; i < total_chunk_count; i++) {
          const start = i * chunk_size;
          const chunk = videoBuffer.slice(start, Math.min(start + chunk_size, videoSize));
          Logger.log('ChunkUploadStart', { chunkIndex: i, totalChunks: total_chunk_count, chunkBytes: chunk.byteLength });
          await uploadVideoChunk({
            uploadUrl: upload_url,
            chunk,
            chunkIndex: i,
            chunkSize: chunk_size,
            totalSize: videoSize,
          });
          Logger.log('ChunkUploadDone', { chunkIndex: i, totalChunks: total_chunk_count });
          await writeProgress(this.env.KV, p.recordId, {
            phase: 'uploading',
            chunksUploaded: i + 1,
            totalChunks: total_chunk_count,
            percent: Math.round(((i + 1) / total_chunk_count) * 80),
          });
        }
        Logger.log('AllChunksUploaded', { recordId: p.recordId, totalChunks: total_chunk_count });
      });
      Logger.log('PublishStep3Done', { recordId: p.recordId });

      // ── Step 4: Poll for TikTok publish status ────────────────────────────────
      Logger.log('PublishStep4Start', { recordId: p.recordId, step: 'poll-status', publishId: uploadInfo.publish_id });
      await writeProgress(this.env.KV, p.recordId, {
        phase: 'processing',
        chunksUploaded: uploadInfo.total_chunk_count,
        totalChunks: uploadInfo.total_chunk_count,
        percent: 85,
      });

      const finalStatus = await step.do('poll-status', {
        retries: { limit: 36, delay: '10 seconds', backoff: 'constant' },
        timeout: '7 minutes',
      }, async () => {
        const { status } = await checkTikTokPublishStatus({
          accessToken: p.accessToken,
          publishId: uploadInfo.publish_id,
        });
        Logger.log('TikTokPollStatus', { recordId: p.recordId, publishId: uploadInfo.publish_id, status });
        if (status === 'PUBLISH_COMPLETE') return 'published' as const;
        if (status === 'FAILED') return 'failed' as const;
        throw new Error(`TikTok publish still processing: ${status}`);
      });
      Logger.log('PublishStep4Done', { recordId: p.recordId, finalStatus });

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
      Logger.log('TikTokPublishWorkflowFailed', { recordId: p.recordId, error: msg }, err);
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
