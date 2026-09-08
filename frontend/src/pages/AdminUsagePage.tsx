import { Fragment, useEffect, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { adminApi, type AdminUsageResponse, type AdminUsageUser, type DateRange } from '../lib/api';
import { formatUsd, formatTokens } from '../lib/display';
import AppShell from '../components/AppShell';
import AdminSidebar from '../components/AdminSidebar';
import DateRangePicker from '../components/DateRangePicker';
import {
  DollarSign, MessageSquare, ImageIcon, VideoIcon,
  Users, Search, X, Loader2, ChevronRight, Layers,
} from 'lucide-react';
import { cn } from '../lib/utils';

function StatCard({
  label, value, icon: Icon, color,
}: {
  label: string; value: string | undefined; icon: React.ElementType; color: string;
}) {
  return (
    <div className='flex items-center gap-3 rounded-xl border border-border-soft bg-surface-card p-4'>
      <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center shrink-0', color)}>
        <Icon className='w-5 h-5' />
      </div>
      <div className='min-w-0'>
        <p className='text-meta text-text-muted'>{label}</p>
        {value === undefined ? (
          <div className='h-6 w-16 mt-0.5 rounded bg-surface animate-pulse' />
        ) : (
          <p className='text-heading font-bold leading-tight tabular-nums'>{value}</p>
        )}
      </div>
    </div>
  );
}

export default function AdminUsagePage() {
  const { getToken } = useAuth();

  const [data, setData] = useState<AdminUsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [range, setRange] = useState<DateRange>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggleExpand(userId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const token = await getToken();
        if (!token) throw new Error('Not authenticated');
        const res = await adminApi.getUsage(token, range);
        if (res.data) setData(res.data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    })();
  }, [range]);

  const totals = data?.totals;

  const filtered: AdminUsageUser[] = (data?.users ?? []).filter((u) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (u.name?.toLowerCase().includes(q) ?? false) ||
      (u.email?.toLowerCase().includes(q) ?? false) ||
      u.userId.toLowerCase().includes(q)
    );
  });

  return (
    <AppShell>
      <AdminSidebar />

      <main className='flex-1 overflow-y-auto bg-surface-chat/25 backdrop-blur-xl'>
        <div className='max-w-6xl mx-auto px-6 py-8 space-y-4'>
          <div className='flex items-center justify-between gap-3 flex-wrap'>
            <div>
              <h1 className='text-heading text-text-primary'>Usage &amp; Billing</h1>
              <p className='text-meta text-text-secondary mt-0.5'>Spend across all users and workspaces.</p>
            </div>
            <DateRangePicker onChange={setRange} />
          </div>

          {/* Totals */}
          <div className='grid grid-cols-2 lg:grid-cols-4 gap-3'>
            <StatCard label='Total spend'  value={loading ? undefined : formatUsd(totals?.totalCost)} icon={DollarSign}    color='bg-brand/10 text-brand' />
            <StatCard label='Text'         value={loading ? undefined : formatUsd(totals?.textCost)}  icon={MessageSquare} color='bg-blue-500/10 text-blue-500' />
            <StatCard label='Image'        value={loading ? undefined : formatUsd(totals?.imageCost)} icon={ImageIcon}     color='bg-orange-500/10 text-orange-500' />
            <StatCard label='Video'        value={loading ? undefined : formatUsd(totals?.videoCost)} icon={VideoIcon}     color='bg-purple-500/10 text-purple-500' />
          </div>

          {/* Search */}
          <div className='relative'>
            <Search className='absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none' />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder='Filter by name, email or user ID…'
              className='w-full h-10 pl-9 pr-4 bg-surface-card border border-border-soft rounded-xl text-message text-text-primary placeholder:text-text-muted focus:outline-none focus:border-brand/50 transition-colors'
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className='absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary'
              >
                <X className='w-4 h-4' />
              </button>
            )}
          </div>

          {/* Per-user table */}
          <div>
            <p className='text-text-primary font-semibold text-message mb-2'>
              Users {filtered.length > 0 && <span className='text-text-muted font-normal'>({filtered.length})</span>}
            </p>

            {loading ? (
              <div className='flex justify-center py-16'>
                <Loader2 className='w-5 h-5 animate-spin text-text-muted' />
              </div>
            ) : filtered.length === 0 ? (
              <p className='text-text-muted text-message text-center py-10'>No users found</p>
            ) : (
              <div className='overflow-x-auto rounded-xl border border-border-soft'>
                <table className='w-full text-left'>
                  <thead>
                    <tr className='bg-surface-card text-meta text-text-muted uppercase tracking-wide'>
                      <th className='px-4 py-2.5 font-semibold'>User</th>
                      <th className='px-4 py-2.5 font-semibold text-right'>Text</th>
                      <th className='px-4 py-2.5 font-semibold text-right'>Image</th>
                      <th className='px-4 py-2.5 font-semibold text-right'>Video</th>
                      <th className='px-4 py-2.5 font-semibold text-right'>Ops</th>
                      <th className='px-4 py-2.5 font-semibold text-right'>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((u) => {
                      const isOpen = expanded.has(u.userId);
                      const wsCount = u.workspaces.length;
                      const canExpand = wsCount > 0;
                      return (
                        <Fragment key={u.userId}>
                          <tr
                            className={cn(
                              'border-t border-border-soft transition-colors',
                              canExpand && 'cursor-pointer hover:bg-surface-card/50'
                            )}
                            onClick={canExpand ? () => toggleExpand(u.userId) : undefined}
                          >
                            <td className='px-4 py-3'>
                              <div className='flex items-center gap-2 min-w-0'>
                                <ChevronRight
                                  size={15}
                                  className={cn(
                                    'shrink-0 text-text-muted transition-transform',
                                    !canExpand && 'opacity-0',
                                    isOpen && 'rotate-90'
                                  )}
                                />
                                <div className='w-8 h-8 rounded-full bg-brand/10 flex items-center justify-center shrink-0'>
                                  <Users className='w-3.5 h-3.5 text-brand' />
                                </div>
                                <div className='min-w-0'>
                                  <p className='text-message font-medium text-text-primary truncate'>
                                    {u.name ?? <span className='text-text-muted font-normal italic'>No name</span>}
                                  </p>
                                  <p className='text-meta text-text-muted truncate'>
                                    {u.email ?? u.userId}
                                    {canExpand && <> · {wsCount} workspace{wsCount !== 1 ? 's' : ''}</>}
                                  </p>
                                </div>
                              </div>
                            </td>
                            <td className='px-4 py-3 text-right text-message text-text-secondary tabular-nums'>
                              {formatUsd(u.textCost)}
                              <span className='block text-meta text-text-muted'>{formatTokens(u.inputTokens + u.outputTokens)} tok</span>
                            </td>
                            <td className='px-4 py-3 text-right text-message text-text-secondary tabular-nums'>
                              {formatUsd(u.imageCost)}
                              <span className='block text-meta text-text-muted'>{u.imageCount}</span>
                            </td>
                            <td className='px-4 py-3 text-right text-message text-text-secondary tabular-nums'>
                              {formatUsd(u.videoCost)}
                              <span className='block text-meta text-text-muted'>{u.videoCount}</span>
                            </td>
                            <td className='px-4 py-3 text-right text-message text-text-secondary tabular-nums'>
                              {u.messageCount + u.imageCount + u.videoCount}
                            </td>
                            <td className='px-4 py-3 text-right text-message font-bold text-text-primary tabular-nums'>
                              {formatUsd(u.totalCost)}
                            </td>
                          </tr>

                          {isOpen && u.workspaces.map((ws) => (
                            <tr key={ws.workspaceId} className='border-t border-border-soft/50 bg-surface-card/40'>
                              <td className='px-4 py-2.5'>
                                <div className='flex items-center gap-2 min-w-0 pl-[23px]'>
                                  <Layers size={13} className='shrink-0 text-text-muted' />
                                  <div className='min-w-0'>
                                    <p className='text-message text-text-primary truncate'>{ws.name}</p>
                                    <p className='text-meta text-text-muted truncate font-mono'>{ws.slug}</p>
                                  </div>
                                </div>
                              </td>
                              <td className='px-4 py-2.5 text-right text-meta text-text-secondary tabular-nums'>{formatUsd(ws.textCost)}</td>
                              <td className='px-4 py-2.5 text-right text-meta text-text-secondary tabular-nums'>{formatUsd(ws.imageCost)}</td>
                              <td className='px-4 py-2.5 text-right text-meta text-text-secondary tabular-nums'>{formatUsd(ws.videoCost)}</td>
                              <td className='px-4 py-2.5 text-right text-meta text-text-secondary tabular-nums'>
                                {ws.messageCount + ws.imageCount + ws.videoCount}
                              </td>
                              <td className='px-4 py-2.5 text-right text-message font-semibold text-text-primary tabular-nums'>{formatUsd(ws.totalCost)}</td>
                            </tr>
                          ))}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </main>
    </AppShell>
  );
}
