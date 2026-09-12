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
import { VIDEO_MODEL_CONFIGS } from './generationConfig';
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

// ─── Input validation ─────────────────────────────────────────────────────────
//
// Per-model validators verified against live Replicate docs (Sep 2026).
// Each model has its own required fields, allowed enum values, duration
// constraints, and conditional rules — all handled in dedicated functions.
//
// validateReplicateInput is the public entry point. It dispatches to the
// appropriate per-model validator and returns the exact 422 body Replicate
// would return, or null when the input is valid.

type InvalidField = ReplicateValidationError['invalid_fields'][number];

// ─── Shared validation helpers ────────────────────────────────────────────────

/** Assert a required field is present and non-empty. */
function requireField(field: string, input: Record<string, unknown>, fields: InvalidField[]): void {
  if (!input[field]) {
    fields.push({ type: 'required', field, description: `${field} is required` });
  }
}

/**
 * Validate an enum field when present. Pass `required: true` to also flag absence.
 * Accepts arrays of strings OR numbers as valid values.
 */
function validateEnum<T extends string | number>(
  field: string,
  input: Record<string, unknown>,
  allowed: T[],
  required: boolean,
  fields: InvalidField[],
): void {
  const val = input[field];
  if (val === undefined) {
    if (required) fields.push({ type: 'required', field, description: `${field} is required. Allowed: ${allowed.join(', ')}` });
    return;
  }
  if (!(allowed as unknown[]).includes(val)) {
    fields.push({ type: 'invalid', field, description: `${field} "${val}" is not valid. Allowed: ${allowed.join(', ')}` });
  }
}

/** Validate duration as a discrete set of allowed integers. */
function discreteDuration(input: Record<string, unknown>, allowed: number[], fields: InvalidField[]): void {
  const dur = input['duration'];
  if (dur === undefined) return;
  if (typeof dur !== 'number' || !Number.isInteger(dur)) {
    fields.push({ type: 'invalid', field: 'duration', description: 'duration must be an integer' });
    return;
  }
  if (!allowed.includes(dur)) {
    fields.push({ type: 'invalid', field: 'duration', description: `duration ${dur}s is not valid. Allowed: ${allowed.join(', ')}s` });
  }
}

/** Validate duration as a continuous integer range [min, max]. */
function rangeDuration(input: Record<string, unknown>, min: number, max: number, fields: InvalidField[]): void {
  const dur = input['duration'];
  if (dur === undefined) return;
  if (typeof dur !== 'number' || !Number.isInteger(dur)) {
    fields.push({ type: 'invalid', field: 'duration', description: 'duration must be an integer' });
    return;
  }
  if (dur < min || dur > max) {
    fields.push({ type: 'invalid', field: 'duration', description: `duration must be an integer ${min}–${max}s; got ${dur}s` });
  }
}

/** Validate extend-task duration (seconds to add, 1–20 — different scale from clip duration). */
function extendDuration(input: Record<string, unknown>, fields: InvalidField[]): void {
  const dur = input['duration'];
  if (dur === undefined) return;
  if (typeof dur !== 'number' || !Number.isInteger(dur) || dur < 1 || dur > 20) {
    fields.push({ type: 'invalid', field: 'duration', description: 'extend duration must be an integer 1–20 (seconds to add to the existing video)' });
  }
}

// ─── LTX camera/motion shared helpers ────────────────────────────────────────

const LTX_VALID_FPS = [24, 25, 48, 50] as const;
const LTX_VALID_RESOLUTIONS = ['1080p', '2k', '4k'] as const;
const LTX_VALID_CAMERA_MOTIONS = [
  'dolly_in', 'dolly_out', 'dolly_left', 'dolly_right',
  'jib_up', 'jib_down', 'static', 'focus_shift', 'none',
] as const;

function ltxCommonOptionals(input: Record<string, unknown>, fields: InvalidField[]): void {
  validateEnum('fps', input, [...LTX_VALID_FPS], false, fields);
  validateEnum('camera_motion', input, [...LTX_VALID_CAMERA_MOTIONS], false, fields);
}

