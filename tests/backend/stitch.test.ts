import { describe, it, expect } from 'vitest';
import {
  computeChunkPlan,
  resolveContinuePartPrompts,
  MODEL_MAX_CLIP_SECONDS,
  MODEL_VALID_DURATIONS,
  I2V_CAPABLE,
  I2V_MODELS,
  referenceParamFor,
  isStitchMode,
  coerceStitchMode,
  STITCH_MODES,
  STITCH_MIN_CHUNKS,
  STITCH_MAX_CHUNKS,
  VIDEO_MODEL_CONFIGS,
  VIDEO_MODELS,
  type VideoModelId,
} from '../../backend/src/services/generationConfig';
import { calcStitchCost } from '../../backend/src/services/costs';

// These tests cover the long-video "chunk + stitch" logic that runs entirely in the
// Worker (planning, cost, per-model input shaping). No Replicate / OpenAI / sandbox
// calls are involved — it's all pure, deterministic config.

// ─── MODEL_MAX_CLIP_SECONDS ───────────────────────────────────────────────────

describe('MODEL_MAX_CLIP_SECONDS', () => {
  it('is the max of each model’s valid durations', () => {
    for (const id of Object.keys(MODEL_VALID_DURATIONS) as VideoModelId[]) {
      expect(MODEL_MAX_CLIP_SECONDS[id]).toBe(Math.max(...MODEL_VALID_DURATIONS[id]));
    }
  });

  it('matches the known per-model ceilings', () => {
    expect(MODEL_MAX_CLIP_SECONDS['google/veo-2']).toBe(8);
    expect(MODEL_MAX_CLIP_SECONDS['lightricks/ltx-2.3-fast']).toBe(20);
    expect(MODEL_MAX_CLIP_SECONDS['lightricks/ltx-2.3-pro']).toBe(10);
    expect(MODEL_MAX_CLIP_SECONDS['bytedance/seedance-2.0']).toBe(15);
    expect(MODEL_MAX_CLIP_SECONDS['wan-video/wan-2.7-i2v']).toBe(15);
  });
});

// ─── computeChunkPlan ─────────────────────────────────────────────────────────

describe('computeChunkPlan', () => {
  it('splits the target across max-length chunks (LTX Fast: 60s → 3×20s)', () => {
    expect(computeChunkPlan('lightricks/ltx-2.3-fast', 60)).toEqual({
      chunkDuration: 20,
      chunkCount: 3,
      reachableSeconds: 60,
      capped: false,
    });
  });

  it('rounds the chunk count up to cover the target (Veo: 60s → 8×8s = 64s)', () => {
    expect(computeChunkPlan('google/veo-2', 60)).toEqual({
      chunkDuration: 8,
      chunkCount: 8,
      reachableSeconds: 64,
      capped: false,
    });
  });

  it('uses a single chunk when the target fits in one clip', () => {
    expect(computeChunkPlan('lightricks/ltx-2.3-fast', 5)).toEqual({
      chunkDuration: 20,
      chunkCount: 1,
      reachableSeconds: 20,
      capped: false,
    });
  });

  it('clamps to STITCH_MAX_CHUNKS and flags capped when the target is unreachable', () => {
    const plan = computeChunkPlan('google/veo-2', 1000);
    expect(plan.chunkCount).toBe(STITCH_MAX_CHUNKS);
    expect(plan.chunkDuration).toBe(8);
    expect(plan.reachableSeconds).toBe(STITCH_MAX_CHUNKS * 8);
    expect(plan.capped).toBe(true);
  });

  it('falls back to a 5s chunk for an unknown model', () => {
    expect(computeChunkPlan('made/up-model' as VideoModelId, 20)).toEqual({
      chunkDuration: 5,
      chunkCount: 4,
      reachableSeconds: 20,
      capped: false,
    });
  });
});

// ─── resolveContinuePartPrompts ───────────────────────────────────────────────
// Shared by the /continue route and the stitch workflow so both agree on the exact
// per-part segments an agent-planned (or manual) continuation will generate.

