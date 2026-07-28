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
  { id: 'lightricks/ltx-2.3-fast',   label: 'LTX 2.3 Fast',      desc: 'Portrait · Audio · Up to 20s · ~$0.06/s · Default' },
  { id: 'lightricks/ltx-2.3-pro',    label: 'LTX 2.3 Pro',       desc: 'Portrait · Audio · High quality · ~$0.08/s' },
  { id: 'bytedance/seedance-2.0',     label: 'Seedance 2.0',      desc: 'Portrait · Audio · 4K · Up to 15s · ~$0.18/s' },
  { id: 'bytedance/seedance-2.0-fast',label: 'Seedance 2.0 Fast', desc: 'Portrait · Audio · Faster · Up to 15s · ~$0.10/s' },
  { id: 'wan-video/wan-2.7-t2v',      label: 'Wan 2.7 T2V',       desc: 'Text · Audio · Up to 15s · ~$0.09/s' },
  { id: 'wan-video/wan-2.7-i2v',      label: 'Wan 2.7 I2V',       desc: 'Image · Audio · Up to 15s · ~$0.09/s' },
  { id: 'google/veo-2',               label: 'Google Veo 2',      desc: 'Fast · Portrait & landscape · ~$0.50/s' },
] as const;

export type VideoModelId = (typeof VIDEO_MODELS)[number]['id'];
export const DEFAULT_VIDEO_MODEL: VideoModelId = 'lightricks/ltx-2.3-fast';
export const VIDEO_MODEL_KEY = 'tf_video_model';

// ─── Video aspect ratios ──────────────────────────────────────────────────────

export const VIDEO_ASPECT_RATIOS = [
  { id: '9:16', label: '9:16', desc: 'Portrait · Reels / Shorts / TikTok' },
  { id: '16:9', label: '16:9', desc: 'Landscape · YouTube' },
] as const;

export type VideoAspectRatio = (typeof VIDEO_ASPECT_RATIOS)[number]['id'];
export const DEFAULT_VIDEO_ASPECT_RATIO: VideoAspectRatio = '9:16';
export const VIDEO_ASPECT_RATIO_KEY = 'tf_video_aspect_ratio';

// ─── Video duration ───────────────────────────────────────────────────────────
// Veo-2: 5–8s | LTX Fast: 6–20s | LTX Pro: 6–10s
// Seedance 2.0/Fast: 5–15s (was wrongly fixed at 5s)
// Wan 2.7 T2V/I2V: 2–15s (confirmed via live API test 2026-07-28)

const SEEDANCE_DURATIONS = [
  { id: '5',  label: '5s',  desc: 'Default' },
  { id: '8',  label: '8s',  desc: '' },
  { id: '10', label: '10s', desc: '' },
  { id: '12', label: '12s', desc: '' },
  { id: '15', label: '15s', desc: 'Longest' },
] as const;

const WAN_27_DURATIONS = [
  { id: '2',  label: '2s',  desc: '' },
  { id: '3',  label: '3s',  desc: '' },
  { id: '4',  label: '4s',  desc: '' },
  { id: '5',  label: '5s',  desc: 'Default' },
  { id: '8',  label: '8s',  desc: '' },
  { id: '10', label: '10s', desc: '' },
  { id: '12', label: '12s', desc: '' },
  { id: '15', label: '15s', desc: 'Longest' },
] as const;

export const VIDEO_DURATIONS: Record<VideoModelId, readonly { id: string; label: string; desc: string }[]> = {
  'google/veo-2': [
    { id: '5', label: '5s', desc: 'Fastest' },
    { id: '6', label: '6s', desc: '' },
    { id: '7', label: '7s', desc: '' },
    { id: '8', label: '8s', desc: 'Longest' },
  ],
  'lightricks/ltx-2.3-fast': [
    { id: '6',  label: '6s',  desc: 'Default' },
    { id: '8',  label: '8s',  desc: '' },
    { id: '10', label: '10s', desc: '' },
    { id: '12', label: '12s', desc: '' },
    { id: '14', label: '14s', desc: '' },
    { id: '16', label: '16s', desc: '' },
    { id: '18', label: '18s', desc: '' },
    { id: '20', label: '20s', desc: 'Longest' },
  ],
  'lightricks/ltx-2.3-pro': [
    { id: '6',  label: '6s',  desc: 'Default' },
    { id: '8',  label: '8s',  desc: '' },
    { id: '10', label: '10s', desc: 'Longest' },
  ],
  'bytedance/seedance-2.0':      SEEDANCE_DURATIONS,
  'bytedance/seedance-2.0-fast': SEEDANCE_DURATIONS,
  'wan-video/wan-2.7-t2v':       WAN_27_DURATIONS,
  'wan-video/wan-2.7-i2v':       WAN_27_DURATIONS,
};

export const DEFAULT_VIDEO_DURATIONS: Record<VideoModelId, string> = {
  'google/veo-2':              '5',
  'lightricks/ltx-2.3-fast':  '6',
  'lightricks/ltx-2.3-pro':   '6',
  'bytedance/seedance-2.0':    '5',
  'bytedance/seedance-2.0-fast': '5',
  'wan-video/wan-2.7-t2v':    '5',
  'wan-video/wan-2.7-i2v':    '5',
};

export const VIDEO_DURATION_KEY = 'tf_video_duration';

// ─── Model capability flags ───────────────────────────────────────────────────

/** All current models support aspect_ratio */
export const ASPECT_RATIO_MODEL_IDS: VideoModelId[] = [
  'google/veo-2',
  'lightricks/ltx-2.3-fast',
  'lightricks/ltx-2.3-pro',
  'bytedance/seedance-2.0',
  'bytedance/seedance-2.0-fast',
  'wan-video/wan-2.7-t2v',
  'wan-video/wan-2.7-i2v',
];

/** Models where the duration picker should be shown */
export const DURATION_MODEL_IDS: VideoModelId[] = [
  'google/veo-2',
  'lightricks/ltx-2.3-fast',
  'lightricks/ltx-2.3-pro',
  'bytedance/seedance-2.0',
  'bytedance/seedance-2.0-fast',
  'wan-video/wan-2.7-t2v',
  'wan-video/wan-2.7-i2v',
];

// ─── LTX 2.3 Pro extend chain options ────────────────────────────────────────
// Initial clip is fixed at 10 s; each extend adds 20 s for near-seamless continuity.
// Total = 10 + chainCount × 20 s.

export const LTX_EXTEND_OPTIONS = [
  { id: '0', label: 'No extend', desc: 'Single clip · up to 10s' },
  { id: '1', label: '+20s',      desc: '~30s total · 1 extend' },
  { id: '2', label: '+40s',      desc: '~50s total · 2 extends' },
  { id: '3', label: '+60s',      desc: '~70s total · 3 extends' },
  { id: '6', label: '+120s',     desc: '~130s total · 6 extends · ~2 min' },
] as const;

export const LTX_EXTEND_KEY = 'tf_ltx_extend';

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
