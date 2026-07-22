import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useAuth } from '@clerk/clerk-react';
import { api } from '../lib/api';
import type { TfResponse, Thread, Workspace } from '../types';
import Sidebar from '../components/Sidebar';
import ModelPicker from '../components/ModelPicker';
import { ArrowUp, Loader2, Zap, AlertCircle } from 'lucide-react';
import { TEXT_MODELS, DEFAULT_TEXT_MODEL, TEXT_MODEL_KEY, readPref, writePref } from '../lib/models';

export default function WorkspacePage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { getToken } = useAuth();
  const [input, setInput] = useState('');
  const [creating, setCreating] = useState(false);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [textModel, setTextModel] = useState(() => readPref(TEXT_MODEL_KEY, DEFAULT_TEXT_MODEL));
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    (async () => {
      const token = await getToken();
      const res = await api.get<TfResponse<Workspace>>(`/api/workspaces/${slug}`, token ?? undefined);
      if (res.success && res.data) setWorkspace(res.data);
    })();
  }, [slug]);

  const hasBrandContext = !!(workspace?.brand_description || workspace?.brand_name);

  async function handleSubmit() {
    const text = input.trim();
    if (!text || creating) return;
    setCreating(true);
    try {
      const token = await getToken();
      const res = await api.post<TfResponse<Thread>>(
        `/api/workspaces/${slug}/threads`,
        {},
        token ?? undefined
      );
      if (res.success && res.data) {
        navigate(`/workspaces/${slug}/threads/${res.data.id}`, {
          state: { initialMessage: text },
        });
      }
    } finally {
      setCreating(false);
    }
  }

  function handleNewThread() {
    // We're already on the prompt screen — just focus the input
    textareaRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <div className='flex h-screen bg-gray-950 text-white'>
      <Sidebar onNewThread={handleNewThread} />

      <main className='flex-1 flex flex-col items-center justify-center px-4'>
        {/* Greeting */}
        <div className='text-center mb-8'>
          <div className='w-12 h-12 rounded-2xl bg-violet-900/30 border border-violet-700/30 flex items-center justify-center mx-auto mb-4'>
            <Zap size={22} className='text-violet-400' />
          </div>
          <h1 className='text-2xl font-semibold text-white mb-1'>What do you want to create?</h1>
          <p className='text-gray-500 text-sm'>Describe your idea and the AI will guide you through the rest.</p>
        </div>

        {/* Brand context nudge */}
        {workspace && !hasBrandContext && (
          <div className='w-full max-w-2xl mb-4'>
            <div className='flex items-start gap-2.5 bg-amber-950/40 border border-amber-700/40 rounded-xl px-4 py-3 text-sm text-amber-300'>
              <AlertCircle size={15} className='mt-0.5 flex-shrink-0 text-amber-500' />
              <span>
                The AI doesn't know your brand yet — it won't be able to answer business questions.{' '}
                <Link
                  to={`/workspaces/${slug}/settings`}
                  className='underline underline-offset-2 text-amber-200 hover:text-white transition-colors'
                >
                  Add your brand context in Settings
                </Link>{' '}
                to unlock brand-aware responses.
              </span>
            </div>
          </div>
        )}

        {/* Input */}
        <div className='w-full max-w-2xl'>
          <div className='bg-gray-900 border border-gray-700 rounded-2xl focus-within:border-violet-500 transition-colors shadow-xl'>
            <div className='flex items-end px-4 pt-4 pb-2 gap-3'>
              <textarea
                ref={textareaRef}
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder='Describe what you want to create…'
                className='flex-1 bg-transparent text-sm text-white placeholder-gray-500 resize-none focus:outline-none max-h-40 overflow-y-auto leading-relaxed'
                style={{ height: 'auto' }}
                onInput={(e) => {
                  const el = e.currentTarget;
                  el.style.height = 'auto';
                  el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
                }}
                disabled={creating}
                autoFocus
              />
              <button
                onClick={handleSubmit}
                disabled={!input.trim() || creating}
                className='flex-shrink-0 mb-0.5 w-8 h-8 flex items-center justify-center bg-violet-600 hover:bg-violet-500 disabled:opacity-30 disabled:cursor-not-allowed rounded-lg transition-all'
              >
                {creating ? (
                  <Loader2 size={15} className='animate-spin' />
                ) : (
                  <ArrowUp size={15} />
                )}
              </button>
            </div>
            {/* Model selector row */}
            <div className='px-3 pb-2.5 flex items-center gap-1'>
              <span className='text-xs text-gray-600'>Model</span>
              <ModelPicker
                options={TEXT_MODELS}
                value={textModel}
                onChange={(id) => { setTextModel(id); writePref(TEXT_MODEL_KEY, id); }}
              />
            </div>
          </div>
          <p className='text-xs text-gray-600 mt-2.5 text-center'>
            Press Enter to send · Shift+Enter for new line
          </p>
        </div>
      </main>
    </div>
  );
}
