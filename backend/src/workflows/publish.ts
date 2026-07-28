import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers';
import type { CloudflareBindings } from '../env';
import { updatePublishRecord } from '../db/queries';
import { initVideoUploadByUrl, checkTikTokPublishStatus } from '../services/tiktok';
import { checkContainerStatus, publishContainer } from '../services/instagram';
import { Logger } from '../utils/Logger';

// ── Param types ───────────────────────────────────────────────────────────────

type TikTokParams = {
  platform: 'tiktok';
  recordId: string;
  workspaceId: string;
  videoUrl: string;
  accessToken: string;
  title: string;
  description: string;
};

type InstagramReelsParams = {
  platform: 'instagram';
  recordId: string;
  workspaceId: string;
  containerId: string;
  igUserId: string;
  accessToken: string;
};

export type PublishParams = TikTokParams | InstagramReelsParams;

export type PublishProgress = {
  phase: 'submitting' | 'processing' | 'published' | 'failed';
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

// ── Workflow ──────────────────────────────────────────────────────────────────

export class PublishWorkflow extends WorkflowEntrypoint<CloudflareBindings, PublishParams> {
  async run(event: WorkflowEvent<PublishParams>, step: WorkflowStep) {
    const p = event.payload;
    Logger.log('PublishWorkflowStarted', { platform: p.platform, recordId: p.recordId });

    if (p.platform === 'instagram') {
      await this.runInstagram(p, step);
    } else {
      await this.runTikTok(p, step);
    }
  }

  // ── Instagram Reels ─────────────────────────────────────────────────────────

  private async runInstagram(p: InstagramReelsParams, step: WorkflowStep) {
    try {
      await writeProgress(this.env.KV, p.recordId, { phase: 'processing', percent: 20 });

      // Poll until FINISHED — 90 retries × 10s = up to 15 minutes
      const postId = await step.do('poll-and-publish', {
        retries: { limit: 90, delay: '10 seconds', backoff: 'constant' },
        timeout: '16 minutes',
      }, async () => {
        const { status_code } = await checkContainerStatus({
          containerId: p.containerId,
          accessToken: p.accessToken,
        });
        Logger.log('InstagramContainerPoll', { recordId: p.recordId, containerId: p.containerId, status_code });

        if (status_code === 'ERROR') {
          throw new Error('Instagram container error');
        }
        if (status_code !== 'FINISHED') {
          // Not terminal — throw to trigger retry
          throw new Error(`Instagram container still processing: ${status_code}`);
        }

        // Container ready — publish immediately in the same step
        const id = await publishContainer({
          igUserId: p.igUserId,
          containerId: p.containerId,
          accessToken: p.accessToken,
        });
        Logger.log('InstagramReelsPublished', { recordId: p.recordId, postId: id, containerId: p.containerId });
        return id;
      });

      await step.do('finalize', async () => {
        await Promise.all([
          updatePublishRecord(this.env.DB, p.recordId, { status: 'published', platform_post_id: postId }),
          writeProgress(this.env.KV, p.recordId, { phase: 'published', percent: 100 }),
        ]);
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      Logger.log('InstagramReelsWorkflowFailed', { recordId: p.recordId, error: msg });
      await Promise.all([
        updatePublishRecord(this.env.DB, p.recordId, { status: 'failed', error_message: msg }),
        writeProgress(this.env.KV, p.recordId, { phase: 'failed', percent: 0, error: msg }),
      ]);
    }
  }

  // ── TikTok ──────────────────────────────────────────────────────────────────

  private async runTikTok(p: TikTokParams, step: WorkflowStep) {
    try {
      Logger.log('PublishStep1Start', { recordId: p.recordId, step: 'submit-to-tiktok' });

      const publishId = await step.do('submit-to-tiktok', { retries: { limit: 2, delay: '5 seconds' } }, async () => {
        const result = await initVideoUploadByUrl({
          accessToken: p.accessToken,
          title: p.title,
          description: p.description,
          videoUrl: p.videoUrl,
        });
        Logger.log('TikTokSubmitDone', { publishId: result.publish_id });
        return result.publish_id;
      });

      await step.do('mark-processing', async () => {
        await Promise.all([
          updatePublishRecord(this.env.DB, p.recordId, { status: 'processing', platform_post_id: publishId }),
          writeProgress(this.env.KV, p.recordId, { phase: 'processing', percent: 30 }),
        ]);
      });
      Logger.log('PublishStep1Done', { recordId: p.recordId, publishId });

      // 36 retries × 10s = up to 6 minutes of polling
      const finalStatus = await step.do('poll-status', {
        retries: { limit: 36, delay: '10 seconds', backoff: 'constant' },
        timeout: '7 minutes',
      }, async () => {
        const { status } = await checkTikTokPublishStatus({ accessToken: p.accessToken, publishId });
        Logger.log('TikTokPollStatus', { recordId: p.recordId, publishId, status });
        if (status === 'PUBLISH_COMPLETE') return 'published' as const;
        if (status === 'FAILED') return 'failed' as const;
        throw new Error(`TikTok still processing: ${status}`);
      });
      Logger.log('PublishStep2Done', { recordId: p.recordId, finalStatus });

      await step.do('finalize', async () => {
        await Promise.all([
          updatePublishRecord(this.env.DB, p.recordId, { status: finalStatus }),
          writeProgress(this.env.KV, p.recordId, { phase: finalStatus, percent: 100 }),
        ]);
      });

      Logger.log('TikTokPublishWorkflowComplete', { recordId: p.recordId, status: finalStatus });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      Logger.log('TikTokPublishWorkflowFailed', { recordId: p.recordId, error: msg }, err);
      await Promise.all([
        updatePublishRecord(this.env.DB, p.recordId, { status: 'failed', error_message: msg }),
        writeProgress(this.env.KV, p.recordId, { phase: 'failed', percent: 0, error: msg }),
      ]);
    }
  }
}
