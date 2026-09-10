// ─── Generation model configuration & validation (single source of truth) ────
//
// Every valid model / size / mode / duration lives here so the agent, the API
// routes, and cost calculation all agree. The agent is now allowed to choose
// these settings itself (they ride along in the draft's post_package), so this
// module also exposes coercion helpers that snap an agent's choice back to a
// valid value and report a human-readable warning when they had to correct it.
// The Zod tool schemas (openai.ts) constrain the agent to these enums up front;
// the coercion helpers are the defensive second layer for anything that slips
// through (legacy drafts, manual edits, drifted clients).

// ─── Image ────────────────────────────────────────────────────────────────────

export const IMAGE_MODELS = ['gpt-image-2'] as const;
export type ImageModelId = (typeof IMAGE_MODELS)[number];
export const DEFAULT_IMAGE_MODEL: ImageModelId = 'gpt-image-2';

export const IMAGE_SIZES = ['1024x1024', '1024x1792', '1792x1024'] as const;
export type ImageSize = (typeof IMAGE_SIZES)[number];
export const DEFAULT_IMAGE_SIZE: ImageSize = '1024x1024';

export const GENERATION_MODES = ['edit', 'inspire'] as const;
export type GenerationMode = (typeof GENERATION_MODES)[number];
export const DEFAULT_GENERATION_MODE: GenerationMode = 'inspire';

// ─── Video ────────────────────────────────────────────────────────────────────

export const VIDEO_MODELS = [
  'lightricks/ltx-2.3-fast',
  'lightricks/ltx-2.3-pro',
  'bytedance/seedance-2.0',
  'bytedance/seedance-2.0-fast',
  'wan-video/wan-2.7-t2v',
  'wan-video/wan-2.7-i2v',
  'google/veo-2',
] as const;
export type VideoModelId = (typeof VIDEO_MODELS)[number];
export const DEFAULT_VIDEO_MODEL: VideoModelId = 'lightricks/ltx-2.3-fast';

export const VIDEO_ASPECT_RATIOS = ['9:16', '16:9'] as const;
export type VideoAspectRatio = (typeof VIDEO_ASPECT_RATIOS)[number];
export const DEFAULT_VIDEO_ASPECT_RATIO: VideoAspectRatio = '9:16';

// Per-model allowed generation durations (seconds). Each Replicate model rejects
// out-of-range values (e.g. LTX Pro only accepts 6/8/10), so we snap the
// requested duration to the nearest allowed value before creating a prediction.
// Mirrors VIDEO_DURATIONS in the frontend (frontend/src/lib/models.ts).
export const MODEL_VALID_DURATIONS: Record<VideoModelId, number[]> = {
  'google/veo-2': [5, 6, 7, 8],
  'lightricks/ltx-2.3-fast': [6, 8, 10, 12, 14, 16, 18, 20],
  'lightricks/ltx-2.3-pro': [6, 8, 10],
  'bytedance/seedance-2.0': [5, 8, 10, 12, 15],
  'bytedance/seedance-2.0-fast': [5, 8, 10, 12, 15],
  'wan-video/wan-2.7-t2v': [2, 3, 4, 5, 8, 10, 12, 15],
  'wan-video/wan-2.7-i2v': [2, 3, 4, 5, 8, 10, 12, 15],
};

export const DEFAULT_VIDEO_DURATION: Record<VideoModelId, number> = {
  'google/veo-2': 5,
  'lightricks/ltx-2.3-fast': 6,
  'lightricks/ltx-2.3-pro': 6,
  'bytedance/seedance-2.0': 5,
  'bytedance/seedance-2.0-fast': 5,
  'wan-video/wan-2.7-t2v': 5,
  'wan-video/wan-2.7-i2v': 5,
};

/** Image-to-video models — require a starting frame / reference image. */
export const I2V_MODELS = new Set<VideoModelId>(['wan-video/wan-2.7-i2v']);

/** Text-only video models — ignore any reference image. */
export const TEXT_ONLY_VIDEO_MODELS = new Set<VideoModelId>(['wan-video/wan-2.7-t2v']);

// ─── Type guards ──────────────────────────────────────────────────────────────

