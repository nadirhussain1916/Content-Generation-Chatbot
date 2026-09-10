import { describe, it, expect } from 'vitest';
import {
  STITCH_MODES,
  DEFAULT_STITCH_MODE,
  LONG_VIDEO_OPTIONS,
  DEFAULT_LONG_VIDEO,
  STITCH_MAX_CHUNKS,
  MODEL_MAX_CLIP_SECONDS,
  I2V_CAPABLE_MODEL_IDS,
  snapLongVideoOption,
  VIDEO_MODELS,
  type VideoModelId,
} from '../../frontend/src/lib/models';

// Pure frontend helpers for the long-video pickers. No network / API involved.
// These also guard the frontend↔backend parity that the "Length"/"Mode" pickers rely on.

// ─── STITCH_MODES ─────────────────────────────────────────────────────────────

describe('STITCH_MODES', () => {
  it('offers exactly concat + chain, matching the backend', () => {
    expect(STITCH_MODES.map((m) => m.id)).toEqual(['concat', 'chain']);
  });

  it('defaults to concat (fast, parallel)', () => {
    expect(DEFAULT_STITCH_MODE).toBe('concat');
    expect(STITCH_MODES.map((m) => m.id)).toContain(DEFAULT_STITCH_MODE);
  });

  it('every mode has a label and a description', () => {
    for (const m of STITCH_MODES) {
      expect(m.label.length).toBeGreaterThan(0);
      expect(typeof m.desc).toBe('string');
    }
  });
});

// ─── LONG_VIDEO_OPTIONS ───────────────────────────────────────────────────────

describe('LONG_VIDEO_OPTIONS', () => {
  it('starts with the single-clip (no-stitch) option', () => {
    expect(LONG_VIDEO_OPTIONS[0].id).toBe('1');
    expect(DEFAULT_LONG_VIDEO).toBe('1');
  });

  it('every option id is a positive integer within the stitch ceiling', () => {
    for (const o of LONG_VIDEO_OPTIONS) {
      const n = Number(o.id);
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(STITCH_MAX_CHUNKS);
    }
  });

  it('option ids are strictly ascending', () => {
    const nums = LONG_VIDEO_OPTIONS.map((o) => Number(o.id));
    const sorted = [...nums].sort((a, b) => a - b);
    expect(nums).toEqual(sorted);
    expect(new Set(nums).size).toBe(nums.length); // no duplicates
  });
});

// ─── snapLongVideoOption ──────────────────────────────────────────────────────

describe('snapLongVideoOption', () => {
  it('returns an exact match unchanged', () => {
    expect(snapLongVideoOption(2)).toBe('2');
    expect(snapLongVideoOption(8)).toBe('8');
  });

  it('snaps to the nearest offered option', () => {
    expect(snapLongVideoOption(5)).toBe('4'); // 4 and 6 are equidistant → first wins (4)
    expect(snapLongVideoOption(7)).toBe('6');
    expect(snapLongVideoOption(100)).toBe('8'); // clamps to the largest offered
    expect(snapLongVideoOption(1)).toBe('1');
  });

  it('always returns one of the offered ids', () => {
    const ids = LONG_VIDEO_OPTIONS.map((o) => o.id);
    for (const n of [0, 1, 2, 3, 5, 9, 50]) {
      expect(ids).toContain(snapLongVideoOption(n));
    }
  });
});

// ─── MODEL_MAX_CLIP_SECONDS (frontend mirror of backend) ──────────────────────

describe('MODEL_MAX_CLIP_SECONDS', () => {
  it('has an entry for every video model', () => {
    for (const m of VIDEO_MODELS) {
      expect(MODEL_MAX_CLIP_SECONDS[m.id as VideoModelId], `missing max for ${m.id}`).toBeGreaterThan(0);
    }
  });

  it('matches the known per-model ceilings (mirror of backend generationConfig)', () => {
    expect(MODEL_MAX_CLIP_SECONDS['google/veo-2']).toBe(8);
    expect(MODEL_MAX_CLIP_SECONDS['lightricks/ltx-2.3-fast']).toBe(20);
    expect(MODEL_MAX_CLIP_SECONDS['lightricks/ltx-2.3-pro']).toBe(10);
    expect(MODEL_MAX_CLIP_SECONDS['bytedance/seedance-2.0']).toBe(15);
    expect(MODEL_MAX_CLIP_SECONDS['bytedance/seedance-2.0-fast']).toBe(15);
    expect(MODEL_MAX_CLIP_SECONDS['wan-video/wan-2.7-t2v']).toBe(15);
    expect(MODEL_MAX_CLIP_SECONDS['wan-video/wan-2.7-i2v']).toBe(15);
  });
});

// ─── I2V_CAPABLE_MODEL_IDS (which models can be "Seamless"/chained) ───────────

describe('I2V_CAPABLE_MODEL_IDS', () => {
  it('excludes the text-only Wan T2V model', () => {
    expect(I2V_CAPABLE_MODEL_IDS).not.toContain('wan-video/wan-2.7-t2v');
  });

  it('includes every other video model', () => {
    for (const m of VIDEO_MODELS) {
      if (m.id === 'wan-video/wan-2.7-t2v') continue;
      expect(I2V_CAPABLE_MODEL_IDS, `${m.id} should be chain-capable`).toContain(m.id);
    }
    expect(I2V_CAPABLE_MODEL_IDS).toHaveLength(VIDEO_MODELS.length - 1);
  });
});
