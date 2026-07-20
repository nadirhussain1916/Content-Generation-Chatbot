import { Logger } from '../utils/Logger';

const TIKTOK_BASE = 'https://open.tiktokapis.com/v2';

async function tiktokRequest<T>(
  endpoint: string,
  accessToken: string,
  body?: Record<string, unknown>
): Promise<T> {
  const res = await fetch(`${TIKTOK_BASE}${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify(body ?? {}),
  });

  const data = await res.json() as T & { error?: { code: string; message: string } };
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
    scope: 'user.info.basic,video.upload,video.publish,photo.publish',
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

export async function initVideoUpload(params: {
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
        privacy_level: 'SELF_ONLY', // change to PUBLIC_TO_EVERYONE for production
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

  Logger.log('TikTokVideoInitiated', { publishId: data.data.publish_id });
  return { publish_id: data.data.publish_id };
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
