import { describe, it, expect } from 'vitest';
import {
  parsePlatformSettings,
  derivedSizesFromSettings,
  DEFAULT_PLATFORM_SETTINGS,
  PLATFORM_DEFS,
  RATIO_IMAGE_SIZE,
  RATIO_VIDEO_DIMS,
  type AspectRatio,
} from '../../frontend/src/lib/platform';

// ─── parsePlatformSettings ────────────────────────────────────────────────────

describe('parsePlatformSettings', () => {
  it('null/undefined → default settings', () => {
    expect(parsePlatformSettings(null)).toEqual(DEFAULT_PLATFORM_SETTINGS);
    expect(parsePlatformSettings(undefined)).toEqual(DEFAULT_PLATFORM_SETTINGS);
  });

  it('empty string → default settings', () => {
    expect(parsePlatformSettings('')).toEqual(DEFAULT_PLATFORM_SETTINGS);
  });

  it('invalid JSON → default settings (no throw)', () => {
    expect(parsePlatformSettings('{bad json')).toEqual(DEFAULT_PLATFORM_SETTINGS);
  });

  it('valid JSON is merged with defaults (new platforms always appear)', () => {
    const raw = JSON.stringify({
      instagram: { enabled: true,  aspectRatio: '9:16' },
      tiktok:    { enabled: false, aspectRatio: '9:16' },
    });
    const result = parsePlatformSettings(raw);
    expect(result.instagram.enabled).toBe(true);
    expect(result.tiktok.enabled).toBe(false);
    // Platforms not in the JSON should still be present from defaults
    expect(result.youtube).toBeDefined();
    expect(result.linkedin).toBeDefined();
  });

  it('aspectRatio from JSON is preserved', () => {
    const raw = JSON.stringify({ youtube: { enabled: true, aspectRatio: '16:9' } });
    const result = parsePlatformSettings(raw);
    expect(result.youtube.aspectRatio).toBe('16:9');
  });

  it('missing aspectRatio in JSON falls back to platform default', () => {
    const raw = JSON.stringify({ instagram: { enabled: true } });
    const result = parsePlatformSettings(raw);
    expect(result.instagram.aspectRatio).toBe(
      DEFAULT_PLATFORM_SETTINGS['instagram']?.aspectRatio ?? '9:16'
    );
  });
});

// ─── DEFAULT_PLATFORM_SETTINGS ────────────────────────────────────────────────

describe('DEFAULT_PLATFORM_SETTINGS', () => {
  it('contains all platforms defined in PLATFORM_DEFS', () => {
    for (const p of PLATFORM_DEFS) {
      expect(DEFAULT_PLATFORM_SETTINGS[p.id], `missing ${p.id}`).toBeDefined();
    }
  });

  it('only instagram is enabled by default', () => {
    const enabled = Object.entries(DEFAULT_PLATFORM_SETTINGS)
      .filter(([, cfg]) => cfg.enabled)
      .map(([id]) => id);
    expect(enabled).toEqual(['instagram']);
  });
});

// ─── RATIO_IMAGE_SIZE / RATIO_VIDEO_DIMS ──────────────────────────────────────

describe('RATIO_IMAGE_SIZE', () => {
  it('portrait ratios map to portrait image sizes', () => {
    expect(RATIO_IMAGE_SIZE['9:16']).toContain('1024');
    expect(RATIO_IMAGE_SIZE['3:4']).toContain('1024');
  });

  it('landscape ratios map to landscape image sizes', () => {
    expect(RATIO_IMAGE_SIZE['16:9']).toContain('1792');
    expect(RATIO_IMAGE_SIZE['4:3']).toContain('1792');
  });

  it('1:1 maps to square', () => {
    expect(RATIO_IMAGE_SIZE['1:1']).toBe('1024×1024');
  });
});

describe('RATIO_VIDEO_DIMS', () => {
  it('9:16 and 3:4 map to portrait video dims', () => {
    expect(RATIO_VIDEO_DIMS['9:16']).toBe('720×1280');
    expect(RATIO_VIDEO_DIMS['3:4']).toBe('720×1280');
  });

  it('16:9 and 4:3 map to landscape video dims', () => {
    expect(RATIO_VIDEO_DIMS['16:9']).toBe('1280×720');
    expect(RATIO_VIDEO_DIMS['4:3']).toBe('1280×720');
  });

  it('1:1 maps to square video dims', () => {
    expect(RATIO_VIDEO_DIMS['1:1']).toBe('1080×1080');
  });
});

// ─── derivedSizesFromSettings ─────────────────────────────────────────────────

describe('derivedSizesFromSettings', () => {
  it('no enabled platforms → falls back to 9:16 portrait', () => {
    const allDisabled = Object.fromEntries(
      PLATFORM_DEFS.map((p) => [p.id, { enabled: false, aspectRatio: p.defaultRatio }])
    );
    const result = derivedSizesFromSettings(allDisabled);
    expect(result.aspectRatio).toBe('9:16');
    expect(result.imageSize).toBe(RATIO_IMAGE_SIZE['9:16']);
    expect(result.videoDimensions).toBe(RATIO_VIDEO_DIMS['9:16']);
  });

  it('instagram (9:16) enabled → portrait sizes', () => {
    const settings = {
      ...DEFAULT_PLATFORM_SETTINGS,
      instagram: { enabled: true, aspectRatio: '9:16' as AspectRatio },
    };
    const result = derivedSizesFromSettings(settings);
    expect(result.aspectRatio).toBe('9:16');
  });

  it('youtube (16:9) enabled, instagram disabled → landscape sizes', () => {
    const settings = {
      ...DEFAULT_PLATFORM_SETTINGS,
      instagram: { enabled: false, aspectRatio: '9:16' as AspectRatio },
      youtube:   { enabled: true,  aspectRatio: '16:9' as AspectRatio },
    };
    const result = derivedSizesFromSettings(settings);
    expect(result.aspectRatio).toBe('16:9');
    expect(result.imageSize).toBe(RATIO_IMAGE_SIZE['16:9']);
  });

  it('first enabled platform in PLATFORM_DEFS order wins', () => {
    // instagram is first in PLATFORM_DEFS → it wins over tiktok
    const settings = {
      ...DEFAULT_PLATFORM_SETTINGS,
      instagram: { enabled: true, aspectRatio: '9:16' as AspectRatio },
      tiktok:    { enabled: true, aspectRatio: '9:16' as AspectRatio },
      youtube:   { enabled: true, aspectRatio: '16:9' as AspectRatio },
    };
    const result = derivedSizesFromSettings(settings);
    expect(result.aspectRatio).toBe('9:16');
  });

  it('4:3 → landscape image + landscape video', () => {
    const settings = {
      ...DEFAULT_PLATFORM_SETTINGS,
      instagram: { enabled: true, aspectRatio: '4:3' as AspectRatio },
    };
    const result = derivedSizesFromSettings(settings);
    expect(result.aspectRatio).toBe('4:3');
    expect(result.imageSize).toBe(RATIO_IMAGE_SIZE['4:3']);
    expect(result.videoDimensions).toBe(RATIO_VIDEO_DIMS['4:3']);
  });
});
