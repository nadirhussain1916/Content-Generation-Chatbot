import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@clerk/clerk-react';
import { api } from '../lib/api';
import type { TfResponse, Thread } from '../types';
import Sidebar from '../components/Sidebar';
import { MessageSquare, Zap } from 'lucide-react';

export default function WorkspacePage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { getToken } = useAuth();
  const [refreshKey, setRefreshKey] = useState(0);

  async function handleNewThread() {
    const token = await getToken();
    const res = await api.post<TfResponse<Thread>>(
      `/api/workspaces/${slug}/threads`,
      {},
      token ?? undefined
    );
    if (res.success && res.data) {
      setRefreshKey((k) => k + 1);
      navigate(`/workspaces/${slug}/threads/${res.data.id}`);
    }
  }

  return (
    <div className='flex h-screen bg-gray-950 text-white'>
      <Sidebar onNewThread={handleNewThread} refreshKey={refreshKey} />

      <main className='flex-1 flex flex-col items-center justify-center gap-6'>
        <div className='text-center max-w-sm'>
          <div className='w-16 h-16 rounded-2xl bg-violet-900/30 border border-violet-700/30 flex items-center justify-center mx-auto mb-4'>
            <Zap size={28} className='text-violet-400' />
          </div>
          <h2 className='text-xl font-semibold mb-2'>Start creating</h2>
          <p className='text-gray-400 text-sm leading-relaxed mb-6'>
            Start a new thread to create AI-powered content for Instagram and TikTok.
          </p>
          <button
            onClick={handleNewThread}
            className='inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-500 transition-colors px-5 py-2.5 rounded-lg font-medium text-sm'
          >
            <MessageSquare size={15} />
            New thread
          </button>
        </div>
      </main>
    </div>
  );
}
