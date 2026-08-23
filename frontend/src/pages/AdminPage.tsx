import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@clerk/clerk-react';
import { useImpersonation } from '../context/ImpersonationContext';
import { adminApi, type AdminStats, type AdminUser } from '../lib/api';
import {
  Users, Layers, GitBranch, Search, X,
  ShieldCheck, UserCheck, ChevronRight, Loader2, ArrowLeft,
} from 'lucide-react';
import { cn } from '../lib/utils';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function shortId(id: string): string {
  if (id.length <= 16) return id;
  return `${id.slice(0, 8)}…${id.slice(-6)}`;
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({
  label, value, icon: Icon, color,
}: {
  label: string;
  value: number | undefined;
  icon: React.ElementType;
  color: string;
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
          <p className='text-heading font-bold leading-tight'>{value.toLocaleString()}</p>
        )}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const { getToken } = useAuth();
  const navigate = useNavigate();
  const { startImpersonation } = useImpersonation();

  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [statsLoading, setStatsLoading] = useState(false);
  const [impersonatingId, setImpersonatingId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const getAdminToken = async (): Promise<string> => {
    const token = await getToken();
    if (!token) throw new Error('Not authenticated');
    return token;
  };

  // Lazy-load data on first render
  if (!loaded) {
    setLoaded(true);
    setStatsLoading(true);
    setLoading(true);
    Promise.all([
      getAdminToken().then((t) => adminApi.getStats(t)),
      getAdminToken().then((t) => adminApi.getUsers(t)),
    ]).then(([statsRes, usersRes]) => {
      if (statsRes.data) setStats(statsRes.data);
      if (usersRes.data) setUsers(usersRes.data);
    }).catch(console.error).finally(() => {
      setStatsLoading(false);
      setLoading(false);
    });
  }

  async function handleSearch(q: string) {
    setSearch(q);
    setLoading(true);
    try {
      const token = await getAdminToken();
      const res = await adminApi.getUsers(token, q || undefined);
      if (res.data) setUsers(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleImpersonate(user: AdminUser, e: React.MouseEvent) {
    e.stopPropagation();
    setImpersonatingId(user.id);
    try {
      const token = await getAdminToken();
      const res = await adminApi.impersonate(token, user.id);
      if (res.data) {
        startImpersonation(res.data.user, res.data.token);
        if (res.data.workspaceSlug) {
          navigate(`/workspaces/${res.data.workspaceSlug}`);
        } else {
          // User has no workspace yet — navigate to onboarding to see their state
          navigate('/onboarding');
        }
      }
    } catch (err) {
      console.error('Impersonation failed', err);
    } finally {
      setImpersonatingId(null);
    }
  }

  return (
    <div className='flex flex-col min-h-screen bg-surface'>
      {/* Header */}
      <header className='sticky top-0 z-10 border-b border-border-soft bg-surface/90 backdrop-blur-md px-4 h-14 flex items-center gap-3'>
        <button
          onClick={() => navigate('/')}
          className='text-text-muted hover:text-text-primary transition-colors p-1 -ml-1 rounded-lg'
        >
          <ArrowLeft size={22} />
        </button>
        <h1 className='text-text-primary font-bold text-lg leading-tight flex items-center gap-2'>
          <ShieldCheck className='w-5 h-5 text-brand' />
          Super Admin
        </h1>
      </header>

      <div className='flex-1 overflow-y-auto'>
        <div className='p-4 space-y-4 max-w-3xl mx-auto'>

          {/* Stats */}
          <div className='grid grid-cols-3 gap-3'>
            <StatCard label='Total Users'      value={statsLoading ? undefined : (stats?.totalUsers ?? 0)}      icon={Users}      color='bg-brand/10 text-brand' />
            <StatCard label='Workspaces'       value={statsLoading ? undefined : (stats?.totalWorkspaces ?? 0)} icon={Layers}     color='bg-violet-500/10 text-violet-500' />
            <StatCard label='Threads'          value={statsLoading ? undefined : (stats?.totalThreads ?? 0)}    icon={GitBranch}  color='bg-amber-500/10 text-amber-500' />
          </div>

          {/* Search */}
          <div className='relative'>
            <Search className='absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none' />
            <input
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder='Search by name, email or user ID…'
              className='w-full h-10 pl-9 pr-4 bg-surface-card border border-border-soft rounded-xl text-message text-text-primary placeholder:text-text-muted focus:outline-none focus:border-brand/50 transition-colors'
            />
            {search && (
              <button
                onClick={() => handleSearch('')}
                className='absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary'
              >
                <X className='w-4 h-4' />
              </button>
            )}
          </div>

          {/* Users list */}
          <div>
            <p className='text-text-primary font-semibold text-message mb-2'>
              Users {users.length > 0 && <span className='text-text-muted font-normal'>({users.length})</span>}
            </p>
            <div className='space-y-2'>
              {loading ? (
                [...Array(5)].map((_, i) => (
                  <div key={i} className='p-3 rounded-xl border border-border-soft bg-surface-card flex items-center gap-3 animate-pulse'>
                    <div className='w-9 h-9 rounded-full bg-surface shrink-0' />
                    <div className='flex-1 space-y-1.5'>
                      <div className='h-3.5 w-40 bg-surface rounded' />
                      <div className='h-3 w-24 bg-surface rounded' />
                    </div>
                    <div className='h-7 w-24 rounded-lg bg-surface' />
                  </div>
                ))
              ) : users.length === 0 ? (
                <p className='text-text-muted text-message text-center py-10'>No users found</p>
              ) : (
                users.map((user) => (
                  <div
                    key={user.id}
                    className='p-3 rounded-xl border border-border-soft bg-surface-card flex items-center gap-3 hover:border-border/60 transition-colors cursor-default'
                  >
                    {/* Avatar placeholder */}
                    <div className='w-9 h-9 rounded-full bg-brand/10 flex items-center justify-center shrink-0'>
                      <Users className='w-4 h-4 text-brand' />
                    </div>

                    {/* Info */}
                    <div className='flex-1 min-w-0'>
                      <p className='text-text-primary text-message font-semibold truncate'>
                        {user.name ?? <span className='text-text-muted font-normal italic'>No name</span>}
                      </p>
                      <p className='text-text-secondary text-meta truncate'>
                        {user.email ?? <span className='text-text-muted italic'>No email</span>}
                      </p>
                      <p className='text-text-muted text-meta'>
                        {user.workspaceCount} workspace{user.workspaceCount !== 1 ? 's' : ''} · joined {formatDate(user.created_at)}
                        {!user.onboarded ? ' · not onboarded' : ''}
                      </p>
                    </div>

                    {/* Actions */}
                    <div className='flex items-center gap-1.5 shrink-0'>
                      <button
                        onClick={(e) => handleImpersonate(user, e)}
                        disabled={impersonatingId === user.id}
                        className={cn(
                          'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-meta font-medium border transition-all',
                          'border-border-soft bg-surface text-text-secondary hover:border-brand/50 hover:text-brand',
                          'disabled:opacity-50 disabled:cursor-not-allowed'
                        )}
                      >
                        {impersonatingId === user.id
                          ? <Loader2 className='w-3.5 h-3.5 animate-spin' />
                          : <UserCheck className='w-3.5 h-3.5' />}
                        <span className='hidden sm:inline'>Impersonate</span>
                      </button>
                      {user.workspaceSlug && (
                        <button
                          onClick={() => navigate(`/workspaces/${user.workspaceSlug}`)}
                          className='p-1.5 rounded-lg text-text-muted hover:text-text-primary transition-colors'
                          title='View workspace'
                        >
                          <ChevronRight className='w-4 h-4' />
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
