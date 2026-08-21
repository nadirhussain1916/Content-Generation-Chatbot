import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { UserButton } from '@clerk/clerk-react';
import { useAuthToken } from '../hooks/useAuthToken';
import { api } from '../lib/api';
import type { TfResponse, Workspace, Thread } from '../types';
import { Zap, Plus, Settings, MessageSquare, ChevronDown, Loader2, Image } from 'lucide-react';
import { cn, formatRelativeTime } from '../lib/utils';
import ThemeToggle from './ThemeToggle';

interface SidebarProps {
  onNewThread: () => void;
  refreshKey?: number;
}

export default function Sidebar({ onNewThread, refreshKey = 0 }: SidebarProps) {
  const { getAuthToken } = useAuthToken();
  const { slug, threadId } = useParams();
  const navigate = useNavigate();

  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [showWsDropdown, setShowWsDropdown] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!slug) return;
    (async () => {
      const token = await getAuthToken();
      const [wsRes, threadsRes] = await Promise.all([
        api.get<TfResponse<Workspace[]>>('/api/workspaces', token ?? undefined),
        api.get<TfResponse<Thread[]>>(`/api/workspaces/${slug}/threads`, token ?? undefined),
      ]);
      if (wsRes.success) setWorkspaces(wsRes.data ?? []);
      if (threadsRes.success) setThreads(threadsRes.data ?? []);
      setLoading(false);
    })();
  }, [slug, threadId, refreshKey]);

  const activeWorkspace = workspaces.find((w) => w.slug === slug);

  function statusDot(status: Thread['status']) {
    const map: Record<Thread['status'], string> = {
      planning: 'bg-yellow-500',
      draft: 'bg-blue-500',
      script_ready: 'bg-purple-500',
      media_pending: 'bg-orange-500',
      ready: 'bg-green-500',
      published: 'bg-gray-500',
    };
    return map[status];
  }

  return (
    <aside className='w-64 flex-shrink-0 bg-surface/70 backdrop-blur-xl border-r border-border-soft/60 flex flex-col h-full'>
      {/* Workspace selector */}
      <div className='p-4 border-b border-border-soft'>
        <button
          onClick={() => setShowWsDropdown((p) => !p)}
          className='w-full flex items-center gap-2 p-2 rounded-xl hover:bg-surface-card transition-colors'
        >
          <div className='w-7 h-7 rounded-lg bg-ink flex items-center justify-center flex-shrink-0'>
            <Zap size={13} className='text-on-ink' />
          </div>
          <span className='text-message font-medium text-text-primary truncate flex-1 text-left'>
            {activeWorkspace?.name ?? 'Loading...'}
          </span>
          <ChevronDown size={14} className='text-text-muted' />
        </button>

        {showWsDropdown && (
          <div className='mt-1 py-1 bg-surface-white rounded-xl border border-border-soft shadow-[0_10px_40px_rgba(0,0,0,0.08)]'>
            {workspaces.map((ws) => (
              <button
                key={ws.id}
                onClick={() => { navigate(`/workspaces/${ws.slug}`); setShowWsDropdown(false); }}
                className={cn(
                  'w-full text-left px-3 py-2 text-message transition-colors',
                  ws.slug === slug ? 'text-text-primary font-medium' : 'text-text-secondary hover:bg-surface-card'
                )}
              >
                {ws.name}
              </button>
            ))}
            <div className='border-t border-border-soft mt-1 pt-1'>
              <button
                onClick={() => { navigate('/onboarding'); setShowWsDropdown(false); }}
                className='w-full text-left px-3 py-2 text-message text-text-secondary hover:text-text-primary hover:bg-surface-card transition-colors flex items-center gap-2'
              >
                <Plus size={13} /> New workspace
              </button>
            </div>
          </div>
        )}
      </div>

      {/* New thread button */}
      <div className='p-3'>
        <button
          onClick={onNewThread}
          className='w-full flex items-center justify-center gap-2 px-3 py-2.5 bg-brand hover:bg-brand-hover transition-colors rounded-lg text-message font-medium text-on-brand shadow-[0_4px_14px_rgba(58,122,114,0.25)]'
        >
          <Plus size={15} />
          New thread
        </button>
      </div>

      {/* Threads list */}
      <div className='flex-1 overflow-y-auto px-2'>
        {loading ? (
          <div className='flex justify-center py-8'>
            <Loader2 size={18} className='animate-spin text-text-muted' />
          </div>
        ) : threads.length === 0 ? (
          <div className='text-center py-8 px-4'>
            <MessageSquare size={24} className='text-text-muted mx-auto mb-2' />
            <p className='text-meta text-text-secondary'>No threads yet. Start your first!</p>
          </div>
        ) : (
          <div className='space-y-0.5'>
            {threads.map((thread) => (
              <Link
                key={thread.id}
                to={`/workspaces/${slug}/threads/${thread.id}`}
                className={cn(
                  'flex items-start gap-2.5 px-2.5 py-2 rounded-xl transition-colors group',
                  thread.id === threadId
                    ? 'bg-surface-card text-text-primary'
                    : 'text-text-secondary hover:bg-surface-card/60 hover:text-text-primary'
                )}
              >
                <div className={cn('w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0', statusDot(thread.status))} />
                <div className='min-w-0'>
                  <p className='text-message font-medium truncate leading-tight'>
                    {thread.title ?? 'Untitled thread'}
                  </p>
                  <p className='text-meta text-text-muted mt-0.5'>{formatRelativeTime(thread.updated_at)}</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className='p-3 border-t border-border-soft flex items-center justify-between'>
        <UserButton
          userProfileProps={{
            appearance: {
              elements: {
                'navbarButton__security': { display: 'none' },
                'navbarButton__apiKeys': { display: 'none' },
              },
            },
          }}
        />
        <div className='flex items-center gap-1'>
          <ThemeToggle />
          <Link
            to={`/workspaces/${slug}/generations`}
            className='p-2 text-text-muted hover:text-text-primary hover:bg-surface-card rounded-full transition-colors'
            title='Generations'
          >
            <Image size={16} />
          </Link>
          <Link
            to={`/workspaces/${slug}/settings`}
            className='p-2 text-text-muted hover:text-text-primary hover:bg-surface-card rounded-full transition-colors'
            title='Settings'
          >
            <Settings size={16} />
          </Link>
        </div>
      </div>
    </aside>
  );
}
