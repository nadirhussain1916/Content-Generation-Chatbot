import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@clerk/clerk-react';
import { adminApi, type AdminUsageResponse, type AdminUsageUser } from '../lib/api';
import { formatUsd, formatTokens } from '../lib/display';
import {
  ArrowLeft, ShieldCheck, DollarSign, MessageSquare, ImageIcon, VideoIcon,
  Users, Search, X, Loader2,
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
  const navigate = useNavigate();

  const [data, setData] = useState<AdminUsageResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState('');

  // Lazy-load once on first render (mirrors AdminPage pattern).
  if (!loaded) {
    setLoaded(true);
    setLoading(true);
    (async () => {
      try {
        const token = await getToken();
        if (!token) throw new Error('Not authenticated');
        const res = await adminApi.getUsage(token);
        if (res.data) setData(res.data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    })();
  }

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
    <div className='flex flex-col min-h-screen bg-surface'>
      {/* Header */}
      <header className='sticky top-0 z-10 border-b border-border-soft bg-surface/90 backdrop-blur-md px-4 h-14 flex items-center gap-3'>
        <button
          onClick={() => navigate('/admin')}
          className='text-text-muted hover:text-text-primary transition-colors p-1 -ml-1 rounded-lg'
        >
          <ArrowLeft size={22} />
        </button>
        <h1 className='text-text-primary font-bold text-lg leading-tight flex items-center gap-2'>
          <ShieldCheck className='w-5 h-5 text-brand' />
          Usage &amp; Billing
        </h1>
      </header>

      <div className='flex-1 overflow-y-auto'>
        <div className='p-4 space-y-4 max-w-6xl mx-auto'>
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
                    {filtered.map((u) => (
                      <tr key={u.userId} className='border-t border-border-soft hover:bg-surface-card/50 transition-colors'>
                        <td className='px-4 py-3'>
                          <div className='flex items-center gap-2.5 min-w-0'>
                            <div className='w-8 h-8 rounded-full bg-brand/10 flex items-center justify-center shrink-0'>
                              <Users className='w-3.5 h-3.5 text-brand' />
                            </div>
                            <div className='min-w-0'>
                              <p className='text-message font-medium text-text-primary truncate'>
                                {u.name ?? <span className='text-text-muted font-normal italic'>No name</span>}
                              </p>
                              <p className='text-meta text-text-muted truncate'>
                                {u.email ?? u.userId}
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
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
