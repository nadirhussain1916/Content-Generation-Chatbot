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

// ─── Video generation models ──────────────────────────────────────────────────

export const VIDEO_MODELS = [
  { id: 'wavespeedai/wan-2.1-t2v-480p', label: 'WAN 2.1 (480p)',   desc: 'Open source · Fast · Default' },
  { id: 'wavespeedai/wan-2.1-t2v-720p', label: 'WAN 2.1 (720p)',   desc: 'Open source · Best resolution' },
  { id: 'minimax/video-01',             label: 'MiniMax Video 01', desc: 'Fast · High quality' },
] as const;

export type VideoModelId = (typeof VIDEO_MODELS)[number]['id'];
export const DEFAULT_VIDEO_MODEL: VideoModelId = 'wavespeedai/wan-2.1-t2v-480p';
export const VIDEO_MODEL_KEY = 'tf_video_model';

// ─── Video aspect ratios (WAN models only) ────────────────────────────────────

export const VIDEO_ASPECT_RATIOS = [
  { id: '16:9', label: '16:9', desc: 'Landscape · YouTube / TikTok' },
  { id: '9:16', label: '9:16', desc: 'Portrait · Reels / Shorts' },
  { id: '1:1',  label: '1:1',  desc: 'Square · Instagram' },
  { id: '4:3',  label: '4:3',  desc: 'Classic landscape' },
  { id: '3:4',  label: '3:4',  desc: 'Classic portrait' },
] as const;

export type VideoAspectRatio = (typeof VIDEO_ASPECT_RATIOS)[number]['id'];
export const DEFAULT_VIDEO_ASPECT_RATIO: VideoAspectRatio = '9:16';
export const VIDEO_ASPECT_RATIO_KEY = 'tf_video_aspect_ratio';

/** Models that support custom aspect_ratio input */
export const WAN_MODEL_IDS: VideoModelId[] = [
  'wavespeedai/wan-2.1-t2v-480p',
  'wavespeedai/wan-2.1-t2v-720p',
];

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
