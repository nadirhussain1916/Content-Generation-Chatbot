// ─── Text model pricing (USD per 1M tokens) ───────────────────────────────────

const TEXT_COSTS: Record<string, { input: number; output: number }> = {
  'gpt-4o':       { input: 2.50,  output: 10.00 },
  'gpt-4o-mini':  { input: 0.15,  output: 0.60  },
  'gpt-4.1':      { input: 2.00,  output: 8.00  },
  'gpt-4.1-mini': { input: 0.40,  output: 1.60  },
};

export function calcTextCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = TEXT_COSTS[model];
  if (!pricing) return 0;
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}

// ─── Image model pricing (USD per image) ─────────────────────────────────────
// We send quality=auto, so these are mid-tier ("medium") estimates.
// gpt-image-2:  square $0.053 · non-square $0.041
// gpt-image-1:  square $0.042 · non-square $0.063 (kept for historical assets)

const IMAGE_COSTS: Record<string, { flat?: number; square?: number; nonSquare?: number }> = {
  'gpt-image-2': { square: 0.053, nonSquare: 0.041 },
  'gpt-image-1': { square: 0.042, nonSquare: 0.063 },
};

export function calcImageCost(model: string, size: string): number {
  const pricing = IMAGE_COSTS[model];
  if (!pricing) return 0;
  if (pricing.flat != null) return pricing.flat;
  const isSquare = size === '1024x1024';
  return (isSquare ? pricing.square : pricing.nonSquare) ?? 0;
}

// ─── Video model pricing (USD per second) ────────────────────────────────────

const VIDEO_COST_PER_SEC: Record<string, number> = {
  'lightricks/ltx-2.3-fast':    0.06,
  'lightricks/ltx-2.3-pro':     0.08,
  'bytedance/seedance-2.0':     0.18,
  'bytedance/seedance-2.0-fast': 0.10,
  'wan-video/wan-2.7-t2v':      0.09,
  'wan-video/wan-2.7-i2v':      0.09,
  'google/veo-2':               0.50,
};

/**
 * Calculate the cost of a single-clip video generation.
 * @param model  Replicate model ID
 * @param durationSec  Duration of the clip in seconds
 */
export function calcVideoClipCost(model: string, durationSec: number): number {
  const rate = VIDEO_COST_PER_SEC[model] ?? 0;
  return rate * durationSec;
}

/**
 * Calculate the total cost of an LTX Pro extend-chain generation.
 *
 * IMPORTANT: LTX extend chains are billed per second of OUTPUT video, and each
 * extend call re-emits the FULL cumulative video. So the true cost is the sum of
 * every step's length — not just the final length billed once. e.g. a 10s clip
 * extended to 40s (3 × 10s extends) bills 10 + 20 + 30 + 40 = 100 output-seconds,
 * not 40. This matches Replicate's per-prediction "Approximate cost".
 */
export function calcLtxChainCost(
  model: string,
  initialDuration: number,
  chainCount: number,
  extendDuration: number,
): number {
  const rate = VIDEO_COST_PER_SEC[model] ?? 0;
  let cumulativeSec = initialDuration;
  let total = rate * cumulativeSec; // initial clip
  for (let i = 0; i < chainCount; i++) {
    cumulativeSec += extendDuration;
    total += rate * cumulativeSec; // each extend re-bills the full cumulative length
  }
  return total;
}
