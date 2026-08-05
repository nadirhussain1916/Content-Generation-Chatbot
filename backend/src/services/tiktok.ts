import { Logger } from '../utils/Logger';

const TIKTOK_BASE = 'https://open.tiktokapis.com/v2';

async function tiktokRequest<T>(
  endpoint: string,
  accessToken: string,
  body?: Record<string, unknown>
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000); // 30s hard timeout

  let res: Response;
  try {
    res = await fetch(`${TIKTOK_BASE}${endpoint}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify(body ?? {}),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const isAbort = err instanceof Error && err.name === 'AbortError';
    const msg = `TikTok fetch ${isAbort ? 'timed out' : 'failed'} [${endpoint}]: ${err instanceof Error ? err.message : String(err)}`;
    Logger.log('TikTokFetchError', { endpoint, isAbort }, err);
    throw new Error(msg);
  }
  clearTimeout(timer);

  const rawText = await res.text();
  Logger.log('TikTokRawResponse', { endpoint, status: res.status, body: rawText.slice(0, 500) });

  if (!res.ok) {
    throw new Error(`TikTok API HTTP ${res.status} [${endpoint}]: ${rawText.slice(0, 300)}`);
  }

  let data: T & { error?: { code: string; message: string } };
  try {
    data = JSON.parse(rawText) as T & { error?: { code: string; message: string } };
  } catch (err) {
    Logger.log('TikTokJsonParseError', { endpoint, status: res.status, body: rawText.slice(0, 300) }, err);
    throw new Error(`TikTok API returned non-JSON [${endpoint}]: ${rawText.slice(0, 300)}`);
  }

  if ((data as { error?: { code: string } }).error?.code && (data as { error: { code: string } }).error.code !== 'ok') {
    throw new Error(`TikTok API: ${(data as { error: { message: string } }).error.message}`);
  }
  return data;
}

// ─── OAuth ────────────────────────────────────────────────────────────────────

export function getTikTokOAuthUrl(params: {
  clientKey: string;
  redirectUri: string;
  state: string;
}): string {
  const p = new URLSearchParams({
    client_key: params.clientKey,
    scope: 'user.info.basic,video.upload,video.publish',
    response_type: 'code',
    redirect_uri: params.redirectUri,
    state: params.state,
  });
  return `https://www.tiktok.com/v2/auth/authorize/?${p.toString()}`;
}

export async function exchangeTikTokCode(params: {
  code: string;
  clientKey: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<{
  access_token: string;
  refresh_token: string;
  open_id: string;
  expires_in: number;
  refresh_expires_in: number;
}> {
  const body = new URLSearchParams({
    client_key: params.clientKey,
    client_secret: params.clientSecret,
    code: params.code,
    grant_type: 'authorization_code',
    redirect_uri: params.redirectUri,
  });

  const res = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const data = await res.json() as {
    access_token: string; refresh_token: string; open_id: string;
    expires_in: number; refresh_expires_in: number; error?: string; error_description?: string;
  };
  if (data.error) throw new Error(data.error_description ?? data.error);
  return data;
}

export async function refreshTikTokToken(params: {
  refreshToken: string;
  clientKey: string;
  clientSecret: string;
}): Promise<{ access_token: string; refresh_token: string; expires_in: number; refresh_expires_in: number }> {
  const body = new URLSearchParams({
    client_key: params.clientKey,
    client_secret: params.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: params.refreshToken,
  });

  const res = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const data = await res.json() as {
    access_token: string; refresh_token: string; expires_in: number; refresh_expires_in: number;
    error?: string; error_description?: string;
  };
  if (data.error) throw new Error(data.error_description ?? data.error);
  return data;
}

export async function getTikTokUserInfo(accessToken: string): Promise<{ open_id: string; display_name: string }> {
  const res = await fetch(`${TIKTOK_BASE}/user/info/?fields=open_id,display_name`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json() as { data: { user: { open_id: string; display_name: string } }; error?: { code: string; message: string } };
  if (data.error?.code && data.error.code !== 'ok') throw new Error(data.error.message);
  return data.data.user;
}

// ─── Publishing ───────────────────────────────────────────────────────────────

/**
 * PULL_FROM_URL: TikTok fetches the video from your URL.
 * Requires URL ownership verification in the TikTok developer portal.
 * Keep for future use once domain is verified.
 */
export async function initVideoUploadByUrl(params: {
  accessToken: string;
  title: string;
  description: string;
  videoUrl: string;
}): Promise<{ publish_id: string }> {
  const data = await tiktokRequest<{ data: { publish_id: string } }>(
    '/post/publish/video/init/',
    params.accessToken,
    {
      post_info: {
        title: params.title.substring(0, 150),
        description: params.description.substring(0, 2200),
        privacy_level: 'SELF_ONLY',
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
      },
      source_info: {
        source: 'PULL_FROM_URL',
        video_url: params.videoUrl,
      },
    }
  );

  Logger.log('TikTokVideoInitiatedByUrl', { publishId: data.data.publish_id });
  return { publish_id: data.data.publish_id };
}

/**
 * FILE_UPLOAD step 1: Init upload session with video size.
 * Returns publish_id, upload_url, and confirmed chunk sizing from TikTok.
 * No domain verification required.
 */
export async function initVideoUpload(params: {
  accessToken: string;
  title: string;
  description: string;
  videoSize: number;
}): Promise<{ publish_id: string; upload_url: string; chunk_size: number; total_chunk_count: number }> {
  // TikTok requires chunks between 5MB–64MB; last chunk can be smaller
  const MAX_CHUNK = 64 * 1024 * 1024; // 64MB
  const chunkSize = Math.min(params.videoSize, MAX_CHUNK);
  const totalChunks = Math.ceil(params.videoSize / chunkSize);

  const data = await tiktokRequest<{
    data: { publish_id: string; upload_url: string; chunk_size: number; total_chunk_count: number };
  }>(
    '/post/publish/video/init/',
    params.accessToken,
    {
      post_info: {
        title: params.title.substring(0, 150),
        description: params.description.substring(0, 2200),
        privacy_level: 'SELF_ONLY',
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
      },
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: params.videoSize,
        chunk_size: chunkSize,
        total_chunk_count: totalChunks,
      },
    }
  );

  Logger.log('TikTokVideoInitiatedFileUpload', { publishId: data.data.publish_id });
  return {
    publish_id: data.data.publish_id,
    upload_url: data.data.upload_url,
    chunk_size: data.data.chunk_size ?? chunkSize,
    total_chunk_count: data.data.total_chunk_count ?? totalChunks,
  };
}

/**
 * FILE_UPLOAD step 2: Upload a single chunk to TikTok's upload URL.
 * Use Content-Range header to specify byte range within the total video.
 */
export async function uploadVideoChunk(params: {
  uploadUrl: string;
  chunk: ArrayBuffer;
  chunkIndex: number;
  chunkSize: number;
  totalSize: number;
}): Promise<void> {
  const start = params.chunkIndex * params.chunkSize;
  const end = start + params.chunk.byteLength - 1;

  const res = await fetch(params.uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': String(params.chunk.byteLength),
      'Content-Range': `bytes ${start}-${end}/${params.totalSize}`,
    },
    body: params.chunk,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`TikTok chunk upload failed (${res.status}): ${text}`);
  }
}

export async function initPhotoPost(params: {
  accessToken: string;
  title: string;
  description: string;
  photoUrls: string[];
}): Promise<{ publish_id: string }> {
  const data = await tiktokRequest<{ data: { publish_id: string } }>(
    '/post/publish/content/init/',
    params.accessToken,
    {
      post_info: {
        title: params.title.substring(0, 150),
        description: params.description.substring(0, 2200),
        privacy_level: 'SELF_ONLY',
        disable_comment: false,
        auto_add_music: true,
      },
      source_info: {
        source: 'PULL_FROM_URL',
        photo_cover_index: 0,
        photo_images: params.photoUrls,
        post_mode: 'PHOTO_MODE',
        media_type: 'PHOTO',
      },
    }
  );

  return { publish_id: data.data.publish_id };
}

export async function checkTikTokPublishStatus(params: {
  accessToken: string;
  publishId: string;
}): Promise<{ status: string; publish_id: string }> {
  const data = await tiktokRequest<{ data: { status: string; publish_id: string } }>(
    '/post/publish/status/fetch/',
    params.accessToken,
    { publish_id: params.publishId }
  );
  return data.data;
}