export function isImageModel(v: unknown): v is ImageModelId {
  return typeof v === 'string' && (IMAGE_MODELS as readonly string[]).includes(v);
}
export function isImageSize(v: unknown): v is ImageSize {
  return typeof v === 'string' && (IMAGE_SIZES as readonly string[]).includes(v);
}
export function isGenerationMode(v: unknown): v is GenerationMode {
  return v === 'edit' || v === 'inspire';
}
export function isVideoModel(v: unknown): v is VideoModelId {
  return typeof v === 'string' && (VIDEO_MODELS as readonly string[]).includes(v);
}
export function isVideoAspectRatio(v: unknown): v is VideoAspectRatio {
  return v === '9:16' || v === '16:9';
}

// ─── Coercion result ──────────────────────────────────────────────────────────

export type Coerced<T> = { value: T; warning?: string };

// ─── Coercion helpers ─────────────────────────────────────────────────────────
// Each returns the value to actually use plus an optional warning explaining any
// correction. Callers log the warning so we can see when the agent (or a client)
// sent something invalid.

export function coerceImageModel(v: unknown): Coerced<ImageModelId> {
  if (isImageModel(v)) return { value: v };
  return {
    value: DEFAULT_IMAGE_MODEL,
    warning: v == null ? undefined : `Unknown image model "${String(v)}" — using ${DEFAULT_IMAGE_MODEL}.`,
  };
}

export function coerceImageSize(v: unknown): Coerced<ImageSize> {
  if (isImageSize(v)) return { value: v };
  return {
    value: DEFAULT_IMAGE_SIZE,
    warning: v == null ? undefined : `Unknown image size "${String(v)}" — using ${DEFAULT_IMAGE_SIZE}.`,
  };
}

export function coerceGenerationMode(v: unknown): Coerced<GenerationMode> {
  if (isGenerationMode(v)) return { value: v };
  return {
    value: DEFAULT_GENERATION_MODE,
    warning: v == null ? undefined : `Unknown generation mode "${String(v)}" — using ${DEFAULT_GENERATION_MODE}.`,
  };
}

export function coerceVideoModel(v: unknown): Coerced<VideoModelId> {
  if (isVideoModel(v)) return { value: v };
  return {
    value: DEFAULT_VIDEO_MODEL,
    warning: v == null ? undefined : `Unknown video model "${String(v)}" — using ${DEFAULT_VIDEO_MODEL}.`,
  };
}

export function coerceVideoAspectRatio(v: unknown): Coerced<VideoAspectRatio> {
  if (isVideoAspectRatio(v)) return { value: v };
  return {
    value: DEFAULT_VIDEO_ASPECT_RATIO,
    warning: v == null ? undefined : `Unknown aspect ratio "${String(v)}" — using ${DEFAULT_VIDEO_ASPECT_RATIO}.`,
  };
}

/** Snap a requested duration to the nearest value the given model accepts. */
export function snapDuration(modelId: string, requested: number): Coerced<number> {
  const allowed = MODEL_VALID_DURATIONS[modelId as VideoModelId];
  if (!allowed || allowed.length === 0) return { value: requested };
  if (allowed.includes(requested)) return { value: requested };
  const snapped = allowed.reduce((best, d) =>
    Math.abs(d - requested) < Math.abs(best - requested) ? d : best
  );
  return {
    value: snapped,
    warning: `Duration ${requested}s is not valid for ${modelId} (allowed: ${allowed.join('/')}s) — using ${snapped}s.`,
  };
}

// ─── Per-model Replicate input builders (single source of truth) ──────────────
// Each model exposes a slightly different input shape; in particular the name of
// the reference-image / starting-frame field differs. Both the /video route and
// the stitching workflow (chain / continue modes, which seed each chunk with the
// previous chunk's last frame) build inputs through this map so they always agree.

export type VideoModelConfig = {
  slug: string;
  buildInput: (
    prompt: string,
    aspectRatio: string,
    duration: number,
    referenceImageUrl?: string,
  ) => Record<string, unknown>;
};

