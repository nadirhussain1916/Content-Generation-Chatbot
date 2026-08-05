import { Hono } from 'hono';
import { authMiddleware, workspaceMiddleware } from '../middleware/auth';
import {
  createWorkspaceUpload,
  getWorkspaceUploads,
  getWorkspaceUploadById,
  deleteWorkspaceUpload,
} from '../db/queries';
import { uploadBuffer, getPublicUrl } from '../services/r2';
import type { CloudflareBindings } from '../env';
import type { ContextVariables, TfResponse, WorkspaceUpload } from '../types';
import { Logger } from '../utils/Logger';

type Env = { Bindings: CloudflareBindings; Variables: ContextVariables };

const uploadsRouter = new Hono<Env>();

uploadsRouter.use('*', authMiddleware);
uploadsRouter.use('*', workspaceMiddleware);

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
  'image/gif', 'image/avif', 'image/heic', 'image/heif',
]);

// POST /api/workspaces/:slug/uploads
uploadsRouter.post('/uploads', async (c) => {
  const workspace = c.get('workspace');
  const userId = c.get('userId');

  try {
    const formData = await c.req.formData();
    const file = formData.get('file') as File | null;
    const threadId = formData.get('threadId') as string | null;

    if (!file) {
      return c.json<TfResponse<null>>({ success: false, message: 'No file provided' }, 400);
    }

    // Validate mime type
    const mimeType = file.type || 'application/octet-stream';
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      return c.json<TfResponse<null>>({
        success: false,
        message: `Invalid file type: ${mimeType}. Only image files are allowed.`,
      }, 400);
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return c.json<TfResponse<null>>({
        success: false,
        message: `File too large. Maximum size is 10 MB.`,
      }, 400);
    }

    // Derive extension from mime type
    const extMap: Record<string, string> = {
      'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png',
      'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif',
      'image/heic': 'heic', 'image/heif': 'heif',
    };
    const ext = extMap[mimeType] ?? 'bin';
    const uploadId = crypto.randomUUID();

    // R2 key pattern: uploads/{workspaceId}/{threadId}/{uuid}.ext  or  uploads/{workspaceId}/{uuid}.ext
    const r2Key = threadId
      ? `uploads/${workspace.id}/${threadId}/${uploadId}.${ext}`
      : `uploads/${workspace.id}/${uploadId}.${ext}`;

    const buffer = await file.arrayBuffer();
    await uploadBuffer({ bucket: c.env.ASSETS, buffer, key: r2Key, contentType: mimeType });

    const publicUrl = getPublicUrl(c.env.ASSETS_PUBLIC_URL, r2Key);

    await createWorkspaceUpload(c.env.DB, {
      id: uploadId,
      workspace_id: workspace.id,
      thread_id: threadId || null,
      uploaded_by: userId,
      name: file.name,
      r2_key: r2Key,
      public_url: publicUrl,
      mime_type: mimeType,
    });

    const upload = await getWorkspaceUploadById(c.env.DB, uploadId, workspace.id);

    return c.json<TfResponse<WorkspaceUpload>>({ success: true, data: upload! }, 201);
  } catch (error) {
    Logger.log('UploadError', { workspaceId: workspace.id }, error);
    return c.json<TfResponse<null>>({ success: false, message: 'Upload failed' }, 500);
  }
});

// GET /api/workspaces/:slug/uploads
uploadsRouter.get('/uploads', async (c) => {
  const workspace = c.get('workspace');
  try {
    const result = await getWorkspaceUploads(c.env.DB, workspace.id);
    return c.json<TfResponse<WorkspaceUpload[]>>({ success: true, data: result.results });
  } catch (error) {
    Logger.log('ListUploadsError', { workspaceId: workspace.id }, error);
    return c.json<TfResponse<null>>({ success: false, message: 'Failed to list uploads' }, 500);
  }
});

// DELETE /api/workspaces/:slug/uploads/:uploadId
uploadsRouter.delete('/uploads/:uploadId', async (c) => {
  const workspace = c.get('workspace');
  const uploadId = c.req.param('uploadId');

  try {
    const upload = await getWorkspaceUploadById(c.env.DB, uploadId, workspace.id);
    if (!upload) {
      return c.json<TfResponse<null>>({ success: false, message: 'Upload not found' }, 404);
    }

    // Delete from R2
    await c.env.ASSETS.delete(upload.r2_key);

    // Delete from DB
    await deleteWorkspaceUpload(c.env.DB, uploadId, workspace.id);

    return c.json<TfResponse<null>>({ success: true, message: 'Upload deleted' });
  } catch (error) {
    Logger.log('DeleteUploadError', { workspaceId: workspace.id, uploadId }, error);
    return c.json<TfResponse<null>>({ success: false, message: 'Failed to delete upload' }, 500);
  }
});

export default uploadsRouter;
