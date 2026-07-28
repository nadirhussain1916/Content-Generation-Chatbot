import { Hono } from 'hono';
import { authMiddleware, workspaceMiddleware } from '../middleware/auth';
import { getAsset, getSocialAccount, createPublishRecord, updatePublishRecord, getPublishRecord, getPublishRecordsByWorkspace } from '../db/queries';
import { publishImage, createReelsContainer, publishContainer } from '../services/instagram';
import { initPhotoPost, checkTikTokPublishStatus } from '../services/tiktok';
import type { PublishParams, PublishProgress } from '../workflows/publish';
import { publishProgressKey } from '../workflows/publish';
import type { CloudflareBindings } from '../env';
import type { ContextVariables, TfResponse, PublishRecord } from '../types';
import { Logger } from '../utils/Logger';

type Env = { Bindings: CloudflareBindings; Variables: ContextVariables };

const publishRouter = new Hono<Env>();

publishRouter.use('*', authMiddleware);
publishRouter.use('*', workspaceMiddleware);

// Helper to build public URL from R2 key
function assetPublicUrl(env: CloudflareBindings, r2Key: string): string {
  return `${env.ASSETS_PUBLIC_URL}/${r2Key}`;
}

// POST /api/workspaces/:slug/publish/instagram
publishRouter.post('/instagram', async (c) => {
  const workspace = c.get('workspace');

  try {
    const body = await c.req.json() as { assetId: string; caption: string; hashtags?: string[] };
    if (!body.assetId || !body.caption) {
      return c.json<TfResponse<null>>({ success: false, message: 'assetId and caption are required' }, 400);
    }

    const [asset, account] = await Promise.all([
      getAsset(c.env.DB, body.assetId),
      getSocialAccount(c.env.DB, workspace.id, 'instagram'),
    ]);

    if (!asset || asset.workspace_id !== workspace.id || asset.status !== 'ready' || !asset.r2_key) {
      return c.json<TfResponse<null>>({ success: false, message: 'Asset not ready' }, 400);
    }
    if (!account) {
      return c.json<TfResponse<null>>({ success: false, message: 'Instagram account not connected' }, 400);
    }

    const recordId = crypto.randomUUID();
    const fullCaption = `${body.caption}\n\n${(body.hashtags ?? []).map((h) => `#${h}`).join(' ')}`;

    await createPublishRecord(c.env.DB, {
      id: recordId,
      workspace_id: workspace.id,
      asset_id: body.assetId,
      platform: 'instagram',
      caption: body.caption,
      hashtags: JSON.stringify(body.hashtags ?? []),
    });

    const publicUrl = assetPublicUrl(c.env, asset.r2_key);

    try {
      if (asset.type === 'image') {
        const { platformPostId, containerId } = await publishImage({
          igUserId: account.account_id,
          imageUrl: publicUrl,
          caption: fullCaption,
          accessToken: account.access_token,
        });
        await updatePublishRecord(c.env.DB, recordId, {
          status: 'published',
          platform_post_id: platformPostId,
          container_id: containerId,
        });
      } else {
        // Video — create Reels container then hand off to durable Workflow for polling
        const containerId = await createReelsContainer({
          igUserId: account.account_id,
          videoUrl: publicUrl,
          caption: fullCaption,
          accessToken: account.access_token,
        });
        await updatePublishRecord(c.env.DB, recordId, { status: 'processing', container_id: containerId });
        await c.env.PUBLISH_WORKFLOW.create({
          params: {
            platform: 'instagram',
            recordId,
            workspaceId: workspace.id,
            containerId,
            igUserId: account.account_id,
            accessToken: account.access_token,
          },
        });
      }
    } catch (publishErr) {
      const msg = publishErr instanceof Error ? publishErr.message : String(publishErr);
      await updatePublishRecord(c.env.DB, recordId, { status: 'failed', error_message: msg });
      return c.json<TfResponse<null>>({ success: false, message: `Instagram publish failed: ${msg}` }, 500);
    }

    const record = await getPublishRecord(c.env.DB, recordId);
    return c.json<TfResponse<PublishRecord>>({ success: true, data: record! });
  } catch (error) {
    Logger.log('InstagramPublishError', { workspaceId: workspace.id }, error);
    return c.json<TfResponse<null>>({ success: false, message: 'Internal server error' }, 500);
  }
});

