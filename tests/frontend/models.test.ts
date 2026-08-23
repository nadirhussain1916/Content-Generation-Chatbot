import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  TEXT_MODELS,
  IMAGE_MODELS,
  VIDEO_MODELS,
  DEFAULT_TEXT_MODEL,
  DEFAULT_IMAGE_MODEL,
  DEFAULT_VIDEO_MODEL,
  DEFAULT_VIDEO_ASPECT_RATIO,
  VIDEO_DURATIONS,
  DEFAULT_VIDEO_DURATIONS,
  LTX_EXTEND_OPTIONS,
  IMAGE_MODEL_REF_CAPS,
  VIDEO_MODEL_REF_CAPS,
  ASPECT_RATIO_MODEL_IDS,
  DURATION_MODEL_IDS,
  TEXT_MODEL_KEY,
  IMAGE_MODEL_KEY,
  VIDEO_MODEL_KEY,
  readPref,
  writePref,
  type VideoModelId,
} from '../../frontend/src/lib/models';

// ─── Static model lists ───────────────────────────────────────────────────────

describe('TEXT_MODELS', () => {
  it('contains gpt-4o and gpt-4o-mini', () => {
    const ids = TEXT_MODELS.map((m) => m.id);
    expect(ids).toContain('gpt-4o');
    expect(ids).toContain('gpt-4o-mini');
  });

  it('DEFAULT_TEXT_MODEL is in TEXT_MODELS', () => {
    expect(TEXT_MODELS.map((m) => m.id)).toContain(DEFAULT_TEXT_MODEL);
  });
});

describe('IMAGE_MODELS', () => {
  it('contains gpt-image-1 and dall-e-3', () => {
    const ids = IMAGE_MODELS.map((m) => m.id);
    expect(ids).toContain('gpt-image-1');
    expect(ids).toContain('dall-e-3');
  });

  it('DEFAULT_IMAGE_MODEL is in IMAGE_MODELS', () => {
    expect(IMAGE_MODELS.map((m) => m.id)).toContain(DEFAULT_IMAGE_MODEL);
  });
});

describe('VIDEO_MODELS', () => {
  it('contains all 7 video models', () => {
    expect(VIDEO_MODELS).toHaveLength(7);
  });

  it('DEFAULT_VIDEO_MODEL is in VIDEO_MODELS', () => {
    expect(VIDEO_MODELS.map((m) => m.id)).toContain(DEFAULT_VIDEO_MODEL);
  });

  it('DEFAULT_VIDEO_ASPECT_RATIO is 9:16', () => {
    expect(DEFAULT_VIDEO_ASPECT_RATIO).toBe('9:16');
  });
});

// ─── VIDEO_DURATIONS ──────────────────────────────────────────────────────────

describe('VIDEO_DURATIONS', () => {
  it('every video model has a duration list', () => {
    for (const model of VIDEO_MODELS) {
      expect(VIDEO_DURATIONS[model.id], `missing durations for ${model.id}`).toBeDefined();
      expect(VIDEO_DURATIONS[model.id].length).toBeGreaterThan(0);
    }
  });

  it('every video model has a default duration', () => {
    for (const model of VIDEO_MODELS) {
      expect(DEFAULT_VIDEO_DURATIONS[model.id], `missing default for ${model.id}`).toBeDefined();
    }
  });

  it('default duration exists in the duration list for each model', () => {
    for (const model of VIDEO_MODELS) {
      const id = model.id as VideoModelId;
      const def = DEFAULT_VIDEO_DURATIONS[id];
      const options = VIDEO_DURATIONS[id].map((d) => d.id);
      expect(options, `${id}: default "${def}" not in list`).toContain(def);
    }
  });

  it('veo-2 max duration is 8s', () => {
    const ids = VIDEO_DURATIONS['google/veo-2'].map((d) => Number(d.id));
    expect(Math.max(...ids)).toBe(8);
  });

  it('ltx-2.3-fast max duration is 20s', () => {
    const ids = VIDEO_DURATIONS['lightricks/ltx-2.3-fast'].map((d) => Number(d.id));
    expect(Math.max(...ids)).toBe(20);
  });

  it('seedance and wan support up to 15s', () => {
    for (const id of ['bytedance/seedance-2.0', 'wan-video/wan-2.7-t2v'] as VideoModelId[]) {
      const ids = VIDEO_DURATIONS[id].map((d) => Number(d.id));
      expect(Math.max(...ids)).toBe(15);
    }
  });
});

// ─── LTX_EXTEND_OPTIONS ───────────────────────────────────────────────────────

