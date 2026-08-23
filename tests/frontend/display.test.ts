import { describe, it, expect } from 'vitest';
import { MODEL_LABELS, shortModelLabel, formatCost } from '../../frontend/src/lib/display';

// ─── MODEL_LABELS ─────────────────────────────────────────────────────────────

describe('MODEL_LABELS', () => {
  it('covers all known video models', () => {
    const videoModels = [
      'lightricks/ltx-2.3-fast',
      'lightricks/ltx-2.3-pro',
      'bytedance/seedance-2.0',
      'bytedance/seedance-2.0-fast',
      'wan-video/wan-2.7-t2v',
      'wan-video/wan-2.7-i2v',
      'google/veo-2',
    ];
    for (const id of videoModels) {
      expect(MODEL_LABELS[id], `missing label for ${id}`).toBeDefined();
    }
  });

  it('covers all known text models', () => {
    const textModels = ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini'];
    for (const id of textModels) {
      expect(MODEL_LABELS[id], `missing label for ${id}`).toBeDefined();
    }
  });

  it('covers all known image models', () => {
    expect(MODEL_LABELS['gpt-image-1']).toBeDefined();
    expect(MODEL_LABELS['dall-e-3']).toBeDefined();
  });
});

// ─── shortModelLabel ──────────────────────────────────────────────────────────

describe('shortModelLabel', () => {
  it('null → "Unknown model"', () => {
    expect(shortModelLabel(null)).toBe('Unknown model');
  });

  it('known model → label from MODEL_LABELS', () => {
    expect(shortModelLabel('lightricks/ltx-2.3-fast')).toBe('LTX Fast');
    expect(shortModelLabel('google/veo-2')).toBe('Veo 2');
    expect(shortModelLabel('gpt-4o')).toBe('GPT-4o');
  });

  it('unknown namespaced model → last segment after /', () => {
    expect(shortModelLabel('org/some-new-model')).toBe('some-new-model');
  });

  it('unknown non-namespaced model → returned as-is', () => {
    expect(shortModelLabel('dall-e-99')).toBe('dall-e-99');
  });
});

// ─── formatCost ───────────────────────────────────────────────────────────────

describe('formatCost', () => {
  it('null → null', () => {
    expect(formatCost(null)).toBeNull();
  });

  it('zero → null (free / not tracked)', () => {
    expect(formatCost(0)).toBeNull();
  });

  it('negative → null', () => {
    expect(formatCost(-1)).toBeNull();
  });

  it('< $0.001 → "< $0.001"', () => {
    expect(formatCost(0.0005)).toBe('< $0.001');
    expect(formatCost(0.0009)).toBe('< $0.001');
  });

  it('$0.001–$0.009 → 4 decimal places', () => {
    expect(formatCost(0.005)).toBe('$0.0050');
    expect(formatCost(0.0075)).toBe('$0.0075');
  });

  it('$0.01–$0.999 → 3 decimal places', () => {
    expect(formatCost(0.36)).toBe('$0.360');
    expect(formatCost(0.042)).toBe('$0.042');
  });

  it('$1+ → 2 decimal places', () => {
    expect(formatCost(2.70)).toBe('$2.70');
    expect(formatCost(10.40)).toBe('$10.40');
  });

  it('exactly $0.001 → 4 decimal places (not < threshold)', () => {
    expect(formatCost(0.001)).toBe('$0.0010');
  });
});