export const VIDEO_MODEL_CONFIGS: Record<VideoModelId, VideoModelConfig> = {
  'google/veo-2': {
    slug: 'google/veo-2',
    buildInput: (prompt, aspectRatio, duration, referenceImageUrl) => ({
      prompt,
      aspect_ratio: aspectRatio,
      duration,
      ...(referenceImageUrl && { image_url: referenceImageUrl }),
    }),
  },
  'lightricks/ltx-2.3-fast': {
    slug: 'lightricks/ltx-2.3-fast',
    buildInput: (prompt, aspectRatio, duration, referenceImageUrl) => ({
      prompt,
      aspect_ratio: aspectRatio,
      duration,
      ...(referenceImageUrl && { image: referenceImageUrl }),
    }),
  },
  'lightricks/ltx-2.3-pro': {
    slug: 'lightricks/ltx-2.3-pro',
    buildInput: (prompt, aspectRatio, duration, referenceImageUrl) => ({
      prompt,
      aspect_ratio: aspectRatio,
      duration,
      ...(referenceImageUrl && { image: referenceImageUrl }),
    }),
  },
  'bytedance/seedance-2.0': {
    slug: 'bytedance/seedance-2.0',
    buildInput: (prompt, aspectRatio, duration, referenceImageUrl) => ({
      prompt,
      aspect_ratio: aspectRatio,
      duration,
      ...(referenceImageUrl && { image: referenceImageUrl }),
    }),
  },
  'bytedance/seedance-2.0-fast': {
    slug: 'bytedance/seedance-2.0-fast',
    buildInput: (prompt, aspectRatio, duration, referenceImageUrl) => ({
      prompt,
      aspect_ratio: aspectRatio,
      duration,
      ...(referenceImageUrl && { image: referenceImageUrl }),
    }),
  },
  'wan-video/wan-2.7-t2v': {
    slug: 'wan-video/wan-2.7-t2v',
    // Text-only model — ignores referenceImageUrl.
    buildInput: (prompt, aspectRatio, duration) => ({
      prompt,
      aspect_ratio: aspectRatio,
      duration,
      resolution: '720p',
    }),
  },
  'wan-video/wan-2.7-i2v': {
    slug: 'wan-video/wan-2.7-i2v',
    // Image-to-video: the starting frame MUST be passed as `first_frame`.
    buildInput: (prompt, aspectRatio, duration, referenceImageUrl) => ({
      prompt,
      aspect_ratio: aspectRatio,
      duration,
      resolution: '720p',
      ...(referenceImageUrl && { first_frame: referenceImageUrl }),
    }),
  },
};

// ─── Long-video (chunk + ffmpeg stitch) configuration ─────────────────────────

/** Models that accept a starting frame — i.e. can be frame-chained ("Seamless"). */
export const I2V_CAPABLE = new Set<VideoModelId>(
  (VIDEO_MODELS as readonly VideoModelId[]).filter((m) => !TEXT_ONLY_VIDEO_MODELS.has(m)),
);

/** The Replicate input field used for the starting frame, per model (null = text-only). */
export function referenceParamFor(modelId: string): 'image' | 'image_url' | 'first_frame' | null {
  if (modelId === 'google/veo-2') return 'image_url';
  if (modelId === 'wan-video/wan-2.7-i2v') return 'first_frame';
  if (modelId === 'wan-video/wan-2.7-t2v') return null;
  return 'image';
}

/** Longest single-clip length each model accepts (derived from MODEL_VALID_DURATIONS). */
export const MODEL_MAX_CLIP_SECONDS: Record<VideoModelId, number> = Object.fromEntries(
  (Object.keys(MODEL_VALID_DURATIONS) as VideoModelId[]).map((m) => [m, Math.max(...MODEL_VALID_DURATIONS[m])]),
) as Record<VideoModelId, number>;

// Bounds for how many chunks a stitched long video may contain. Concat can run all
// chunks in parallel, so the ceiling is generous; chain (sequential) is slower and
// the agent/UI discourage very high counts.
export const STITCH_MIN_CHUNKS = 2;
export const STITCH_MAX_CHUNKS = 20;
export const STITCH_MODES = ['concat', 'chain'] as const;
export type StitchMode = (typeof STITCH_MODES)[number];

export function isStitchMode(v: unknown): v is StitchMode {
  return v === 'concat' || v === 'chain';
}

/**
 * Plan how to reach `targetSeconds` with a given model: use the model's longest
 * valid clip length and split into as many chunks as needed (clamped to
 * STITCH_MAX_CHUNKS). `capped` is true when the target can't be fully reached.
 * Single source of truth reused by the route, the agent guidance, and the UI.
 */
export function computeChunkPlan(
  modelId: VideoModelId,
  targetSeconds: number,
): { chunkDuration: number; chunkCount: number; reachableSeconds: number; capped: boolean } {
  const chunkDuration = MODEL_MAX_CLIP_SECONDS[modelId] ?? 5;
  const rawCount = Math.max(1, Math.ceil(targetSeconds / chunkDuration));
  const chunkCount = Math.min(rawCount, STITCH_MAX_CHUNKS);
  return {
    chunkDuration,
    chunkCount,
    reachableSeconds: chunkCount * chunkDuration,
    capped: rawCount > STITCH_MAX_CHUNKS,
  };
}
