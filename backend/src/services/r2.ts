/**
 * Fetch a remote URL or data URL and upload to R2.
 * Returns the R2 object key.
 */
export async function uploadFromUrl(params: {
  bucket: R2Bucket;
  url: string;
  key: string;
  contentType?: string;
}): Promise<string> {
  // Handle base64 data URLs from gpt-image-1
  if (params.url.startsWith('data:')) {
    const [meta, b64] = params.url.split(',');
    const mime = meta.split(':')[1]?.split(';')[0] ?? 'image/png';
    const binary = atob(b64);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    await params.bucket.put(params.key, bytes.buffer, {
      httpMetadata: { contentType: params.contentType ?? mime },
    });
    return params.key;
  }

  const res = await fetch(params.url);
  if (!res.ok) throw new Error(`Failed to fetch remote URL: ${res.statusText}`);

  await params.bucket.put(params.key, res.body, {
    httpMetadata: { contentType: params.contentType ?? 'application/octet-stream' },
  });

  return params.key;
}

/**
 * Convert a PNG ArrayBuffer to JPEG using a simple WASM-free approach.
 * For Instagram we need JPEG — DALL-E 3 outputs PNG.
 * We re-fetch the OpenAI URL and use the Accept header trick to get JPEG... 
 * 
 * Reality: OpenAI always returns PNG. We store as PNG and let Instagram handle it
 * (Instagram accepts PNG as well). Only convert if Instagram rejects it.
 */
export async function uploadBuffer(params: {
  bucket: R2Bucket;
  buffer: ArrayBuffer;
  key: string;
  contentType: string;
}): Promise<string> {
  await params.bucket.put(params.key, params.buffer, {
    httpMetadata: { contentType: params.contentType },
  });
  return params.key;
}

export async function getPresignedUrl(params: {
  bucket: R2Bucket;
  key: string;
  expiresIn?: number;
}): Promise<string> {
  const obj = await params.bucket.get(params.key);
  if (!obj) throw new Error(`R2 object not found: ${params.key}`);

  // R2 doesn't have server-side presigned URLs in Workers (only via S3 API).
  // For MVP: make the bucket public via r2.dev subdomain and return public URL.
  // Set the public bucket URL in wrangler.jsonc vars: ASSETS_PUBLIC_URL
  throw new Error('Use ASSETS_PUBLIC_URL environment variable with r2.dev for public access');
}

export function getPublicUrl(publicBaseUrl: string, key: string): string {
  return `${publicBaseUrl.replace(/\/$/, '')}/${key}`;
}