// ─── Per-model validators ─────────────────────────────────────────────────────
//
// Docs sources (Sep 2026):
//   LTX Fast  → replicate.com/lightricks/ltx-2.3-fast/readme
//   LTX Pro   → replicate.com/lightricks/ltx-2.3-pro/llms.txt
//   Veo 2     → replicate.com/google/veo-2/versions/0546b4e9…/api
//   Seedance  → replicate.com/bytedance/seedance-2.0/versions/48110609…/api
//   Wan T2V   → replicate.com/wan-video/wan-2.7-t2v/readme
//   Wan I2V   → replicate.com/wan-video/wan-2.7-i2v/readme

/**
 * lightricks/ltx-2.3-fast
 *
 * Fields:
 *   prompt (required)
 *   image (optional) — first frame for i2v; supplying it implicitly switches to i2v mode
 *   last_frame_image (optional) — end frame for interpolation; requires image
 *   duration (discrete): 6 | 8 | 10 | 12 | 14 | 16 | 18 | 20
 *     Note: durations > 10s are only available at 1080p + 24 or 25 fps
 *   aspect_ratio: 16:9 | 9:16
 *   resolution (optional): 1080p | 2k | 4k  (default 1080p)
 *   fps (optional): 24 | 25 | 48 | 50  (default 25)
 *   camera_motion (optional): dolly_in | dolly_out | dolly_left | dolly_right |
 *                              jib_up | jib_down | static | focus_shift | none
 *   generate_audio (optional): boolean
 *
 * No task field — mode is inferred from whether image is present.
 */
function validateLtxFast(input: Record<string, unknown>, fields: InvalidField[]): void {
  // LTX Fast has no `task` field at all
  if (input['task'] !== undefined) {
    fields.push({
      type: 'additional_property_not_allowed',
      field: 'task',
      description: 'lightricks/ltx-2.3-fast does not accept a task field; mode is inferred from whether image is provided',
    });
  }

  requireField('prompt', input, fields);

  discreteDuration(input, [6, 8, 10, 12, 14, 16, 18, 20], fields);

  validateEnum('aspect_ratio', input, ['16:9', '9:16'], false, fields);

  // Durations > 10s require 1080p + 24 or 25 fps
  const dur = input['duration'];
  const res = input['resolution'] as string | undefined;
  const fps = input['fps'] as number | undefined;
  if (typeof dur === 'number' && dur > 10) {
    if (res !== undefined && res !== '1080p') {
      fields.push({ type: 'invalid', field: 'resolution', description: `resolution must be 1080p when duration > 10s (got ${res})` });
    }
    if (fps !== undefined && fps !== 24 && fps !== 25) {
      fields.push({ type: 'invalid', field: 'fps', description: `fps must be 24 or 25 when duration > 10s (got ${fps})` });
    }
  }

  validateEnum('resolution', input, [...LTX_VALID_RESOLUTIONS], false, fields);
  ltxCommonOptionals(input, fields);

  // last_frame_image requires image (first frame) to be set
  if (input['last_frame_image'] && !input['image']) {
    fields.push({
      type: 'invalid',
      field: 'last_frame_image',
      description: 'last_frame_image (end frame) requires image (first frame) to also be provided',
    });
  }
}

/**
 * lightricks/ltx-2.3-pro
 *
 * Fields:
 *   task (optional, default text_to_video): text_to_video | image_to_video |
 *                                           audio_to_video | retake | extend
 *   prompt (required for all tasks)
 *   duration (discrete for generate): 6 | 8 | 10
 *              for extend: 1–20 (seconds to add, NOT clip duration)
 *   aspect_ratio: 16:9 | 9:16
 *   resolution: 1080p | 2k | 4k; forced 1080p for audio_to_video / retake / extend
 *   fps: 24 | 25 | 48 | 50
 *   camera_motion: enum
 *   generate_audio: boolean
 *
 *   image_to_video → image required; last_frame_image optional
 *   audio_to_video → audio required
 *   retake         → video required; retake_start_time, retake_duration, retake_mode
 *   extend         → video required; extend_mode (start | end)
 */
