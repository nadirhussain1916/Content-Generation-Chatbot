import { Logger } from '../utils/Logger';

const GRAPH_BASE = 'https://graph.instagram.com/v22.0';

async function graphRequest<T>(
  endpoint: string,
  method: 'GET' | 'POST' = 'GET',
  body?: Record<string, unknown>
): Promise<T> {
  const url = `${GRAPH_BASE}${endpoint}`;
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json() as T & { error?: { message: string; code: number } };
  if ((data as { error?: { message: string } }).error) {
    throw new Error(`Instagram API: ${(data as { error: { message: string } }).error.message}`);
  }
  return data;
}

// ─── OAuth ────────────────────────────────────────────────────────────────────

export function getOAuthUrl(params: {
  appId: string;
  redirectUri: string;
  state: string;
}): string {
  const p = new URLSearchParams({
    client_id: params.appId,
    redirect_uri: params.redirectUri,
    scope: 'instagram_business_basic,instagram_business_content_publish,instagram_business_manage_messages',
    response_type: 'code',
    state: params.state,
  });
  return `https://www.instagram.com/oauth/authorize?${p.toString()}`;
}

export async function exchangeCodeForToken(params: {
  code: string;
  appId: string;
  appSecret: string;
  redirectUri: string;
}): Promise<{ access_token: string; user_id: string }> {
  const body = new URLSearchParams({
    client_id: params.appId,
    client_secret: params.appSecret,
    grant_type: 'authorization_code',
    redirect_uri: params.redirectUri,
    code: params.code,
  });

  const res = await fetch('https://api.instagram.com/oauth/access_token', {
    method: 'POST',
    body,
  });

  const data = await res.json() as { access_token: string; user_id: string; error_message?: string };
  if (data.error_message) throw new Error(data.error_message);
  return data;
}

export async function getLongLivedToken(params: {
  shortLivedToken: string;
  appSecret: string;
}): Promise<{ access_token: string; token_type: string; expires_in: number }> {
  const p = new URLSearchParams({
    grant_type: 'ig_exchange_token',
    client_secret: params.appSecret,
    access_token: params.shortLivedToken,
  });

  const res = await fetch(`https://graph.instagram.com/access_token?${p}`);
  const data = await res.json() as { access_token: string; token_type: string; expires_in: number; error?: { message: string } };
  if (data.error) throw new Error(data.error.message);
  return data;
}

export async function refreshLongLivedToken(params: {
  accessToken: string;
}): Promise<{ access_token: string; expires_in: number }> {
  const p = new URLSearchParams({
    grant_type: 'ig_refresh_token',
    access_token: params.accessToken,
  });

  const res = await fetch(`https://graph.instagram.com/refresh_access_token?${p}`);
  const data = await res.json() as { access_token: string; expires_in: number; error?: { message: string } };
  if (data.error) throw new Error(data.error.message);
  return data;
}

// ─── Publishing ───────────────────────────────────────────────────────────────

export async function getInstagramAccountId(accessToken: string): Promise<{ id: string; username: string }> {
  return graphRequest<{ id: string; username: string }>(
    `/me?fields=id,username&access_token=${accessToken}`
  );
}

export async function createImageContainer(params: {
  igUserId: string;
  imageUrl: string;
  caption: string;
  accessToken: string;
}): Promise<string> {
  const data = await graphRequest<{ id: string }>(
    `/${params.igUserId}/media`,
    'POST',
    {
      image_url: params.imageUrl,
      caption: params.caption,
      access_token: params.accessToken,
    }
  );
  return data.id;
}

export async function createReelsContainer(params: {
  igUserId: string;
  videoUrl: string;
  caption: string;
  coverUrl?: string;
  accessToken: string;
}): Promise<string> {
  const data = await graphRequest<{ id: string }>(
    `/${params.igUserId}/media`,
    'POST',
    {
      media_type: 'REELS',
      video_url: params.videoUrl,
      caption: params.caption,
      ...(params.coverUrl && { cover_url: params.coverUrl }),
      access_token: params.accessToken,
    }
  );
  return data.id;
}

export async function checkContainerStatus(params: {
  containerId: string;
  accessToken: string;
}): Promise<{ status_code: string; status: string }> {
  return graphRequest<{ status_code: string; status: string }>(
    `/${params.containerId}?fields=status_code,status&access_token=${params.accessToken}`
  );
}

export async function publishContainer(params: {
  igUserId: string;
  containerId: string;
  accessToken: string;
}): Promise<string> {
  const data = await graphRequest<{ id: string }>(
    `/${params.igUserId}/media_publish`,
    'POST',
    {
      creation_id: params.containerId,
      access_token: params.accessToken,
    }
  );
  return data.id;
}

/**
 * Full image publish flow: create container → wait for FINISHED → publish.
 * Returns platform_post_id.
 */
export async function publishImage(params: {
  igUserId: string;
  imageUrl: string;
  caption: string;
  accessToken: string;
}): Promise<{ platformPostId: string; containerId: string }> {
  const containerId = await createImageContainer({
    igUserId: params.igUserId,
    imageUrl: params.imageUrl,
    caption: params.caption,
    accessToken: params.accessToken,
  });

  // Poll for FINISHED status (max 30s for images)
  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise((r) => setTimeout(r, 3000));
    const { status_code } = await checkContainerStatus({ containerId, accessToken: params.accessToken });
    if (status_code === 'FINISHED') break;
    if (status_code === 'ERROR') throw new Error('Instagram container processing failed');
  }

  const platformPostId = await publishContainer({
    igUserId: params.igUserId,
    containerId,
    accessToken: params.accessToken,
  });

  Logger.log('InstagramPublished', { platformPostId, containerId });
  return { platformPostId, containerId };
}
