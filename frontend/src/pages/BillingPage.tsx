import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuthToken } from '../hooks/useAuthToken';
import { api } from '../lib/api';
import type { TfResponse } from '../types';
import type { UsageSummary, CategoryUsage, ModelUsage } from '../lib/api';
import AppShell from '../components/AppShell';
import Sidebar from '../components/Sidebar';
import { shortModelLabel, formatUsd, formatTokens } from '../lib/display';
import { cn } from '../lib/utils';
import {
  CreditCard, DollarSign, MessageSquare, ImageIcon, VideoIcon,
  Loader2, Cpu, Info, ArrowRight,
} from 'lucide-react';

type CategoryKey = 'text' | 'image' | 'video';

const CATEGORY_META: Record<CategoryKey, { label: string; icon: React.ElementType; color: string }> = {
  text: { label: 'Text', icon: MessageSquare, color: 'bg-blue-500/10 text-blue-500' },
  image: { label: 'Image', icon: ImageIcon, color: 'bg-orange-500/10 text-orange-500' },
  video: { label: 'Video', icon: VideoIcon, color: 'bg-purple-500/10 text-purple-500' },
};

export default function BillingPage() {
  const { slug } = useParams<{ slug: string }>();
  const { getAuthToken: getToken } = useAuthToken();
  const navigate = useNavigate();

  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const token = await getToken();
      const res = await api.get<TfResponse<UsageSummary>>(
        `/api/workspaces/${slug}/billing`,
        token ?? undefined
      );
      if (res.success && res.data) setUsage(res.data);
      setLoading(false);
    })();
  }, [slug]);

  return (
    <AppShell>
      <Sidebar onNewThread={() => navigate(`/workspaces/${slug}`)} />

      <main className='flex-1 overflow-y-auto bg-surface-chat/40 backdrop-blur-xl'>
        <div className='max-w-5xl mx-auto px-6 py-8'>
          {/* Header */}
          <div className='flex items-center justify-between gap-3 mb-8 flex-wrap'>
            <div className='flex items-center gap-3'>
              <div className='w-10 h-10 rounded-xl bg-ink flex items-center justify-center'>
                <CreditCard size={18} className='text-on-ink' />
              </div>
              <div>
                <h1 className='text-heading text-text-primary'>Billing &amp; Usage</h1>
                <p className='text-meta text-text-secondary mt-0.5'>Generation costs for this workspace.</p>
              </div>
            </div>
            <Link
              to={`/workspaces/${slug}/models`}
              className='flex items-center gap-1.5 px-3 py-2 rounded-lg text-meta font-medium bg-surface-card border border-border-soft text-text-secondary hover:text-text-primary hover:border-ink/30 transition-colors'
            >
              <DollarSign size={13} />
              View model pricing
              <ArrowRight size={13} />
            </Link>
          </div>

          {loading ? (
            <div className='flex justify-center py-16'>
              <Loader2 size={22} className='animate-spin text-text-muted' />
            </div>
          ) : !usage ? (
            <p className='text-message text-text-muted text-center py-16'>Couldn’t load usage.</p>
          ) : (
            <UsageView usage={usage} slug={slug!} />
          )}
        </div>
      </main>
    </AppShell>
  );
}

// ─── Usage view ───────────────────────────────────────────────────────────────

