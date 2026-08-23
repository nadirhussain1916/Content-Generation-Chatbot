// ─── Platform settings utilities ─────────────────────────────────────────────
// Extracted here so they can be imported by both the workspaces route
// and the unit-test suite without pulling in the full Hono dependency graph.

export type AspectRatio = '9:16' | '16:9' | '1:1' | '4:3' | '3:4' | '21:9' | '9:21';
export interface PlatformConfig { enabled: boolean; aspectRatio: AspectRatio }

/** Portrait-family ratios → portrait image/video sizes. */
export function imageSizeFromRatio(ratio: AspectRatio): '1024x1024' | '1024x1792' | '1792x1024' {
  if (ratio === '9:16' || ratio === '3:4' || ratio === '9:21') return '1024x1792';
  if (ratio === '16:9' || ratio === '4:3' || ratio === '21:9') return '1792x1024';
  return '1024x1024';
}

export function videoDimsFromRatio(ratio: AspectRatio): '1280x720' | '720x1280' | '1080x1080' {
  if (ratio === '9:16' || ratio === '3:4' || ratio === '9:21') return '720x1280';
  if (ratio === '16:9' || ratio === '4:3' || ratio === '21:9') return '1280x720';
  return '1080x1080';
}

export const PLATFORM_ORDER = [
  'instagram', 'tiktok', 'youtube_shorts', 'youtube', 'twitter', 'linkedin',
];

/**
 * Given a parsed platform_settings map, derive the three legacy workspace columns
 * that the generation pipeline and LLM prompt rely on.
 */
export function deriveFromPlatformSettings(settings: Record<string, PlatformConfig>): {
  default_platforms: string;
  default_image_size: '1024x1024' | '1024x1792' | '1792x1024';
  default_video_dimensions: '1280x720' | '720x1280' | '1080x1080';
} {
  const enabled = PLATFORM_ORDER.filter((id) => settings[id]?.enabled);
  const primary = enabled[0];
  const primaryRatio: AspectRatio = primary ? (settings[primary]?.aspectRatio ?? '9:16') : '9:16';
  return {
    default_platforms: JSON.stringify(enabled),
    default_image_size: imageSizeFromRatio(primaryRatio),
    default_video_dimensions: videoDimsFromRatio(primaryRatio),
  };
}