function validateLtxPro(input: Record<string, unknown>, fields: InvalidField[]): void {
  const VALID_TASKS = ['text_to_video', 'image_to_video', 'audio_to_video', 'retake', 'extend'] as const;
  const RESOLUTION_1080P_ONLY_TASKS = new Set(['audio_to_video', 'retake', 'extend']);

  const rawTask = input['task'];
  const task = (rawTask as string | undefined) ?? 'text_to_video';

  if (rawTask !== undefined && !(VALID_TASKS as readonly string[]).includes(task)) {
    fields.push({ type: 'invalid', field: 'task', description: `task must be one of: ${VALID_TASKS.join(', ')}` });
    // Return early — remaining checks depend on a known task
    return;
  }

  requireField('prompt', input, fields);

  // Resolution
  const resolution = input['resolution'] as string | undefined;
  if (resolution !== undefined) {
    if (!(LTX_VALID_RESOLUTIONS as readonly string[]).includes(resolution)) {
      fields.push({ type: 'invalid', field: 'resolution', description: `resolution must be one of: ${LTX_VALID_RESOLUTIONS.join(', ')}` });
    } else if (RESOLUTION_1080P_ONLY_TASKS.has(task) && resolution !== '1080p') {
      fields.push({ type: 'invalid', field: 'resolution', description: `resolution must be 1080p for task: ${task}` });
    }
  }

  // aspect_ratio: standard tasks only
  if (task !== 'extend' && task !== 'retake') {
    validateEnum('aspect_ratio', input, ['16:9', '9:16'], false, fields);
  }

  ltxCommonOptionals(input, fields);

  // ── Task-specific rules ──────────────────────────────────────────────────────

  if (task === 'text_to_video') {
    discreteDuration(input, [6, 8, 10], fields);
  }

  if (task === 'image_to_video') {
    discreteDuration(input, [6, 8, 10], fields);
    if (!input['image']) {
      fields.push({ type: 'required', field: 'image', description: 'image (first frame) is required for task: image_to_video' });
    }
    if (input['last_frame_image'] && !input['image']) {
      fields.push({ type: 'invalid', field: 'last_frame_image', description: 'last_frame_image requires image (first frame) to also be provided' });
    }
  }

  if (task === 'audio_to_video') {
    discreteDuration(input, [6, 8, 10], fields);
    if (!input['audio']) {
      fields.push({ type: 'required', field: 'audio', description: 'audio is required for task: audio_to_video' });
    }
  }

  if (task === 'retake') {
    if (!input['video']) {
      fields.push({ type: 'required', field: 'video', description: 'video is required for task: retake' });
    }
    validateEnum('retake_mode', input, ['replace_audio', 'replace_video', 'replace_audio_and_video'], false, fields);
    // retake_duration must be >= 2 when provided
    const retakeDuration = input['retake_duration'];
    if (retakeDuration !== undefined && (typeof retakeDuration !== 'number' || retakeDuration < 2)) {
      fields.push({ type: 'invalid', field: 'retake_duration', description: 'retake_duration must be at least 2 seconds' });
    }
  }

  if (task === 'extend') {
    if (!input['video']) {
      fields.push({ type: 'required', field: 'video', description: 'video is required for task: extend' });
    }
    validateEnum('extend_mode', input, ['start', 'end'], false, fields);
    // extend duration = seconds to add (1–20), NOT a clip duration
    extendDuration(input, fields);
  }
}

/**
 * google/veo-2
 *
 * Fields:
 *   prompt (required)
 *   image (optional) — starting frame; field name is `image`, NOT `image_url`
 *   duration (integer range): 5–8
 *   aspect_ratio: 16:9 | 9:16  (default 16:9)
 *   seed (optional): integer
 *
 * Output: single URI string (not an array).
 */
function validateVeo2(input: Record<string, unknown>, fields: InvalidField[]): void {
  requireField('prompt', input, fields);

  rangeDuration(input, 5, 8, fields);

  validateEnum('aspect_ratio', input, ['16:9', '9:16'], false, fields);

  // Catch the old wrong field name (our own past bug) before it hits the API
  if (input['image_url'] !== undefined && input['image'] === undefined) {
    fields.push({
      type: 'additional_property_not_allowed',
      field: 'image_url',
      description: 'google/veo-2 uses `image` for the reference frame, not `image_url`',
    });
  }
}

