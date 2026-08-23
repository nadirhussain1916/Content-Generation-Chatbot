// ─── Display helpers ──────────────────────────────────────────────────────────
// Extracted so they can be imported by both page components and the test suite.

export const MODEL_LABELS: Record<string, string> = {
  'lightricks/ltx-2.3-fast':    'LTX Fast',
  'lightricks/ltx-2.3-pro':     'LTX Pro',
  'bytedance/seedance-2.0':     'Seedance 2.0',
  'bytedance/seedance-2.0-fast': 'Seedance Fast',
  'wan-video/wan-2.7-t2v':      'Wan T2V',
  'wan-video/wan-2.7-i2v':      'Wan I2V',
  'google/veo-2':               'Veo 2',
  'gpt-image-1':                'GPT Image 1',
  'dall-e-3':                   'DALL-E 3',
  'gpt-4o':                     'GPT-4o',
  'gpt-4o-mini':                'GPT-4o mini',
  'gpt-4.1':                    'GPT-4.1',
  'gpt-4.1-mini':               'GPT-4.1 mini',
};

export function shortModelLabel(model: string | null): string {
  if (!model) return 'Unknown model';
  return MODEL_LABELS[model] ?? model.split('/').pop() ?? model;
}

export function formatCost(cost: number | null): string | null {
  if (cost == null || cost <= 0) return null;
  if (cost < 0.001) return `< $0.001`;
  if (cost < 0.01)  return `$${cost.toFixed(4)}`;
  if (cost < 1)     return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}
