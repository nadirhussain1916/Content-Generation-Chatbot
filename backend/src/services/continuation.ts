import type { CloudflareBindings } from '../env';
import { extractLastFrame } from './videoStitch';
import { analyzeImageForDescription } from './openai';
import { Logger } from '../utils/Logger';

const FRAME_DESC_TTL = 60 * 60 * 24 * 7; // 7 days
const frameDescKey = (assetId: string) => `continue:framedesc:${assetId}`;

/**
 * Resolve a text description of an existing video's LAST FRAME — the visual state a
 * continuation must flow out of. Cached in KV per source asset so repeat/refine agent
 * turns are instant instead of re-spinning the ffmpeg container. Best-effort: returns
 * '' if extraction or vision fails so the agent can still plan from the original prompt.
 */
export async function getContinuationFrameDescription(
  env: CloudflareBindings,
  params: { assetId: string; clipUrl: string },
): Promise<string> {
  try {
    const cached = await env.KV.get(frameDescKey(params.assetId));
    if (cached !== null) return cached;
  } catch { /* fall through to compute */ }

  try {
    const { publicUrl } = await extractLastFrame(env, {
      assetId: params.assetId,
      clipUrl: params.clipUrl,
      outKey: `continue-frames/${params.assetId}.png`,
    });
    const description = await analyzeImageForDescription({ apiKey: env.OPENAI_API_KEY, imageUrl: publicUrl });
    try {
      await env.KV.put(frameDescKey(params.assetId), description, { expirationTtl: FRAME_DESC_TTL });
    } catch { /* caching is non-fatal */ }
    return description;
  } catch (err) {
    Logger.log('ContinuationFrameDescError', { assetId: params.assetId }, err);
    return '';
  }
}
