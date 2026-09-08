import { cn } from '../lib/utils';

export interface PageTab {
  id: string;
  label: string;
  icon?: React.ElementType;
}

/**
 * Horizontal, underline-style tab bar used to break long single-scroll pages
 * (Settings, Models, …) into focused sections. Scrolls horizontally on narrow
 * viewports so tabs never wrap.
 */
export default function PageTabs({
  tabs,
  active,
  onChange,
  className,
}: {
  tabs: PageTab[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-1 border-b border-border-soft/60 overflow-x-auto',
        className
      )}
      role='tablist'
    >
      {tabs.map((t) => {
        const Icon = t.icon;
        const isActive = t.id === active;
        return (
          <button
            key={t.id}
            role='tab'
            aria-selected={isActive}
            onClick={() => onChange(t.id)}
            className={cn(
              'flex items-center gap-1.5 px-3.5 py-2.5 text-message font-medium border-b-2 -mb-px whitespace-nowrap transition-colors',
              isActive
                ? 'border-ink text-text-primary'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            )}
          >
            {Icon && <Icon size={14} />}
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
