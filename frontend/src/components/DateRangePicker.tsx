import { useState } from 'react';
import type { DateRange } from '../lib/api';
import { cn } from '../lib/utils';

const PRESETS = [
  { id: 'all', label: 'All time' },
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
  { id: 'month', label: 'This month' },
  { id: 'custom', label: 'Custom' },
] as const;

type PresetId = (typeof PRESETS)[number]['id'];

const DAY = 86400;

function startOfDaySec(dateStr: string): number {
  const d = new Date(dateStr);
  d.setHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

/** Resolves a preset (+ optional custom dates) to unix-second bounds. */
function resolveRange(preset: PresetId, from?: string, to?: string): DateRange {
  const nowSec = Math.floor(Date.now() / 1000);
  switch (preset) {
    case 'all':
      return {};
    case '7d':
      return { from: nowSec - 7 * DAY, to: nowSec };
    case '30d':
      return { from: nowSec - 30 * DAY, to: nowSec };
    case 'month': {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: Math.floor(start.getTime() / 1000), to: nowSec };
    }
    case 'custom': {
      const range: DateRange = {};
      if (from) range.from = startOfDaySec(from);
      if (to) range.to = startOfDaySec(to) + DAY; // make the end date inclusive
      return range;
    }
  }
}

/**
 * Segmented preset selector (All time / 7d / 30d / This month / Custom).
 * Emits resolved unix-second bounds via onChange; custom reveals two date inputs.
 */
export default function DateRangePicker({
  onChange,
  className,
}: {
  onChange: (range: DateRange) => void;
  className?: string;
}) {
  const [preset, setPreset] = useState<PresetId>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  function selectPreset(id: PresetId) {
    setPreset(id);
    onChange(resolveRange(id, from, to));
  }

  function updateCustom(nextFrom: string, nextTo: string) {
    setFrom(nextFrom);
    setTo(nextTo);
    onChange(resolveRange('custom', nextFrom, nextTo));
  }

  const dateInputClass =
    'bg-surface-white border border-border-soft rounded-lg px-2.5 py-1.5 text-meta text-text-primary focus:outline-none focus:border-ink transition-colors';

  return (
    <div className={cn('flex items-center gap-2 flex-wrap', className)}>
      <div className='flex items-center gap-1 bg-surface-card rounded-full p-1'>
        {PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => selectPreset(p.id)}
            className={cn(
              'px-3 py-1 text-meta font-medium rounded-full transition-all whitespace-nowrap',
              preset === p.id ? 'bg-ink text-on-ink' : 'text-text-secondary hover:text-text-primary'
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      {preset === 'custom' && (
        <div className='flex items-center gap-1.5'>
          <input
            type='date'
            value={from}
            max={to || undefined}
            onChange={(e) => updateCustom(e.target.value, to)}
            className={dateInputClass}
          />
          <span className='text-meta text-text-muted'>to</span>
          <input
            type='date'
            value={to}
            min={from || undefined}
            onChange={(e) => updateCustom(from, e.target.value)}
            className={dateInputClass}
          />
        </div>
      )}
    </div>
  );
}
