import { describe, it, expect } from 'vitest';
import {
  coerceImageModel,
  coerceImageSize,
  coerceGenerationMode,
  coerceVideoModel,
  coerceVideoAspectRatio,
  snapDuration,
  DEFAULT_IMAGE_MODEL,
  DEFAULT_IMAGE_SIZE,
  DEFAULT_GENERATION_MODE,
  DEFAULT_VIDEO_MODEL,
  DEFAULT_VIDEO_ASPECT_RATIO,
  I2V_MODELS,
} from '../../backend/src/services/generationConfig';

// ─── coerceImageModel ─────────────────────────────────────────────────────────

describe('coerceImageModel', () => {
  it('passes a valid model through with no warning', () => {
    expect(coerceImageModel('gpt-image-2')).toEqual({ value: 'gpt-image-2' });
  });

  it('falls back silently when absent', () => {
    expect(coerceImageModel(undefined)).toEqual({ value: DEFAULT_IMAGE_MODEL });
  });

  it('falls back WITH a warning for an unknown model (e.g. the removed dall-e-3)', () => {
    const r = coerceImageModel('dall-e-3');
    expect(r.value).toBe(DEFAULT_IMAGE_MODEL);
    expect(r.warning).toContain('dall-e-3');
  });
});

// ─── coerceImageSize ──────────────────────────────────────────────────────────

describe('coerceImageSize', () => {
  it('accepts the three standard sizes', () => {
    expect(coerceImageSize('1024x1024').value).toBe('1024x1024');
    expect(coerceImageSize('1024x1792').value).toBe('1024x1792');
    expect(coerceImageSize('1792x1024').value).toBe('1792x1024');
  });

  it('coerces a custom/invalid size back to the default with a warning', () => {
    const r = coerceImageSize('999x999');
    expect(r.value).toBe(DEFAULT_IMAGE_SIZE);
    expect(r.warning).toContain('999x999');
  });
});

// ─── coerceGenerationMode ─────────────────────────────────────────────────────

describe('coerceGenerationMode', () => {
  it('accepts edit and inspire', () => {
    expect(coerceGenerationMode('edit').value).toBe('edit');
    expect(coerceGenerationMode('inspire').value).toBe('inspire');
  });

  it('defaults to inspire when absent (no warning)', () => {
    expect(coerceGenerationMode(undefined)).toEqual({ value: DEFAULT_GENERATION_MODE });
    expect(DEFAULT_GENERATION_MODE).toBe('inspire');
  });

  it('warns on an invalid mode', () => {
    const r = coerceGenerationMode('remix');
    expect(r.value).toBe('inspire');
    expect(r.warning).toContain('remix');
  });
});

// ─── coerceVideoModel ─────────────────────────────────────────────────────────

describe('coerceVideoModel', () => {
  it('passes valid replicate model slugs through', () => {
    expect(coerceVideoModel('google/veo-2').value).toBe('google/veo-2');
    expect(coerceVideoModel('wan-video/wan-2.7-i2v').value).toBe('wan-video/wan-2.7-i2v');
  });

  it('falls back to the default model with a warning for an unknown slug', () => {
    const r = coerceVideoModel('sora-9000');
    expect(r.value).toBe(DEFAULT_VIDEO_MODEL);
    expect(r.warning).toContain('sora-9000');
  });
});

// ─── coerceVideoAspectRatio ───────────────────────────────────────────────────

describe('coerceVideoAspectRatio', () => {
  it('accepts 9:16 and 16:9', () => {
    expect(coerceVideoAspectRatio('9:16').value).toBe('9:16');
    expect(coerceVideoAspectRatio('16:9').value).toBe('16:9');
  });

  it('defaults for an unsupported ratio', () => {
    const r = coerceVideoAspectRatio('4:3');
    expect(r.value).toBe(DEFAULT_VIDEO_ASPECT_RATIO);
    expect(r.warning).toContain('4:3');
  });
});

// ─── snapDuration ─────────────────────────────────────────────────────────────

describe('snapDuration', () => {
  it('leaves a valid duration untouched (no warning)', () => {
    expect(snapDuration('lightricks/ltx-2.3-pro', 8)).toEqual({ value: 8 });
  });

  it('snaps to the nearest allowed value with a warning (LTX Pro only allows 6/8/10)', () => {
    const r = snapDuration('lightricks/ltx-2.3-pro', 20);
    expect(r.value).toBe(10);
    expect(r.warning).toContain('20s');
  });

  it('snaps a low request up to the nearest allowed value', () => {
    const r = snapDuration('wan-video/wan-2.7-t2v', 1);
    expect(r.value).toBe(2);
  });

  it('passes through unknown models unchanged', () => {
    expect(snapDuration('unknown/model', 42)).toEqual({ value: 42 });
  });
});

// ─── I2V_MODELS ───────────────────────────────────────────────────────────────

describe('I2V_MODELS', () => {
  it('flags wan i2v as requiring a reference frame, and t2v as not', () => {
    expect(I2V_MODELS.has('wan-video/wan-2.7-i2v')).toBe(true);
    expect(I2V_MODELS.has('wan-video/wan-2.7-t2v')).toBe(false);
  });
});
