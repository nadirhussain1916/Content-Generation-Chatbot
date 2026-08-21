import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useAuthToken } from '../hooks/useAuthToken';
import { api } from '../lib/api';
import type { TfResponse, Thread, Workspace } from '../types';
import AppShell from '../components/AppShell';
import Sidebar from '../components/Sidebar';
import ChatInput, { type ImageReference } from '../components/ChatInput';
import { Loader2, Zap, AlertCircle } from 'lucide-react';
import { DEFAULT_TEXT_MODEL, TEXT_MODEL_KEY, readPref, writePref } from '../lib/models';

export default function WorkspacePage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { getAuthToken } = useAuthToken();
  const [creating, setCreating] = useState(false);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [textModel, setTextModel] = useState<string>(() => readPref(TEXT_MODEL_KEY, DEFAULT_TEXT_MODEL));

  useEffect(() => {
    (async () => {
      const token = await getAuthToken();
      const res = await api.get<TfResponse<Workspace>>(`/api/workspaces/${slug}`, token ?? undefined);
      if (res.success && res.data) setWorkspace(res.data);
    })();
  }, [slug]);

  const hasBrandContext = !!(
    workspace?.brand_name ||
    workspace?.brand_description ||
    workspace?.brand_voice ||
    workspace?.target_audience ||
    workspace?.agent_instructions
  );

  async function handleSend(content: string, imageReferences: ImageReference[]) {
    if (!content || creating) return;
    setCreating(true);
    try {
      const token = await getAuthToken();
      const res = await api.post<TfResponse<Thread>>(
        `/api/workspaces/${slug}/threads`,
        {},
        token ?? undefined
      );
      if (res.success && res.data) {
        navigate(`/workspaces/${slug}/threads/${res.data.id}`, {
          state: { initialMessage: content, imageReferences },
        });
      }
    } finally {
      setCreating(false);
    }
  }

  return (
    <AppShell>
      <Sidebar onNewThread={() => {}} />

      <main className='flex-1 flex flex-col items-center justify-center px-4 bg-surface-chat/40 backdrop-blur-xl'>
        {/* Greeting */}
        <div className='text-center mb-8'>
          <div className='w-12 h-12 rounded-2xl bg-ink flex items-center justify-center mx-auto mb-4'>
            <Zap size={22} className='text-on-ink' />
          </div>
          <h1 className='text-heading text-text-primary mb-1'>What do you want to create?</h1>
          <p className='text-text-secondary text-message'>Describe your idea and the AI will guide you through the rest.</p>
        </div>

        {/* Brand context nudge */}
        {workspace && !hasBrandContext && (
          <div className='w-full max-w-2xl mb-4'>
            <div className='flex items-start gap-2.5 bg-surface-white border border-amber-300/40 dark:border-amber-700/30 rounded-xl px-4 py-3 text-message text-text-secondary'>
              <AlertCircle size={15} className='mt-0.5 flex-shrink-0 text-amber-500' />
              <span>
                The AI doesn't know your brand yet — it won't be able to answer business questions.{' '}
                <Link
                  to={`/workspaces/${slug}/settings`}
                  className='underline underline-offset-2 text-text-primary hover:text-ink transition-colors'
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
          {creating ? (
            <div className='flex justify-center py-6'>
              <Loader2 size={20} className='animate-spin text-text-muted' />
            </div>
          ) : (
            <ChatInput
              slug={slug!}
              onSend={handleSend}
              sending={creating}
              rounded='2xl'
              arrowSend
              autoFocus
              textModel={textModel}
              onTextModelChange={(id) => { setTextModel(id); writePref(TEXT_MODEL_KEY, id); }}
            />
          )}
          <p className='text-meta text-text-muted mt-2.5 text-center'>
            Press Enter to send · Shift+Enter for new line
          </p>
        </div>
      </main>
    </AppShell>
  );
}