// POST /api/workspaces/:slug/publish/tiktok
publishRouter.post('/tiktok', async (c) => {
  const workspace = c.get('workspace');

  try {
    const body = await c.req.json() as {
      assetId: string; title: string; description: string; hashtags?: string[];
    };
    if (!body.assetId || !body.title) {
      return c.json<TfResponse<null>>({ success: false, message: 'assetId and title are required' }, 400);
    }

    const [asset, account] = await Promise.all([
      getAsset(c.env.DB, body.assetId),
      getSocialAccount(c.env.DB, workspace.id, 'tiktok'),
    ]);

    if (!asset || asset.workspace_id !== workspace.id || asset.status !== 'ready' || !asset.r2_key) {
      return c.json<TfResponse<null>>({ success: false, message: 'Asset not ready' }, 400);
    }
    if (!account) {
      return c.json<TfResponse<null>>({ success: false, message: 'TikTok account not connected' }, 400);
    }

    const recordId = crypto.randomUUID();
    await createPublishRecord(c.env.DB, {
      id: recordId,
      workspace_id: workspace.id,
      asset_id: body.assetId,
      platform: 'tiktok',
      caption: body.title,
      hashtags: JSON.stringify(body.hashtags ?? []),
    });

    const publicUrl = assetPublicUrl(c.env, asset.r2_key);

    try {
      if (asset.type === 'video') {
        // Delegate to PublishWorkflow — TikTok pulls the video from our R2 public URL (PULL_FROM_URL)
        const workflowParams: PublishParams = {
          platform: 'tiktok',
          recordId,
          workspaceId: workspace.id,
          videoUrl: publicUrl,
          accessToken: account.access_token,
          title: body.title,
          description: body.description ?? '',
        };
        await c.env.PUBLISH_WORKFLOW.create({ params: workflowParams });
        await updatePublishRecord(c.env.DB, recordId, { status: 'processing' });
      } else {
        // Photo posts are fast — handle inline
        const result = await initPhotoPost({
          accessToken: account.access_token,
          title: body.title,
          description: body.description,
          photoUrls: [publicUrl],
        });
        await updatePublishRecord(c.env.DB, recordId, { status: 'processing', platform_post_id: result.publish_id });
      }
    } catch (publishErr) {
      const msg = publishErr instanceof Error ? publishErr.message : String(publishErr);
      await updatePublishRecord(c.env.DB, recordId, { status: 'failed', error_message: msg });
      return c.json<TfResponse<null>>({ success: false, message: `TikTok publish failed: ${msg}` }, 500);
    }

    const record = await getPublishRecord(c.env.DB, recordId);
    return c.json<TfResponse<PublishRecord>>({ success: true, data: record! });
  } catch (error) {
    Logger.log('TikTokPublishError', { workspaceId: workspace.id }, error);
    return c.json<TfResponse<null>>({ success: false, message: 'Internal server error' }, 500);
  }
});

// GET /api/workspaces/:slug/publish/status/:recordId — poll publish status
publishRouter.get('/status/:recordId', async (c) => {
  const workspace = c.get('workspace');
  const recordId = c.req.param('recordId');

  try {
    const record = await getPublishRecord(c.env.DB, recordId);
    if (!record || record.workspace_id !== workspace.id) {
      return c.json<TfResponse<null>>({ success: false, message: 'Record not found' }, 404);
    }

    // If TikTok post is still processing, poll TikTok
    if (record.status === 'processing' && record.platform === 'tiktok' && record.platform_post_id) {
      const account = await getSocialAccount(c.env.DB, workspace.id, 'tiktok');
      if (account) {
        try {
          const tikStatus = await checkTikTokPublishStatus({
            accessToken: account.access_token,
            publishId: record.platform_post_id,
          });
          if (tikStatus.status === 'PUBLISH_COMPLETE') {
            await updatePublishRecord(c.env.DB, recordId, { status: 'published' });
            return c.json<TfResponse<PublishRecord>>({ success: true, data: { ...record, status: 'published' } });
          } else if (tikStatus.status === 'FAILED') {
            await updatePublishRecord(c.env.DB, recordId, { status: 'failed', error_message: 'TikTok reported failure' });
            return c.json<TfResponse<PublishRecord>>({ success: true, data: { ...record, status: 'failed' } });
          }
        } catch (e) {
          Logger.log('TikTokStatusPollError', { recordId }, e);
        }
      }
    }

    // If Instagram Reels container is processing, poll Instagram
    if (record.status === 'processing' && record.platform === 'instagram' && record.container_id) {
      const account = await getSocialAccount(c.env.DB, workspace.id, 'instagram');
      if (account) {
        try {
          const { status_code, error_code } = await (await import('../services/instagram')).checkContainerStatus({
            containerId: record.container_id,
            accessToken: account.access_token,
          });
          if (status_code === 'FINISHED') {
            const postId = await publishContainer({
              igUserId: account.account_id,
              containerId: record.container_id,
              accessToken: account.access_token,
            });
            await updatePublishRecord(c.env.DB, recordId, { status: 'published', platform_post_id: postId });
            Logger.log('InstagramReelsPublished', { recordId, postId, containerId: record.container_id });
            return c.json<TfResponse<PublishRecord>>({ success: true, data: { ...record, status: 'published', platform_post_id: postId } });
          } else if (status_code === 'ERROR') {
            const errMsg = `Instagram container error${error_code ? ` (code ${error_code})` : ''}`;
            await updatePublishRecord(c.env.DB, recordId, { status: 'failed', error_message: errMsg });
            Logger.log('InstagramReelsContainerError', { recordId, containerId: record.container_id, error_code });
            return c.json<TfResponse<PublishRecord>>({ success: true, data: { ...record, status: 'failed', error_message: errMsg } });
          }
        } catch (e) {
          Logger.log('InstagramStatusPollError', { recordId }, e);
        }
      }
    }

    // Attach KV progress for TikTok video uploads (workflow-driven)
    let progress: PublishProgress | null = null;
    if (record.platform === 'tiktok') {
      const raw = await c.env.KV.get(publishProgressKey(recordId));
      if (raw) {
        try { progress = JSON.parse(raw) as PublishProgress; } catch {}
      }
    }

    return c.json<TfResponse<PublishRecord & { progress?: PublishProgress | null }>>({
      success: true,
      data: { ...record, progress },
    });
  } catch (error) {
    Logger.log('PublishStatusError', { recordId }, error);
    return c.json<TfResponse<null>>({ success: false, message: 'Internal server error' }, 500);
  }
});

// GET /api/workspaces/:slug/publish/history
publishRouter.get('/history', async (c) => {
  const workspace = c.get('workspace');
  try {
    const result = await getPublishRecordsByWorkspace(c.env.DB, workspace.id);
    return c.json<TfResponse<PublishRecord[]>>({ success: true, data: result.results });
  } catch (error) {
    Logger.log('PublishHistoryError', { workspaceId: workspace.id }, error);
    return c.json<TfResponse<null>>({ success: false, message: 'Internal server error' }, 500);
  }
});

export default publishRouter;
