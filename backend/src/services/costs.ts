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
// gpt-image-1: quality=auto — mid-tier estimate
//   1024×1024:               $0.042
//   1024×1536 / 1536×1024:   $0.063
// dall-e-3: standard quality $0.04 (all sizes)

export function calcImageCost(model: string, size: string): number {
  if (model === 'dall-e-3') return 0.04;
  if (model === 'gpt-image-1') {
    const isSquare = size === '1024x1024';
    return isSquare ? 0.042 : 0.063;
  }
  return 0;
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
 * Total duration = initialDuration + chainCount × extendDuration.
 */
export function calcLtxChainCost(
  model: string,
  initialDuration: number,
  chainCount: number,
  extendDuration: number,
): number {
  const totalSec = initialDuration + chainCount * extendDuration;
  return calcVideoClipCost(model, totalSec);
}