function UsageView({ usage, slug }: { usage: UsageSummary; slug: string }) {
  const rows: (ModelUsage & { category: CategoryKey })[] = [
    ...usage.text.byModel.map((m) => ({ ...m, category: 'text' as const })),
    ...usage.image.byModel.map((m) => ({ ...m, category: 'image' as const })),
    ...usage.video.byModel.map((m) => ({ ...m, category: 'video' as const })),
  ].sort((a, b) => b.cost - a.cost);

  return (
    <div className='space-y-6'>
      {/* Total spend */}
      <div className='rounded-2xl border border-border-soft bg-surface-card p-6 flex items-center justify-between flex-wrap gap-4'>
        <div>
          <p className='text-meta text-text-muted uppercase tracking-wide'>Total spend</p>
          <p className='text-4xl font-bold text-text-primary mt-1 tabular-nums'>{formatUsd(usage.totalCost)}</p>
          <p className='text-meta text-text-secondary mt-1'>
            {usage.text.count + usage.image.count + usage.video.count} billable operations to date
          </p>
        </div>
        <div className='w-14 h-14 rounded-2xl bg-brand/10 flex items-center justify-center'>
          <DollarSign size={26} className='text-brand' />
        </div>
      </div>

      {/* Category cards */}
      <div className='grid grid-cols-1 sm:grid-cols-3 gap-3'>
        <CategoryCard category='text' usage={usage.text} unit='messages' />
        <CategoryCard category='image' usage={usage.image} unit='images' />
        <CategoryCard category='video' usage={usage.video} unit='videos' />
      </div>

      {/* By-model breakdown */}
      <div>
        <h2 className='text-message font-semibold text-text-primary mb-3'>Cost by model</h2>
        {rows.length === 0 ? (
          <div className='rounded-xl border border-dashed border-border-soft bg-surface-card p-8 text-center'>
            <p className='text-message text-text-secondary'>No usage yet</p>
            <p className='text-meta text-text-muted mt-1'>Costs appear here as you generate content.</p>
          </div>
        ) : (
          <div className='overflow-x-auto rounded-xl border border-border-soft bg-surface-card'>
            <table className='w-full text-left border-collapse'>
              <thead>
                <tr className='text-meta text-text-muted uppercase tracking-wide border-b border-border-soft'>
                  <th className='px-4 py-3 font-semibold'>Model</th>
                  <th className='px-4 py-3 font-semibold'>Type</th>
                  <th className='px-4 py-3 font-semibold text-right'>Count</th>
                  <th className='px-4 py-3 font-semibold text-right'>Tokens (in / out)</th>
                  <th className='px-4 py-3 font-semibold text-right'>Cost</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const meta = CATEGORY_META[r.category];
                  return (
                    <tr key={`${r.category}-${r.model}-${i}`} className='border-b border-border-soft/60 last:border-0'>
                      <td className='px-4 py-3'>
                        <span className='flex items-center gap-1.5 text-message text-text-primary'>
                          <Cpu size={12} className='text-text-muted' />
                          {shortModelLabel(r.model)}
                        </span>
                      </td>
                      <td className='px-4 py-3'>
                        <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-meta font-medium', meta.color)}>
                          {meta.label}
                        </span>
                      </td>
                      <td className='px-4 py-3 text-right text-message text-text-secondary tabular-nums'>{r.count}</td>
                      <td className='px-4 py-3 text-right text-meta text-text-muted tabular-nums font-mono'>
                        {r.category === 'text'
                          ? `${formatTokens(r.inputTokens)} / ${formatTokens(r.outputTokens)}`
                          : '—'}
                      </td>
                      <td className='px-4 py-3 text-right text-message font-semibold text-text-primary tabular-nums'>{formatUsd(r.cost)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className='flex items-start gap-2 text-meta text-text-muted'>
        <Info size={13} className='mt-0.5 flex-shrink-0' />
        Costs are estimated at generation time from each model’s list price (see{' '}
        <Link to={`/workspaces/${slug}/models`} className='underline hover:text-text-secondary'>model pricing</Link>) and
        stored per generation. Failed generations are not billed.
      </p>
    </div>
  );
}

function CategoryCard({ category, usage, unit }: { category: CategoryKey; usage: CategoryUsage; unit: string }) {
  const meta = CATEGORY_META[category];
  const Icon = meta.icon;
  return (
    <div className='rounded-xl border border-border-soft bg-surface-card p-4'>
      <div className='flex items-center gap-2 mb-2'>
        <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center', meta.color)}>
          <Icon size={15} />
        </div>
        <span className='text-message font-medium text-text-primary'>{meta.label}</span>
      </div>
      <p className='text-2xl font-bold text-text-primary tabular-nums'>{formatUsd(usage.cost)}</p>
      <p className='text-meta text-text-secondary mt-0.5'>
        {usage.count} {unit}
        {category === 'text' && usage.outputTokens != null && (
          <> · {formatTokens((usage.inputTokens ?? 0) + (usage.outputTokens ?? 0))} tokens</>
        )}
      </p>
    </div>
  );
}
