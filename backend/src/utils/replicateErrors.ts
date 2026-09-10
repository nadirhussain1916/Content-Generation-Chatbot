// ─── Replicate error normalization ───────────────────────────────────────────
// Turns raw Replicate/model error strings into concise, user-friendly messages
// that we can safely store as `error_message` and surface directly in the UI.

/**
 * Content-moderation rejection from the video model's safety filter.
 * Providers like ByteDance/Seedance and MiniMax return `(E005)` with the phrase
 * "flagged as sensitive" when the prompt, reference image, or output frames are
 * deemed sensitive. There is nothing to pre-approve — the user must change the
 * input to proceed.
 */
const SENSITIVE_CONTENT_MESSAGE =
  'Content flagged as sensitive. Try a different image, model, or character — or generate without a character.';

/** True when a raw error string is the model's sensitive-content moderation flag. */
export function isSensitiveContentError(raw: string): boolean {
  const lower = raw.toLowerCase();
  return lower.includes('flagged as sensitive') || lower.includes('(e005)');
}

/**
 * Map a raw Replicate/model error into a user-friendly message.
 * Falls back to the original string when we don't have a friendlier equivalent.
 */
export function friendlyReplicateError(raw: string): string {
  if (isSensitiveContentError(raw)) return SENSITIVE_CONTENT_MESSAGE;
  return raw;
}
