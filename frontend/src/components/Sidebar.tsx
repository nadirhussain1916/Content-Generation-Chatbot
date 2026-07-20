import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth, UserButton } from '@clerk/clerk-react';
import { api } from '../lib/api';
import type { TfResponse, Workspace, Thread } from '../types';
import { Zap, Plus, Settings, MessageSquare, ChevronDown, Loader2, Image } from 'lucide-react';
import { cn, formatRelativeTime } from '../lib/utils';

interface SidebarProps {
  onNewThread: () => void;
  refreshKey?: number;
}

export default function Sidebar({ onNewThread, refreshKey = 0 }: SidebarProps) {
  const { getToken } = useAuth();
  const { slug, threadId } = useParams();
  const navigate = useNavigate();

  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [showWsDropdown, setShowWsDropdown] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!slug) return;
    (async () => {
      const token = await getToken();
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
    <aside className='w-64 flex-shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col h-screen'>
      {/* Workspace selector */}
      <div className='p-4 border-b border-gray-800'>
        <button
          onClick={() => setShowWsDropdown((p) => !p)}
          className='w-full flex items-center gap-2 p-2 rounded-lg hover:bg-gray-800 transition-colors'
        >
          <div className='w-7 h-7 rounded-md bg-violet-600 flex items-center justify-center flex-shrink-0'>
            <Zap size={13} className='text-white' />
          </div>
          <span className='text-sm font-medium text-white truncate flex-1 text-left'>
            {activeWorkspace?.name ?? 'Loading...'}
          </span>
          <ChevronDown size={14} className='text-gray-400' />
        </button>

        {showWsDropdown && (
          <div className='mt-1 py-1 bg-gray-800 rounded-lg border border-gray-700 shadow-xl'>
            {workspaces.map((ws) => (
              <button
                key={ws.id}
                onClick={() => { navigate(`/workspaces/${ws.slug}`); setShowWsDropdown(false); }}
                className={cn(
                  'w-full text-left px-3 py-2 text-sm hover:bg-gray-700 transition-colors',
                  ws.slug === slug ? 'text-violet-400' : 'text-gray-300'
                )}
              >
                {ws.name}
              </button>
            ))}
            <div className='border-t border-gray-700 mt-1 pt-1'>
              <button
                onClick={() => { navigate('/onboarding'); setShowWsDropdown(false); }}
                className='w-full text-left px-3 py-2 text-sm text-gray-400 hover:text-white hover:bg-gray-700 transition-colors flex items-center gap-2'
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
          className='w-full flex items-center gap-2 px-3 py-2 bg-violet-600 hover:bg-violet-500 transition-colors rounded-lg text-sm font-medium text-white'
        >
          <Plus size={15} />
          New thread
        </button>
      </div>

      {/* Threads list */}
      <div className='flex-1 overflow-y-auto px-2'>
        {loading ? (
          <div className='flex justify-center py-8'>
            <Loader2 size={18} className='animate-spin text-gray-500' />
          </div>
        ) : threads.length === 0 ? (
          <div className='text-center py-8 px-4'>
            <MessageSquare size={24} className='text-gray-600 mx-auto mb-2' />
            <p className='text-xs text-gray-500'>No threads yet. Start your first!</p>
          </div>
        ) : (
          <div className='space-y-0.5'>
            {threads.map((thread) => (
              <Link
                key={thread.id}
                to={`/workspaces/${slug}/threads/${thread.id}`}
                className={cn(
                  'flex items-start gap-2.5 px-2.5 py-2 rounded-lg transition-colors group',
                  thread.id === threadId
                    ? 'bg-gray-800 text-white'
                    : 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-200'
                )}
              >
                <div className={cn('w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0', statusDot(thread.status))} />
                <div className='min-w-0'>
                  <p className='text-xs font-medium truncate leading-tight'>
                    {thread.title ?? 'Untitled thread'}
                  </p>
                  <p className='text-xs text-gray-500 mt-0.5'>{formatRelativeTime(thread.updated_at)}</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className='p-3 border-t border-gray-800 flex items-center justify-between'>
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
          <Link
            to={`/workspaces/${slug}/generations`}
            className='p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors'
            title='Generations'
          >
            <Image size={16} />
          </Link>
          <Link
            to={`/workspaces/${slug}/settings`}
            className='p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors'
            title='Settings'
          >
            <Settings size={16} />
          </Link>
        </div>
      </div>
    </aside>
  );
}
