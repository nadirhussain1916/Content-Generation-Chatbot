// ─── Platform settings helpers ────────────────────────────────────────────────
// Extracted so they can be imported by both SettingsPage and the test suite.

export type AspectRatio = '9:16' | '16:9' | '1:1' | '4:3' | '3:4';

export interface PlatformConfig {
  enabled: boolean;
  aspectRatio: AspectRatio;
}

export type PlatformSettings = Record<string, PlatformConfig>;

export const PLATFORM_DEFS: { id: string; label: string; icon: string; defaultRatio: AspectRatio }[] = [
  { id: 'instagram',      label: 'Instagram Reels', icon: 'IG', defaultRatio: '9:16' },
  { id: 'tiktok',         label: 'TikTok',          icon: 'TT', defaultRatio: '9:16' },
  { id: 'youtube_shorts', label: 'YouTube Shorts',  icon: 'YS', defaultRatio: '9:16' },
  { id: 'youtube',        label: 'YouTube',         icon: 'YT', defaultRatio: '16:9' },
  { id: 'twitter',        label: 'X / Twitter',     icon: 'TW', defaultRatio: '16:9' },
  { id: 'linkedin',       label: 'LinkedIn',        icon: 'LI', defaultRatio: '16:9' },
];

export const DEFAULT_PLATFORM_SETTINGS: PlatformSettings = Object.fromEntries(
  PLATFORM_DEFS.map((p) => [p.id, { enabled: p.id === 'instagram', aspectRatio: p.defaultRatio }])
);

export const RATIO_IMAGE_SIZE: Record<AspectRatio, string> = {
  '9:16': '1024×1792',
  '16:9': '1792×1024',
  '1:1':  '1024×1024',
  '4:3':  '1792×1024',
  '3:4':  '1024×1792',
};

export const RATIO_VIDEO_DIMS: Record<AspectRatio, string> = {
  '9:16': '720×1280',
  '16:9': '1280×720',
  '1:1':  '1080×1080',
  '4:3':  '1280×720',
  '3:4':  '720×1280',
};

export function parsePlatformSettings(raw: string | null | undefined): PlatformSettings {
  if (!raw) return { ...DEFAULT_PLATFORM_SETTINGS };
  try {
    const parsed = JSON.parse(raw) as Record<string, Partial<PlatformConfig>>;
    const merged: PlatformSettings = { ...DEFAULT_PLATFORM_SETTINGS };
    for (const [id, cfg] of Object.entries(parsed)) {
      if (cfg && typeof cfg === 'object') {
        merged[id] = {
          enabled: Boolean(cfg.enabled),
          aspectRatio: (cfg.aspectRatio as AspectRatio) ?? DEFAULT_PLATFORM_SETTINGS[id]?.aspectRatio ?? '9:16',
        };
      }
    }
    return merged;
  } catch {
    return { ...DEFAULT_PLATFORM_SETTINGS };
  }
}

export function derivedSizesFromSettings(settings: PlatformSettings): {
  imageSize: string;
  videoDimensions: string;
  aspectRatio: AspectRatio;
} {
  const primary = PLATFORM_DEFS.find((p) => settings[p.id]?.enabled);
  const ratio: AspectRatio = primary ? (settings[primary.id]?.aspectRatio ?? '9:16') : '9:16';
  return { imageSize: RATIO_IMAGE_SIZE[ratio], videoDimensions: RATIO_VIDEO_DIMS[ratio], aspectRatio: ratio };
}
