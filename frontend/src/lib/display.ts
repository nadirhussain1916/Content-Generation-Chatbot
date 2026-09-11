// ─── Display helpers ──────────────────────────────────────────────────────────
// Extracted so they can be imported by both page components and the test suite.

export const MODEL_LABELS: Record<string, string> = {
  'lightricks/ltx-2.3-fast':    'LTX Fast',
  'lightricks/ltx-2.3-pro':     'LTX Pro',
  'bytedance/seedance-2.0':     'Seedance 2.0',
  'bytedance/seedance-2.0-fast': 'Seedance Fast',
  'wan-video/wan-2.7-t2v':      'Wan T2V',
  'wan-video/wan-2.7-i2v':      'Wan I2V',
  'google/veo-2':               'Veo 2',
  'gpt-image-2':                'GPT Image 2',
  'gpt-image-1':                'GPT Image 1',
  'gpt-4o':                     'GPT-4o',
  'gpt-4o-mini':                'GPT-4o mini',
  'gpt-4.1':                    'GPT-4.1',
  'gpt-4.1-mini':               'GPT-4.1 mini',
  // Not a Replicate model — the ffmpeg concat pipeline (Flow B: combine clips).
  'ffmpeg-concat':              'Combined (ffmpeg)',
};

export function shortModelLabel(model: string | null): string {
  if (!model) return 'Unknown model';
  return MODEL_LABELS[model] ?? model.split('/').pop() ?? model;
}

export function formatCost(cost: number | null): string | null {
  if (cost == null || cost <= 0) return null;
  if (cost < 0.001) return `< $0.001`;
  if (cost < 0.01)  return `$${cost.toFixed(4)}`;
  if (cost < 1)     return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}

/**
 * Always returns a USD string (unlike formatCost, which returns null for $0).
 * Used for totals and rate cards where a concrete amount must always show.
 */
export function formatUsd(cost: number | null | undefined): string {
  const n = cost ?? 0;
  if (n > 0 && n < 0.01) return `$${n.toFixed(4)}`;
  if (n > 0 && n < 1)    return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

const SENSITIVE_CONTENT_MESSAGE =
  'Content flagged as sensitive. Try a different image, model, or character — or generate without a character.';

// Internal noise prefixes Replicate/the model chain onto errors, e.g.
// "Replicate prediction failed: Prediction failed: Async prediction failed: ValueError: <msg>".
// We strip these (and the trailing "(requestId)") so the user only sees the real message.
const NOISE_PREFIXES = [
  /^replicate prediction (failed|canceled):\s*/i,
  /^prediction (failed|canceled):\s*/i,
  /^async prediction (failed|canceled):\s*/i,
  /^\w*error:\s*/i, // ValueError:, ModelError:, RuntimeError:, …
];

/** Strip the technical prefix chain and a trailing "(requestId)" from a raw model error. */
function stripErrorNoise(raw: string): string {
  let msg = raw.trim();
  let changed = true;
  while (changed) {
    changed = false;
    for (const re of NOISE_PREFIXES) {
      if (re.test(msg)) { msg = msg.replace(re, '').trim(); changed = true; }
    }
  }
  // Drop a trailing Replicate request id like " (uIJ6l3ruRD)".
  msg = msg.replace(/\s*\([A-Za-z0-9]{6,}\)\s*$/, '').trim();
  return msg;
}

/**
 * Normalize a stored asset `error_message` into a user-friendly string at display time.
 * The backend intentionally stores the exact/detailed error — all user-facing cleanup
 * happens here, so it also fixes historical records.
 * - Content-moderation flag (E005) → actionable message.
 * - Everything else → "Error: <real message>" with the technical prefix chain stripped.
 */
export function friendlyErrorMessage(raw: string | null | undefined): string {
  if (!raw) return 'Generation failed';
  const lower = raw.toLowerCase();
  if (lower.includes('flagged as sensitive') || lower.includes('(e005)')) {
    return SENSITIVE_CONTENT_MESSAGE;
  }
  const cleaned = stripErrorNoise(raw);
  return cleaned ? `Error: ${cleaned}` : 'Generation failed';
}

/** Compact token counts: 1234 → 1.2K, 3_400_000 → 3.4M. */
export function formatTokens(tokens: number | null | undefined): string {
  const n = tokens ?? 0;
  if (n < 1000) return `${n}`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}