/**
 * bytedance/seedance-2.0  +  bytedance/seedance-2.0-fast  (identical schema)
 *
 * Fields:
 *   prompt (required)
 *   image (optional) — first frame for i2v
 *   last_frame (optional) — end frame
 *   reference_images (optional) — array, up to 9
 *   reference_videos (optional) — array, up to 3
 *   audio (optional) — for audio-synced generation
 *   duration (integer): 2–15, or -1 for intelligent auto-length  (default 5)
 *   resolution (optional): 480p | 720p  (default 720p)
 *   aspect_ratio: 21:9 | 16:9 | 4:3 | 1:1 | 3:4 | 9:16 | adaptive  (default 16:9)
 *   generate_audio (optional): boolean
 *   seed (optional): integer
 */
const SEEDANCE_VALID_RATIOS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16', 'adaptive'] as const;

function validateSeedance(input: Record<string, unknown>, fields: InvalidField[]): void {
  requireField('prompt', input, fields);

  // Duration: -1 = intelligent auto; otherwise 2–15
  const dur = input['duration'];
  if (dur !== undefined) {
    if (typeof dur !== 'number' || !Number.isInteger(dur)) {
      fields.push({ type: 'invalid', field: 'duration', description: 'duration must be an integer' });
    } else if (dur !== -1 && (dur < 2 || dur > 15)) {
      fields.push({ type: 'invalid', field: 'duration', description: 'duration must be an integer 2–15, or -1 for intelligent auto-length' });
    }
  }

  validateEnum('aspect_ratio', input, [...SEEDANCE_VALID_RATIOS], false, fields);
  validateEnum('resolution', input, ['480p', '720p'], false, fields);

  // reference_images: max 9
  const refImgs = input['reference_images'];
  if (Array.isArray(refImgs) && refImgs.length > 9) {
    fields.push({ type: 'invalid', field: 'reference_images', description: 'reference_images accepts at most 9 items' });
  }

  // reference_videos: max 3, total duration ≤ 15s (cannot validate duration here)
  const refVids = input['reference_videos'];
  if (Array.isArray(refVids) && refVids.length > 3) {
    fields.push({ type: 'invalid', field: 'reference_videos', description: 'reference_videos accepts at most 3 items' });
  }
}

/**
 * wan-video/wan-2.7-t2v  (text-only — no reference image)
 *
 * Fields:
 *   prompt (required)
 *   negative_prompt (optional): string
 *   audio (optional) — for audio-synced generation
 *   resolution (optional): 720p | 1080p  (default 1080p)
 *   aspect_ratio: 16:9 | 9:16 | 1:1 | 4:3 | 3:4  (default 16:9)
 *   duration (integer range): 2–15  (default 5)
 *   enable_prompt_expansion (optional): boolean
 *   seed (optional): integer
 *
 * No image/video input fields — provide them and Replicate ignores or rejects.
 */
const WAN_T2V_VALID_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4'] as const;

function validateWanT2V(input: Record<string, unknown>, fields: InvalidField[]): void {
  requireField('prompt', input, fields);

  rangeDuration(input, 2, 15, fields);

  validateEnum('aspect_ratio', input, [...WAN_T2V_VALID_RATIOS], false, fields);

  validateEnum('resolution', input, ['720p', '1080p'], false, fields);

  // Text-only model — reject image-style inputs early so the error is clear
  for (const badField of ['image', 'image_url', 'first_frame', 'first_clip']) {
    if (input[badField] !== undefined) {
      fields.push({
        type: 'additional_property_not_allowed',
        field: badField,
        description: `wan-2.7-t2v is a text-only model and does not accept ${badField}; use wan-2.7-i2v for image-to-video`,
      });
    }
  }
}

/**
 * wan-video/wan-2.7-i2v  (image-to-video)
 *
 * Fields:
 *   prompt (required)
 *   first_frame (required unless first_clip is provided) — starting image (jpg/png, ≤ 20 MB)
 *   last_frame (optional) — end frame for first-and-last-frame mode; requires first_frame
 *   first_clip (optional) — video to continue from; CANNOT be combined with first_frame
 *   audio (optional) — for audio-synced generation
 *   negative_prompt (optional): string
 *   resolution (optional): 720p | 1080p  (default 1080p)
 *   duration (integer range): 2–15  (default 5)
 *   enable_prompt_expansion (optional): boolean
 *   seed (optional): integer
 */
