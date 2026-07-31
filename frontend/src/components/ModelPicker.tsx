import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { cn } from '../lib/utils';

interface ModelOption<T extends string = string> {
  id: T;
  label: string;
  desc: string;
}

interface ModelPickerProps<T extends string = string> {
  options: readonly ModelOption<T>[];
  value: T;
  onChange: (id: T) => void;
  className?: string;
}

export default function ModelPicker<T extends string = string>({ options, value, onChange, className }: ModelPickerProps<T>) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const current = options.find((o) => o.id === value) ?? options[0];

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type='button'
        onClick={() => setOpen((p) => !p)}
        className='flex items-center gap-1 text-meta text-text-muted hover:text-text-primary transition-colors px-1.5 py-0.5 rounded-lg hover:bg-surface-card'
      >
        <span className='font-medium'>{current.label}</span>
        <ChevronDown size={11} className={cn('transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className='absolute bottom-full mb-1 left-0 z-50 min-w-[200px] bg-surface-white border border-border-soft rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.08)] overflow-hidden'>
          {options.map((opt) => (
            <button
              key={opt.id}
              type='button'
              onClick={() => { onChange(opt.id); setOpen(false); }}
              className={cn(
                'w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-surface-card transition-colors gap-3',
                opt.id === value ? 'text-text-primary' : 'text-text-secondary'
              )}
            >
              <div>
                <p className='text-meta font-medium leading-none mb-0.5'>{opt.label}</p>
                <p className='text-meta text-text-muted'>{opt.desc}</p>
              </div>
              {opt.id === value && <Check size={13} className='text-ink flex-shrink-0' />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
