/**
 * Mock Replicate service — superadmin-togglable per-workspace fake that
 * short-circuits all Replicate API calls and serves videos from our own R2
 * bucket so the full generation flow can be tested without spending credits.
 *
 * Resolution order for config:
 *   workspace-specific override  →  global ('*') row  →  off (default)
 *
 * The mock returns the exact Replicate prediction-object shape so it is
 * indistinguishable from the real API to downstream code.
 */

import { getAppSetting } from '../db/queries';
import { getPublicUrl } from './r2';
import {
  VIDEO_MODEL_CONFIGS,
  MODEL_VALID_DURATIONS,
  VIDEO_ASPECT_RATIOS,
  I2V_MODELS,
  referenceParamFor,
} from './generationConfig';
import type { VideoModelId } from './generationConfig';
import type { CloudflareBindings } from '../env';

// ─── Constants ────────────────────────────────────────────────────────────────

const GLOBAL_SCOPE = '*';
const MOCK_KEY = 'mock_replicate';
const KV_TTL = 60 * 60 * 24; // 24 h — matches existing asset:status:* TTL

// ─── Config types (exported for admin routes and frontend) ────────────────────

export interface MockReplicateConfig {
  enabled: boolean;
  videoUrls: string[];
}

// ─── Internal KV state ───────────────────────────────────────────────────────

interface MockPredictionEntry {
  id: string;
  modelSlug: string;
  url: string;
  durationSec: number;
  createdAt: string;
  fail?: boolean;
  failReason?: string;
}

// ─── 422 validation error shape (verified against replicate.com/docs/reference/http) ─

export interface ReplicateValidationError {
  detail: string;
  status: 422;
  title: 'Input validation failed';
  invalid_fields: Array<{
    type: 'required' | 'additional_property_not_allowed' | 'invalid';
    field: string;
    description: string;
  }>;
}

// ─── Config helpers ───────────────────────────────────────────────────────────

/** Parse a raw DB JSON string into a MockReplicateConfig, with safe defaults. */
export function parseMockReplicateConfig(raw: string | null): MockReplicateConfig {
  try {
    if (!raw) return { enabled: false, videoUrls: [] };
    const parsed = JSON.parse(raw) as Partial<MockReplicateConfig>;
    return {
      enabled: parsed.enabled === true,
      videoUrls: Array.isArray(parsed.videoUrls)
        ? parsed.videoUrls.filter((u): u is string => typeof u === 'string')
        : [],
    };
  } catch {
    return { enabled: false, videoUrls: [] };
  }
}

/**
 * Read the effective mock config for a workspace.
 * Workspace-specific override takes precedence over the global ('*') default.
 */
export async function getMockReplicateConfig(
  env: Pick<CloudflareBindings, 'DB'>,
  workspaceId: string,
): Promise<MockReplicateConfig> {
  const [wsRaw, globalRaw] = await Promise.all([
    getAppSetting(env.DB, MOCK_KEY, workspaceId),
    getAppSetting(env.DB, MOCK_KEY, GLOBAL_SCOPE),
  ]);
  if (wsRaw !== null) return parseMockReplicateConfig(wsRaw);
  if (globalRaw !== null) return parseMockReplicateConfig(globalRaw);
  return { enabled: false, videoUrls: [] };
}

/** Returns true when the mock is active for the given workspace. */
export async function isMockReplicateEnabled(
  env: Pick<CloudflareBindings, 'DB'>,
  workspaceId: string,
): Promise<boolean> {
  const config = await getMockReplicateConfig(env, workspaceId);
  return config.enabled;
}

// ─── Input validation (mirrors Replicate's own 422 logic) ────────────────────

/**
 * Validate Replicate input for a known video model and return the exact 422
 * body shape Replicate would return on invalid input, or null when valid.
 *
 * Checks performed:
 *  • Unknown/unsupported modelSlug
 *  • Missing prompt (for non-extend tasks)
 *  • Invalid duration for the model
 *  • Invalid aspect_ratio
 *  • Missing required reference-image field for i2v-only models
 *  • Malformed extend payload (task:'extend' without video)
 */