describe('LTX_EXTEND_OPTIONS', () => {
  it('single-clip option has chainCount=0', () => {
    const single = LTX_EXTEND_OPTIONS.find((o) => o.id === '0');
    expect(single).toBeDefined();
    expect(single!.chainCount).toBe(0);
  });

  it('total duration = initialDuration + chainCount × extendDuration', () => {
    const INITIAL = 10;
    for (const opt of LTX_EXTEND_OPTIONS) {
      const total = INITIAL + opt.chainCount * opt.extendDuration;
      // Label says "~Xs" — allow ±2s tolerance for named presets
      if (opt.id !== '0') {
        expect(total, `${opt.label}: total should be ~${opt.id}s`).toBeGreaterThan(0);
      }
    }
  });

  it('~45s option uses 5 chains of 7s each (short Reels-friendly)', () => {
    const opt = LTX_EXTEND_OPTIONS.find((o) => o.id === '45');
    expect(opt).toBeDefined();
    expect(opt!.chainCount).toBe(5);
    expect(opt!.extendDuration).toBe(7);
  });
});

// ─── Reference caps ───────────────────────────────────────────────────────────

describe('IMAGE_MODEL_REF_CAPS', () => {
  it('gpt-image-1 supports 1 reference', () => {
    expect(IMAGE_MODEL_REF_CAPS['gpt-image-1']).toBe(1);
  });

  it('dall-e-3 supports 1 reference (inspire mode)', () => {
    expect(IMAGE_MODEL_REF_CAPS['dall-e-3']).toBe(1);
  });
});

describe('VIDEO_MODEL_REF_CAPS', () => {
  it('wan-2.7-t2v supports 0 references (text-only)', () => {
    expect(VIDEO_MODEL_REF_CAPS['wan-video/wan-2.7-t2v']).toBe(0);
  });

  it('all other video models support at least 1 reference', () => {
    for (const model of VIDEO_MODELS) {
      if (model.id === 'wan-video/wan-2.7-t2v') continue;
      expect(VIDEO_MODEL_REF_CAPS[model.id as VideoModelId]).toBeGreaterThanOrEqual(1);
    }
  });

  it('every video model has a ref cap entry', () => {
    for (const model of VIDEO_MODELS) {
      expect(VIDEO_MODEL_REF_CAPS[model.id as VideoModelId], `missing cap for ${model.id}`).toBeDefined();
    }
  });
});

// ─── Capability flags ─────────────────────────────────────────────────────────

describe('ASPECT_RATIO_MODEL_IDS / DURATION_MODEL_IDS', () => {
  it('all video models are in ASPECT_RATIO_MODEL_IDS', () => {
    for (const model of VIDEO_MODELS) {
      expect(ASPECT_RATIO_MODEL_IDS).toContain(model.id);
    }
  });

  it('all video models are in DURATION_MODEL_IDS', () => {
    for (const model of VIDEO_MODELS) {
      expect(DURATION_MODEL_IDS).toContain(model.id);
    }
  });
});

// ─── readPref / writePref (in-memory localStorage stub) ──────────────────────

describe('readPref / writePref', () => {
  const store: Record<string, string> = {};

  beforeEach(() => {
    Object.keys(store).forEach((k) => delete store[k]);
    vi.stubGlobal('localStorage', {
      getItem:    (key: string) => store[key] ?? null,
      setItem:    (key: string, value: string) => { store[key] = value; },
      removeItem: (key: string) => { delete store[key]; },
      clear:      () => { Object.keys(store).forEach((k) => delete store[k]); },
      get length() { return Object.keys(store).length; },
      key:        (i: number) => Object.keys(store)[i] ?? null,
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('readPref returns fallback when key is absent', () => {
    expect(readPref(TEXT_MODEL_KEY, DEFAULT_TEXT_MODEL)).toBe(DEFAULT_TEXT_MODEL);
  });

  it('writePref + readPref round-trips a value', () => {
    writePref(IMAGE_MODEL_KEY, 'dall-e-3');
    expect(readPref(IMAGE_MODEL_KEY, DEFAULT_IMAGE_MODEL)).toBe('dall-e-3');
  });

  it('writePref + readPref for video model', () => {
    writePref(VIDEO_MODEL_KEY, 'google/veo-2');
    expect(readPref(VIDEO_MODEL_KEY, DEFAULT_VIDEO_MODEL)).toBe('google/veo-2');
  });

  it('overwriting a key returns the latest value', () => {
    writePref(TEXT_MODEL_KEY, 'gpt-4o');
    writePref(TEXT_MODEL_KEY, 'gpt-4.1');
    expect(readPref(TEXT_MODEL_KEY, DEFAULT_TEXT_MODEL)).toBe('gpt-4.1');
  });
});
