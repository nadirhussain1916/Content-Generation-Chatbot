import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { cn } from '../lib/utils';

interface ModelOption {
  id: string;
  label: string;
  desc: string;
}

interface ModelPickerProps {
  options: readonly ModelOption[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
}

export default function ModelPicker({ options, value, onChange, className }: ModelPickerProps) {
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
        className='flex items-center gap-1 text-xs text-gray-400 hover:text-gray-200 transition-colors px-1.5 py-0.5 rounded hover:bg-gray-800'
      >
        <span className='font-medium'>{current.label}</span>
        <ChevronDown size={11} className={cn('transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className='absolute bottom-full mb-1 left-0 z-50 min-w-[200px] bg-gray-900 border border-gray-700 rounded-xl shadow-2xl overflow-hidden'>
          {options.map((opt) => (
            <button
              key={opt.id}
              type='button'
              onClick={() => { onChange(opt.id); setOpen(false); }}
              className={cn(
                'w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-gray-800 transition-colors gap-3',
                opt.id === value ? 'text-white' : 'text-gray-300'
              )}
            >
              <div>
                <p className='text-xs font-medium leading-none mb-0.5'>{opt.label}</p>
                <p className='text-xs text-gray-500'>{opt.desc}</p>
              </div>
              {opt.id === value && <Check size={13} className='text-violet-400 flex-shrink-0' />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