describe('resolveContinuePartPrompts', () => {
  it('uses the storyboard verbatim and its length drives the part count', () => {
    const parts = ['she turns to the door', 'she walks out into the rain', 'cut to morning'];
    expect(resolveContinuePartPrompts(parts, 'fallback', 1)).toEqual(parts);
  });

  it('trims blanks and whitespace from the storyboard', () => {
    expect(resolveContinuePartPrompts(['  a  ', '', '   ', 'b'], 'fallback', 5)).toEqual(['a', 'b']);
  });

  it('caps the storyboard at STITCH_MAX_CHUNKS', () => {
    const many = Array.from({ length: STITCH_MAX_CHUNKS + 5 }, (_, i) => `part ${i}`);
    expect(resolveContinuePartPrompts(many, 'fallback', 1)).toHaveLength(STITCH_MAX_CHUNKS);
  });

  it('repeats the single prompt chunkCount times when there is no storyboard', () => {
    expect(resolveContinuePartPrompts(undefined, 'next part', 3)).toEqual(['next part', 'next part', 'next part']);
    expect(resolveContinuePartPrompts([], 'next part', 2)).toEqual(['next part', 'next part']);
  });

  it('clamps a missing/absurd chunkCount into [1, STITCH_MAX_CHUNKS]', () => {
    expect(resolveContinuePartPrompts(undefined, 'p', 0)).toEqual(['p']);
    expect(resolveContinuePartPrompts(undefined, 'p', -4)).toEqual(['p']);
    expect(resolveContinuePartPrompts(undefined, 'p', 999)).toHaveLength(STITCH_MAX_CHUNKS);
  });
});

// ─── I2V_CAPABLE ──────────────────────────────────────────────────────────────

describe('I2V_CAPABLE', () => {
  it('includes every model except the text-only Wan T2V', () => {
    expect(I2V_CAPABLE.has('wan-video/wan-2.7-t2v')).toBe(false);
    for (const id of VIDEO_MODELS) {
      if (id === 'wan-video/wan-2.7-t2v') continue;
      expect(I2V_CAPABLE.has(id), `${id} should be chain-capable`).toBe(true);
    }
  });

  it('has exactly one fewer entry than the full model list', () => {
    expect(I2V_CAPABLE.size).toBe(VIDEO_MODELS.length - 1);
  });
});

// ─── referenceParamFor ────────────────────────────────────────────────────────

describe('referenceParamFor', () => {
  it('maps each model to its starting-frame input field', () => {
    // veo-2's Replicate schema uses `image` (there is no `image_url` field) — verified
    // against https://replicate.com/google/veo-2/api/schema.
    expect(referenceParamFor('google/veo-2')).toBe('image');
    expect(referenceParamFor('wan-video/wan-2.7-i2v')).toBe('first_frame');
    expect(referenceParamFor('lightricks/ltx-2.3-fast')).toBe('image');
    expect(referenceParamFor('lightricks/ltx-2.3-pro')).toBe('image');
    expect(referenceParamFor('bytedance/seedance-2.0')).toBe('image');
  });

  it('returns null for the text-only Wan T2V model', () => {
    expect(referenceParamFor('wan-video/wan-2.7-t2v')).toBeNull();
  });
});

// ─── VIDEO_MODEL_CONFIGS.buildInput ───────────────────────────────────────────

describe('VIDEO_MODEL_CONFIGS.buildInput', () => {
  const REF = 'https://cdn.example.com/frame.png';

  it('always carries prompt / aspect_ratio / duration', () => {
    for (const id of VIDEO_MODELS) {
      const input = VIDEO_MODEL_CONFIGS[id].buildInput('a cat', '9:16', 6);
      expect(input.prompt).toBe('a cat');
      expect(input.aspect_ratio).toBe('9:16');
      expect(input.duration).toBe(6);
    }
  });

  it('places the reference image under the field reported by referenceParamFor', () => {
    for (const id of VIDEO_MODELS) {
      const field = referenceParamFor(id);
      const input = VIDEO_MODEL_CONFIGS[id].buildInput('p', '16:9', 8, REF);
      if (field) {
        expect(input[field], `${id} should map ref → ${field}`).toBe(REF);
      } else {
        // text-only model ignores the reference entirely
        expect(input.image).toBeUndefined();
        expect(input.image_url).toBeUndefined();
        expect(input.first_frame).toBeUndefined();
      }
    }
  });

  it('omits the reference field when no reference image is given', () => {
    for (const id of VIDEO_MODELS) {
      const input = VIDEO_MODEL_CONFIGS[id].buildInput('p', '9:16', 6);
      expect(input.image).toBeUndefined();
      expect(input.image_url).toBeUndefined();
      expect(input.first_frame).toBeUndefined();
    }
  });

  it('Wan models pin resolution to 720p', () => {
    expect(VIDEO_MODEL_CONFIGS['wan-video/wan-2.7-t2v'].buildInput('p', '9:16', 5).resolution).toBe('720p');
    expect(VIDEO_MODEL_CONFIGS['wan-video/wan-2.7-i2v'].buildInput('p', '9:16', 5, REF).resolution).toBe('720p');
  });

  it('LTX-Pro switches to image_to_video only when a reference frame is present', () => {
    // With a seed frame → must set task=image_to_video, else LTX-Pro stays in its
    // default text_to_video mode and silently ignores the frame (breaks chaining).
    const i2v = VIDEO_MODEL_CONFIGS['lightricks/ltx-2.3-pro'].buildInput('p', '16:9', 8, REF);
    expect(i2v.task).toBe('image_to_video');
    expect(i2v.image).toBe(REF);

    // Without a seed frame → no task (defaults to text_to_video); don't force i2v.
    const t2v = VIDEO_MODEL_CONFIGS['lightricks/ltx-2.3-pro'].buildInput('p', '16:9', 8);
    expect(t2v.task).toBeUndefined();

    // LTX-Fast has NO task field at all — the mock rejects it — so never set one.
    const fast = VIDEO_MODEL_CONFIGS['lightricks/ltx-2.3-fast'].buildInput('p', '16:9', 8, REF);
    expect(fast.task).toBeUndefined();
  });
});

