import { Hono } from 'hono';
import { authMiddleware, workspaceMiddleware } from '../middleware/auth';
import { getAsset, getSocialAccount, createPublishRecord, updatePublishRecord, getPublishRecord, getPublishRecordsByWorkspace } from '../db/queries';
import { publishImage, createReelsContainer, publishContainer } from '../services/instagram';
import { initVideoUpload, initPhotoPost, checkTikTokPublishStatus } from '../services/tiktok';
import type { CloudflareBindings } from '../env';
import type { ContextVariables, TfResponse, PublishRecord } from '../types';
import { Logger } from '../utils/Logger';

type Env = { Bindings: CloudflareBindings; Variables: ContextVariables };

const publishRouter = new Hono<Env>();

publishRouter.use('*', authMiddleware);
publishRouter.use('*', workspaceMiddleware);

// Helper to build public URL from R2 key
function assetPublicUrl(env: CloudflareBindings, r2Key: string): string {
  // ASSETS_PUBLIC_URL should be your r2.dev public bucket URL
  const base = (env as CloudflareBindings & { ASSETS_PUBLIC_URL?: string }).ASSETS_PUBLIC_URL ?? '';
  return `${base}/${r2Key}`;
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
        // Video — create Reels container (async, Instagram processes it server-side)
        const containerId = await createReelsContainer({
          igUserId: account.account_id,
          videoUrl: publicUrl,
          caption: fullCaption,
          accessToken: account.access_token,
        });
        // Store containerId and mark as processing — frontend should poll status
        await updatePublishRecord(c.env.DB, recordId, { status: 'processing', container_id: containerId });
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
      let publishId: string;
      if (asset.type === 'video') {
        const result = await initVideoUpload({
          accessToken: account.access_token,
          title: body.title,
          description: body.description,
          videoUrl: publicUrl,
        });
        publishId = result.publish_id;
      } else {
        const result = await initPhotoPost({
          accessToken: account.access_token,
          title: body.title,
          description: body.description,
          photoUrls: [publicUrl],
        });
        publishId = result.publish_id;
      }

      await updatePublishRecord(c.env.DB, recordId, { status: 'processing', platform_post_id: publishId });
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
          const { status_code } = await (await import('../services/instagram')).checkContainerStatus({
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
            return c.json<TfResponse<PublishRecord>>({ success: true, data: { ...record, status: 'published', platform_post_id: postId } });
          } else if (status_code === 'ERROR') {
            await updatePublishRecord(c.env.DB, recordId, { status: 'failed', error_message: 'Instagram container processing failed' });
            return c.json<TfResponse<PublishRecord>>({ success: true, data: { ...record, status: 'failed' } });
          }
        } catch (e) {
          Logger.log('InstagramStatusPollError', { recordId }, e);
        }
      }
    }

    return c.json<TfResponse<PublishRecord>>({ success: true, data: record });
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