function validateWanI2V(input: Record<string, unknown>, fields: InvalidField[]): void {
  requireField('prompt', input, fields);

  rangeDuration(input, 2, 15, fields);

  validateEnum('resolution', input, ['720p', '1080p'], false, fields);

  // first_frame and first_clip are mutually exclusive
  const hasFirstFrame = !!input['first_frame'];
  const hasFirstClip = !!input['first_clip'];

  if (hasFirstFrame && hasFirstClip) {
    fields.push({
      type: 'invalid',
      field: 'first_clip',
      description: 'first_frame and first_clip cannot be combined; provide only one',
    });
  } else if (!hasFirstFrame && !hasFirstClip) {
    fields.push({
      type: 'required',
      field: 'first_frame',
      description: 'first_frame is required (or first_clip for clip-continuation mode)',
    });
  }

  // last_frame requires first_frame (not compatible with first_clip mode)
  if (input['last_frame'] && !hasFirstFrame) {
    fields.push({
      type: 'invalid',
      field: 'last_frame',
      description: 'last_frame (end-frame interpolation) requires first_frame to be set',
    });
  }
}

// ─── Model → validator dispatch table ────────────────────────────────────────

type ModelValidator = (input: Record<string, unknown>, fields: InvalidField[]) => void;

const MODEL_VALIDATORS: Record<VideoModelId, ModelValidator> = {
  'lightricks/ltx-2.3-fast': validateLtxFast,
  'lightricks/ltx-2.3-pro': validateLtxPro,
  'google/veo-2': validateVeo2,
  'bytedance/seedance-2.0': validateSeedance,
  'bytedance/seedance-2.0-fast': validateSeedance,
  'wan-video/wan-2.7-t2v': validateWanT2V,
  'wan-video/wan-2.7-i2v': validateWanI2V,
};

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * Validate a Replicate prediction input against the live model schema.
 * Returns the exact 422 error body Replicate would return, or null when valid.
 *
 * This runs on EVERY `createPrediction` call — real and mock — so malformed
 * inputs are caught locally before spending a credit.
 */
export function validateReplicateInput(
  modelSlug: string,
  input: Record<string, unknown>,
): ReplicateValidationError | null {
  const fields: InvalidField[] = [];

  const validator = MODEL_VALIDATORS[modelSlug as VideoModelId];
  if (!validator) {
    fields.push({ type: 'invalid', field: 'model', description: `Unknown or unsupported model: ${modelSlug}` });
    return buildValidationError(fields);
  }

  validator(input, fields);
  return fields.length > 0 ? buildValidationError(fields) : null;
}

function buildValidationError(invalid_fields: InvalidField[]): ReplicateValidationError {
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

/** mockCreatePrediction always receives pre-validated input so it only returns ok:true. */
export type MockCreateResult = { ok: true; prediction: Record<string, unknown> };

/**
 * Validate input and, if valid, create a mock Replicate prediction stored in KV.
 * Returns a starting-state prediction object on success, or a 422 error body on
 * invalid input (exactly matching what real Replicate returns).
 *
 * Special pool URL sentinel: any URL matching /^FAIL(: .+)?$/i forces a failed
 * prediction on GET so you can test the prediction-time failure path.
 */
/**
 * Create a mock Replicate prediction stored in KV.
 *
 * NOTE: Input validation is intentionally NOT repeated here — `createPrediction`
 * in replicate.ts runs `validateReplicateInput` before reaching this function for
 * BOTH real and mock paths.  `mockCreatePrediction` is only called with pre-validated
 * inputs.  If you call it directly (e.g. in tests), validate beforehand.
 */
export async function mockCreatePrediction(
  env: Pick<CloudflareBindings, 'DB' | 'KV' | 'ASSETS_PUBLIC_URL'>,
  workspaceId: string,
  modelSlug: string,
  input: Record<string, unknown>,
): Promise<MockCreateResult> {
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

  return { ok: true, prediction: buildPredictionObject(id, modelSlug, input, 'starting', null, null, durationSec, createdAt) };
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