export function validateReplicateInput(
  modelSlug: string,
  input: Record<string, unknown>,
): ReplicateValidationError | null {
  const invalid_fields: ReplicateValidationError['invalid_fields'] = [];

  // Unknown model
  if (!VIDEO_MODEL_CONFIGS[modelSlug as VideoModelId]) {
    invalid_fields.push({
      type: 'invalid',
      field: 'model',
      description: `Unknown or unsupported model: ${modelSlug}`,
    });
    return buildValidationError(invalid_fields);
  }

  const task = input['task'] as string | undefined;
  const isExtend = task === 'extend';

  // Prompt is required for all non-extend tasks
  if (!isExtend && !input['prompt']) {
    invalid_fields.push({
      type: 'required',
      field: 'prompt',
      description: 'prompt is required',
    });
  }

  // Duration must be in the model's allowed set
  const duration = input['duration'];
  if (duration !== undefined) {
    const allowed = MODEL_VALID_DURATIONS[modelSlug as VideoModelId];
    if (allowed && !allowed.includes(duration as number)) {
      invalid_fields.push({
        type: 'invalid',
        field: 'duration',
        description: `duration ${duration} is not valid for ${modelSlug}. Allowed: ${allowed.join(', ')}`,
      });
    }
  }

  // aspect_ratio must be one of the known values (only check when provided)
  const aspectRatio = input['aspect_ratio'];
  if (aspectRatio !== undefined && !(VIDEO_ASPECT_RATIOS as readonly string[]).includes(aspectRatio as string)) {
    invalid_fields.push({
      type: 'invalid',
      field: 'aspect_ratio',
      description: `aspect_ratio "${aspectRatio}" is not valid. Allowed: ${VIDEO_ASPECT_RATIOS.join(', ')}`,
    });
  }

  // i2v-only models require their reference-image field (not applicable to extend tasks)
  if (!isExtend) {
    const refParam = referenceParamFor(modelSlug);
    if (refParam !== null && I2V_MODELS.has(modelSlug as VideoModelId) && !input[refParam]) {
      invalid_fields.push({
        type: 'required',
        field: refParam,
        description: `${refParam} is required for ${modelSlug} (image-to-video model)`,
      });
    }
  }

  // LTX-style extend task requires a video to extend
  if (isExtend && !input['video']) {
    invalid_fields.push({
      type: 'required',
      field: 'video',
      description: 'video is required for task: extend',
    });
  }

  return invalid_fields.length > 0 ? buildValidationError(invalid_fields) : null;
}

function buildValidationError(
  invalid_fields: ReplicateValidationError['invalid_fields'],
): ReplicateValidationError {
  const detail = invalid_fields.map((f) => `- ${f.description}`).join('\n') + '\n';
  return { detail, status: 422, title: 'Input validation failed', invalid_fields };
}

// ─── Video pool / round-robin ─────────────────────────────────────────────────

async function getVideoPool(
  env: Pick<CloudflareBindings, 'DB' | 'ASSETS_PUBLIC_URL'>,
  workspaceId: string,
  config: MockReplicateConfig,
): Promise<string[]> {
  if (config.videoUrls.length > 0) return config.videoUrls;

  // Fall back to this workspace's own ready videos
  const ws = await env.DB.prepare(
    "SELECT r2_key FROM assets WHERE workspace_id = ? AND type = 'video' AND status = 'ready' AND r2_key IS NOT NULL LIMIT 20",
  ).bind(workspaceId).all<{ r2_key: string }>();
  if (ws.results.length > 0) {
    return ws.results.map((a) => getPublicUrl(env.ASSETS_PUBLIC_URL, a.r2_key));
  }

  // Last resort: any ready video on the platform
  const any = await env.DB.prepare(
    "SELECT r2_key FROM assets WHERE type = 'video' AND status = 'ready' AND r2_key IS NOT NULL LIMIT 5",
  ).all<{ r2_key: string }>();
  return any.results.map((a) => getPublicUrl(env.ASSETS_PUBLIC_URL, a.r2_key));
}

/** Pick the next URL from the pool in round-robin order, per workspace. */
async function pickFromPool(kv: KVNamespace, workspaceId: string, pool: string[]): Promise<string> {
  if (pool.length === 0) return '';
  if (pool.length === 1) return pool[0];

  const counterKey = `mock:pred:counter:${workspaceId}`;
  const raw = await kv.get(counterKey);
  const idx = raw ? parseInt(raw, 10) : 0;
  const url = pool[idx % pool.length];
  await kv.put(counterKey, String((idx + 1) % pool.length), { expirationTtl: KV_TTL });
  return url;
}