// ─── Stitch mode + bounds ─────────────────────────────────────────────────────

describe('isStitchMode / bounds', () => {
  it('accepts the two supported modes', () => {
    expect(isStitchMode('concat')).toBe(true);
    expect(isStitchMode('chain')).toBe(true);
    expect(STITCH_MODES).toEqual(['concat', 'chain']);
  });

  it('rejects anything else', () => {
    expect(isStitchMode('blend')).toBe(false);
    expect(isStitchMode(undefined)).toBe(false);
    expect(isStitchMode(2)).toBe(false);
  });

  it('exposes a sane chunk-count range', () => {
    expect(STITCH_MIN_CHUNKS).toBe(2);
    expect(STITCH_MAX_CHUNKS).toBe(20);
    expect(STITCH_MIN_CHUNKS).toBeLessThan(STITCH_MAX_CHUNKS);
  });
});

// ─── calcStitchCost ───────────────────────────────────────────────────────────

describe('calcStitchCost', () => {
  it('is per-clip cost × chunk count (LTX Fast: $0.06/s × 20s × 3 = $3.60)', () => {
    expect(calcStitchCost('lightricks/ltx-2.3-fast', 20, 3)).toBeCloseTo(3.60);
  });

  it('scales linearly with chunk count (Veo: $0.50/s × 8s × 4 = $16.00)', () => {
    expect(calcStitchCost('google/veo-2', 8, 4)).toBeCloseTo(16.0);
  });

  it('matches computeChunkPlan output for an end-to-end estimate', () => {
    const plan = computeChunkPlan('lightricks/ltx-2.3-fast', 60); // 3 × 20s
    // $0.06/s × 20s × 3 chunks = $3.60
    expect(calcStitchCost('lightricks/ltx-2.3-fast', plan.chunkDuration, plan.chunkCount)).toBeCloseTo(3.60);
  });

  it('returns 0 for an unknown model', () => {
    expect(calcStitchCost('some/unknown-model', 10, 3)).toBe(0);
  });

  it('returns 0 when there are no chunks', () => {
    expect(calcStitchCost('google/veo-2', 8, 0)).toBe(0);
  });
});

// ─── coerceStitchMode ─────────────────────────────────────────────────────────
// The capability guard that prevents dispatching an impossible model/mode combo
// (the Wan 2.7 I2V "first_frame required" failure). Pure, deterministic.

describe('coerceStitchMode', () => {
  it('keeps chain for an ambidextrous model (LTX can seed each chunk)', () => {
    expect(coerceStitchMode('lightricks/ltx-2.3-fast', 'chain')).toBe('chain');
  });

  it('keeps concat for an ambidextrous model', () => {
    expect(coerceStitchMode('lightricks/ltx-2.3-fast', 'concat')).toBe('concat');
  });

  it('forces concat when a text-only model is asked to chain (can’t take a seed frame)', () => {
    expect(coerceStitchMode('wan-video/wan-2.7-t2v', 'chain')).toBe('concat');
  });

  it('forces chain when an image-to-video-only model is asked to concat', () => {
    // Wan 2.7 I2V can only seed chunk 0 in concat → chunks 1+ fail. Chain seeds all.
    expect(coerceStitchMode('wan-video/wan-2.7-i2v', 'concat')).toBe('chain');
  });

  it('keeps chain for an image-to-video-only model (its only viable mode)', () => {
    expect(coerceStitchMode('wan-video/wan-2.7-i2v', 'chain')).toBe('chain');
  });

  it('never yields a mode the model cannot run, for every model × mode', () => {
    for (const id of VIDEO_MODELS) {
      for (const requested of STITCH_MODES) {
        const got = coerceStitchMode(id, requested);
        // text-only ⇒ never chain; i2v-only ⇒ never concat
        if (!I2V_CAPABLE.has(id)) expect(got).toBe('concat');
        if (I2V_MODELS.has(id)) expect(got).toBe('chain');
      }
    }
  });
});
