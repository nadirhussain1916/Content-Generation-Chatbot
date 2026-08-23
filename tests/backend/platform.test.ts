import { describe, it, expect } from 'vitest';
import {
  imageSizeFromRatio,
  videoDimsFromRatio,
  deriveFromPlatformSettings,
  PLATFORM_ORDER,
  type AspectRatio,
  type PlatformConfig,
} from '../../backend/src/utils/platform';

// ─── imageSizeFromRatio ───────────────────────────────────────────────────────

describe('imageSizeFromRatio', () => {
  it('portrait ratios → 1024x1792', () => {
    const portrait: AspectRatio[] = ['9:16', '3:4', '9:21'];
    for (const r of portrait) {
      expect(imageSizeFromRatio(r), `ratio ${r}`).toBe('1024x1792');
    }
  });

  it('landscape ratios → 1792x1024', () => {
    const landscape: AspectRatio[] = ['16:9', '4:3', '21:9'];
    for (const r of landscape) {
      expect(imageSizeFromRatio(r), `ratio ${r}`).toBe('1792x1024');
    }
  });

  it('1:1 → 1024x1024', () => {
    expect(imageSizeFromRatio('1:1')).toBe('1024x1024');
  });
});

// ─── videoDimsFromRatio ───────────────────────────────────────────────────────

describe('videoDimsFromRatio', () => {
  it('portrait ratios → 720x1280', () => {
    const portrait: AspectRatio[] = ['9:16', '3:4', '9:21'];
    for (const r of portrait) {
      expect(videoDimsFromRatio(r), `ratio ${r}`).toBe('720x1280');
    }
  });

  it('landscape ratios → 1280x720', () => {
    const landscape: AspectRatio[] = ['16:9', '4:3', '21:9'];
    for (const r of landscape) {
      expect(videoDimsFromRatio(r), `ratio ${r}`).toBe('1280x720');
    }
  });

  it('1:1 → 1080x1080', () => {
    expect(videoDimsFromRatio('1:1')).toBe('1080x1080');
  });
});

// ─── PLATFORM_ORDER ───────────────────────────────────────────────────────────

describe('PLATFORM_ORDER', () => {
  it('contains the six known platform ids', () => {
    expect(PLATFORM_ORDER).toContain('instagram');
    expect(PLATFORM_ORDER).toContain('tiktok');
    expect(PLATFORM_ORDER).toContain('youtube_shorts');
    expect(PLATFORM_ORDER).toContain('youtube');
    expect(PLATFORM_ORDER).toContain('twitter');
    expect(PLATFORM_ORDER).toContain('linkedin');
    expect(PLATFORM_ORDER).toHaveLength(6);
  });

  it('instagram comes first (highest priority for portrait defaults)', () => {
    expect(PLATFORM_ORDER[0]).toBe('instagram');
  });
});

// ─── deriveFromPlatformSettings ───────────────────────────────────────────────

const makeSettings = (
  overrides: Record<string, Partial<PlatformConfig>>
): Record<string, PlatformConfig> => {
  const defaults: Record<string, PlatformConfig> = Object.fromEntries(
    PLATFORM_ORDER.map((id) => [id, { enabled: false, aspectRatio: '9:16' as AspectRatio }])
  );
  for (const [id, cfg] of Object.entries(overrides)) {
    defaults[id] = { ...defaults[id], ...cfg } as PlatformConfig;
  }
  return defaults;
};

describe('deriveFromPlatformSettings', () => {
  it('no enabled platforms → portrait defaults (9:16)', () => {
    const result = deriveFromPlatformSettings(makeSettings({}));
    expect(result.default_platforms).toBe(JSON.stringify([]));
    expect(result.default_image_size).toBe('1024x1792');
    expect(result.default_video_dimensions).toBe('720x1280');
  });

  it('instagram enabled with 9:16 → portrait outputs', () => {
    const result = deriveFromPlatformSettings(
      makeSettings({ instagram: { enabled: true, aspectRatio: '9:16' } })
    );
    expect(JSON.parse(result.default_platforms)).toEqual(['instagram']);
    expect(result.default_image_size).toBe('1024x1792');
    expect(result.default_video_dimensions).toBe('720x1280');
  });

  it('youtube enabled with 16:9 → landscape outputs', () => {
    const result = deriveFromPlatformSettings(
      makeSettings({ youtube: { enabled: true, aspectRatio: '16:9' } })
    );
    expect(JSON.parse(result.default_platforms)).toContain('youtube');
    expect(result.default_image_size).toBe('1792x1024');
    expect(result.default_video_dimensions).toBe('1280x720');
  });

  it('multiple enabled → primary platform (first in PLATFORM_ORDER) wins', () => {
    const result = deriveFromPlatformSettings(
      makeSettings({
        instagram: { enabled: true, aspectRatio: '9:16' },
        youtube:   { enabled: true, aspectRatio: '16:9' },
      })
    );
    // instagram is first in PLATFORM_ORDER → 9:16 wins
    expect(result.default_image_size).toBe('1024x1792');
    expect(result.default_video_dimensions).toBe('720x1280');
    const platforms = JSON.parse(result.default_platforms) as string[];
    expect(platforms).toContain('instagram');
    expect(platforms).toContain('youtube');
  });

  it('4:3 primary platform → landscape outputs', () => {
    const result = deriveFromPlatformSettings(
      makeSettings({ instagram: { enabled: true, aspectRatio: '4:3' } })
    );
    expect(result.default_image_size).toBe('1792x1024');
    expect(result.default_video_dimensions).toBe('1280x720');
  });

  it('3:4 primary platform → portrait outputs', () => {
    const result = deriveFromPlatformSettings(
      makeSettings({ instagram: { enabled: true, aspectRatio: '3:4' } })
    );
    expect(result.default_image_size).toBe('1024x1792');
    expect(result.default_video_dimensions).toBe('720x1280');
  });

  it('1:1 primary platform → square outputs', () => {
    const result = deriveFromPlatformSettings(
      makeSettings({ instagram: { enabled: true, aspectRatio: '1:1' } })
    );
    expect(result.default_image_size).toBe('1024x1024');
    expect(result.default_video_dimensions).toBe('1080x1080');
  });
});
