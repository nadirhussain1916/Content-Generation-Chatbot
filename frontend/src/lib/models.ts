// ─── Text (chat / planning / draft) models ───────────────────────────────────

export const TEXT_MODELS = [
  { id: 'gpt-4o',       label: 'GPT-4o',       desc: 'Balanced · Default' },
  { id: 'gpt-4o-mini',  label: 'GPT-4o mini',  desc: 'Fast · Affordable' },
  { id: 'gpt-4.1',      label: 'GPT-4.1',      desc: 'Latest · Most capable' },
  { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini', desc: 'Latest · Fast' },
] as const;

export type TextModelId = (typeof TEXT_MODELS)[number]['id'];
export const DEFAULT_TEXT_MODEL: TextModelId = 'gpt-4o';
export const TEXT_MODEL_KEY = 'tf_text_model';

// ─── Image generation models ──────────────────────────────────────────────────

export const IMAGE_MODELS = [
  { id: 'gpt-image-1', label: 'GPT Image 1', desc: 'OpenAI · Best quality' },
  { id: 'dall-e-3',    label: 'DALL-E 3',    desc: 'OpenAI · Standard' },
] as const;

export type ImageModelId = (typeof IMAGE_MODELS)[number]['id'];
export const DEFAULT_IMAGE_MODEL: ImageModelId = 'gpt-image-1';
export const IMAGE_MODEL_KEY = 'tf_image_model';

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function readPref<T extends string>(key: string, fallback: T): T {
  try {
    return (localStorage.getItem(key) as T) ?? fallback;
  } catch {
    return fallback;
  }
}

export function writePref(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch {}
}