// ─── Prediction object builder ────────────────────────────────────────────────
// Returns the exact shape that GET /v1/predictions/{id} would return (verified
// against https://replicate.com/docs/reference/http).

function buildPredictionObject(
  id: string,
  modelSlug: string,
  input: Record<string, unknown>,
  status: 'starting' | 'succeeded' | 'failed',
  output: string | null,
  error: string | null,
  durationSec: number,
  createdAt: string,
): Record<string, unknown> {
  const now = new Date().toISOString();
  const isTerminal = status === 'succeeded' || status === 'failed';
  return {
    id,
    model: modelSlug,
    version: null,
    input,
    logs: '',
    output,
    error,
    status,
    created_at: createdAt,
    started_at: status !== 'starting' ? createdAt : null,
    completed_at: isTerminal ? now : null,
    metrics: status === 'succeeded'
      ? { predict_time: durationSec, total_time: durationSec, video_output_duration_seconds: durationSec }
      : null,
    urls: {
      get: `https://api.replicate.com/v1/predictions/${id}`,
      cancel: `https://api.replicate.com/v1/predictions/${id}/cancel`,
      web: `https://replicate.com/p/${id}`,
    },
    source: 'api',
    data_removed: false,
  };
}

// ─── Public mock API ──────────────────────────────────────────────────────────

export type MockCreateResult =
  | { ok: true; prediction: Record<string, unknown> }
  | { ok: false; status: 422; errorBody: ReplicateValidationError };

/**
 * Validate input and, if valid, create a mock Replicate prediction stored in KV.
 * Returns a starting-state prediction object on success, or a 422 error body on
 * invalid input (exactly matching what real Replicate returns).
 *
 * Special pool URL sentinel: any URL matching /^FAIL(: .+)?$/i forces a failed
 * prediction on GET so you can test the prediction-time failure path.
 */
export async function mockCreatePrediction(
  env: Pick<CloudflareBindings, 'DB' | 'KV' | 'ASSETS_PUBLIC_URL'>,
  workspaceId: string,
  modelSlug: string,
  input: Record<string, unknown>,
): Promise<MockCreateResult> {
  const validationError = validateReplicateInput(modelSlug, input);
  if (validationError) {
    return { ok: false, status: 422, errorBody: validationError };
  }

  const config = await getMockReplicateConfig(env, workspaceId);
  const pool = await getVideoPool(env, workspaceId, config);
  const url = await pickFromPool(env.KV, workspaceId, pool);

  // FAIL sentinel: "FAIL" or "FAIL: <reason>"
  const failMatch = /^FAIL(?::\s*(.+))?$/i.exec(url);
  const isFail = failMatch !== null;
  const failReason = failMatch?.[1]?.trim() ?? 'Mock forced failure';

  const id = `mock_${crypto.randomUUID()}`;
  const durationSec = typeof input['duration'] === 'number' ? input['duration'] : 5;
  const createdAt = new Date().toISOString();

  const entry: MockPredictionEntry = {
    id, modelSlug, url: isFail ? '' : url, durationSec, createdAt,
    ...(isFail ? { fail: true, failReason } : {}),
  };
  await env.KV.put(`mock:pred:${id}`, JSON.stringify(entry), { expirationTtl: KV_TTL });

  return {
    ok: true,
    prediction: buildPredictionObject(id, modelSlug, input, 'starting', null, null, durationSec, createdAt),
  };
}

/**
 * Retrieve a mock prediction by its id from KV.
 * Returns null if the id is not a mock prediction (real ids have no KV entry).
 *
 * Always returns "succeeded" immediately (so the workflow only waits one 2-second
 * sleep), unless the pool entry was a FAIL sentinel.
 */
export async function mockGetPrediction(
  kv: KVNamespace,
  predictionId: string,
): Promise<Record<string, unknown> | null> {
  const raw = await kv.get(`mock:pred:${predictionId}`);
  if (!raw) return null;

  const entry = JSON.parse(raw) as MockPredictionEntry;

  if (entry.fail) {
    return buildPredictionObject(
      entry.id, entry.modelSlug, {}, 'failed',
      null, entry.failReason ?? 'Mock forced failure',
      entry.durationSec, entry.createdAt,
    );
  }

  return buildPredictionObject(
    entry.id, entry.modelSlug, {}, 'succeeded',
    entry.url, null,
    entry.durationSec, entry.createdAt,
  );
}
