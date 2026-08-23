import { describe, it, expect } from 'vitest';
import {
  calcTextCost,
  calcImageCost,
  calcVideoClipCost,
  calcLtxChainCost,
} from '../../backend/src/services/costs';

// ─── calcTextCost ─────────────────────────────────────────────────────────────

describe('calcTextCost', () => {
  it('gpt-4o: $2.50 input + $10.00 output per 1M tokens', () => {
    // (1000 × 2.50 + 500 × 10.00) / 1_000_000 = 0.0075
    expect(calcTextCost('gpt-4o', 1000, 500)).toBeCloseTo(0.0075, 6);
  });

  it('gpt-4o-mini: cheapest rate', () => {
    // (1_000_000 × 0.15 + 1_000_000 × 0.60) / 1_000_000 = 0.75
    expect(calcTextCost('gpt-4o-mini', 1_000_000, 1_000_000)).toBeCloseTo(0.75, 6);
  });

  it('gpt-4.1: $2.00 input + $8.00 output per 1M tokens', () => {
    // (500 × 2.00 + 200 × 8.00) / 1_000_000 = 0.0026
    expect(calcTextCost('gpt-4.1', 500, 200)).toBeCloseTo(0.0026, 6);
  });

  it('gpt-4.1-mini: $0.40 input + $1.60 output per 1M tokens', () => {
    // (1000 × 0.40 + 1000 × 1.60) / 1_000_000 = 0.002
    expect(calcTextCost('gpt-4.1-mini', 1000, 1000)).toBeCloseTo(0.002, 6);
  });

  it('unknown model returns 0', () => {
    expect(calcTextCost('gpt-99-ultra', 10_000, 5_000)).toBe(0);
  });

  it('zero tokens returns 0', () => {
    expect(calcTextCost('gpt-4o', 0, 0)).toBe(0);
  });

  it('input-only charge (0 output tokens)', () => {
    // 1_000_000 × 2.50 / 1_000_000 = 2.50
    expect(calcTextCost('gpt-4o', 1_000_000, 0)).toBeCloseTo(2.50, 6);
  });
});

// ─── calcImageCost ────────────────────────────────────────────────────────────

describe('calcImageCost', () => {
  it('dall-e-3: flat $0.04 for any size', () => {
    expect(calcImageCost('dall-e-3', '1024x1024')).toBe(0.04);
    expect(calcImageCost('dall-e-3', '1024x1792')).toBe(0.04);
    expect(calcImageCost('dall-e-3', '1792x1024')).toBe(0.04);
  });

  it('gpt-image-1 square (1024×1024): $0.042', () => {
    expect(calcImageCost('gpt-image-1', '1024x1024')).toBe(0.042);
  });

  it('gpt-image-1 portrait (1024×1792): $0.063', () => {
    expect(calcImageCost('gpt-image-1', '1024x1792')).toBe(0.063);
  });

  it('gpt-image-1 landscape (1792×1024): $0.063', () => {
    expect(calcImageCost('gpt-image-1', '1792x1024')).toBe(0.063);
  });

  it('unknown model returns 0', () => {
    expect(calcImageCost('flux-dev', '1024x1024')).toBe(0);
  });
});

// ─── calcVideoClipCost ────────────────────────────────────────────────────────

describe('calcVideoClipCost', () => {
  it('ltx-2.3-fast: $0.06/s × 6s = $0.36', () => {
    expect(calcVideoClipCost('lightricks/ltx-2.3-fast', 6)).toBeCloseTo(0.36);
  });

  it('ltx-2.3-fast: $0.06/s × 20s = $1.20', () => {
    expect(calcVideoClipCost('lightricks/ltx-2.3-fast', 20)).toBeCloseTo(1.20);
  });

  it('ltx-2.3-pro: $0.08/s × 10s = $0.80', () => {
    expect(calcVideoClipCost('lightricks/ltx-2.3-pro', 10)).toBeCloseTo(0.80);
  });

  it('seedance-2.0: $0.18/s × 15s = $2.70', () => {
    expect(calcVideoClipCost('bytedance/seedance-2.0', 15)).toBeCloseTo(2.70);
  });

  it('seedance-2.0-fast: $0.10/s × 8s = $0.80', () => {
    expect(calcVideoClipCost('bytedance/seedance-2.0-fast', 8)).toBeCloseTo(0.80);
  });

  it('wan-2.7-t2v: $0.09/s × 10s = $0.90', () => {
    expect(calcVideoClipCost('wan-video/wan-2.7-t2v', 10)).toBeCloseTo(0.90);
  });

  it('wan-2.7-i2v: same rate as t2v', () => {
    expect(calcVideoClipCost('wan-video/wan-2.7-i2v', 10)).toBeCloseTo(0.90);
  });

  it('veo-2: $0.50/s × 8s = $4.00', () => {
    expect(calcVideoClipCost('google/veo-2', 8)).toBeCloseTo(4.00);
  });

  it('zero duration returns 0', () => {
    expect(calcVideoClipCost('google/veo-2', 0)).toBe(0);
  });

  it('unknown model returns 0', () => {
    expect(calcVideoClipCost('some/unknown-model', 10)).toBe(0);
  });
});

// ─── calcLtxChainCost ─────────────────────────────────────────────────────────

describe('calcLtxChainCost', () => {
  it('single clip (chainCount=0): 10s at $0.08/s = $0.80', () => {
    expect(calcLtxChainCost('lightricks/ltx-2.3-pro', 10, 0, 0)).toBeCloseTo(0.80);
  });

  it('~30s option: 10 + 1×20 = 30s at $0.08/s = $2.40', () => {
    expect(calcLtxChainCost('lightricks/ltx-2.3-pro', 10, 1, 20)).toBeCloseTo(2.40);
  });

  it('~45s option: 10 + 5×7 = 45s at $0.08/s = $3.60', () => {
    expect(calcLtxChainCost('lightricks/ltx-2.3-pro', 10, 5, 7)).toBeCloseTo(3.60);
  });

  it('~50s option: 10 + 2×20 = 50s at $0.08/s = $4.00', () => {
    expect(calcLtxChainCost('lightricks/ltx-2.3-pro', 10, 2, 20)).toBeCloseTo(4.00);
  });

  it('~130s option: 10 + 6×20 = 130s at $0.08/s = $10.40', () => {
    expect(calcLtxChainCost('lightricks/ltx-2.3-pro', 10, 6, 20)).toBeCloseTo(10.40);
  });

  it('delegates rate lookup to calcVideoClipCost (ltx-fast rate)', () => {
    // 10 + 1×10 = 20s at $0.06/s = $1.20
    expect(calcLtxChainCost('lightricks/ltx-2.3-fast', 10, 1, 10)).toBeCloseTo(1.20);
  });
});
