import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@clerk/clerk-react';
import { api } from '../lib/api';
import type { TfResponse, Thread, Message, Asset } from '../types';
import AppShell from '../components/AppShell';
import Sidebar from '../components/Sidebar';
import ChatMessage from '../components/ChatMessage';
import PublishBar from '../components/PublishBar';
import ModelPicker from '../components/ModelPicker';
import { Send, Loader2, ArrowLeft } from 'lucide-react';
import { cn } from '../lib/utils';
import { TEXT_MODELS, DEFAULT_TEXT_MODEL, TEXT_MODEL_KEY, readPref, writePref } from '../lib/models';

const POLL_INTERVAL_MS = 8000; // poll every 8 s — video generation can take 2-3 min

export default function ThreadPage() {
  const { slug, threadId } = useParams<{ slug: string; threadId: string }>();
  const { getToken } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [thread, setThread] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sidebarRefreshKey, setSidebarRefreshKey] = useState(0);
  const [textModel, setTextModel] = useState(() => readPref(TEXT_MODEL_KEY, DEFAULT_TEXT_MODEL));
  const initialMessageFiredRef = useRef(false);
  // keyed by message.id
  const [assetsByMessageId, setAssetsByMessageId] = useState<Record<string, Asset>>({});
  const [blobUrlsByMessageId, setBlobUrlsByMessageId] = useState<Record<string, string>>({});
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const BACKEND = import.meta.env.VITE_API_BASE_URL ?? '';

  async function fetchBlobForAsset(asset: Asset, token: string) {
    if (!asset.message_id || asset.status !== 'ready') return;
    // Use public URL directly — no Worker proxy needed
    if (asset.public_url) {
      setBlobUrlsByMessageId((p) => ({ ...p, [asset.message_id!]: asset.public_url! }));
      return;
    }
    // Fallback: stream through Worker for assets created before public bucket
    try {
      const res = await fetch(
        `${BACKEND}/api/workspaces/${slug}/generate/assets/${asset.id}/file`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (res.ok) {
        const blob = await res.blob();
        setBlobUrlsByMessageId((p) => ({ ...p, [asset.message_id!]: URL.createObjectURL(blob) }));
      }
    } catch {}
  }

  /** Lightweight poll — only re-fetches asset list, not messages */
  const pollAssets = useCallback(async (prevByMsgId: Record<string, Asset>) => {
    const token = await getToken();
    const assetsRes = await api.get<TfResponse<Asset[]>>(
      `/api/workspaces/${slug}/threads/${threadId}/assets`,
      token ?? undefined
    );
    if (!assetsRes.success || !assetsRes.data) return { nextByMsgId: prevByMsgId, hasInProgress: false };

    const nextByMsgId: Record<string, Asset> = {};
    for (const a of assetsRes.data) {
      if (a.message_id) nextByMsgId[a.message_id] = a;
    }

    // Find assets that just became ready — fetch their blobs
    const newlyReady = assetsRes.data.filter((a) => {
      const prev = a.message_id ? prevByMsgId[a.message_id] : undefined;
      return a.status === 'ready' && prev?.status !== 'ready';
    });
    await Promise.all(newlyReady.map((a) => fetchBlobForAsset(a, token ?? '')));

    setAssetsByMessageId(nextByMsgId);

    const hasInProgress = assetsRes.data.some(
      (a) => a.status === 'generating' || a.status === 'pending'
    );
    return { nextByMsgId, hasInProgress };
  }, [slug, threadId]);

  const schedulePoll = useCallback((currentByMsgId: Record<string, Asset>) => {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    pollTimer.current = setTimeout(async () => {
      const result = await pollAssets(currentByMsgId);
      if (result?.hasInProgress) schedulePoll(result.nextByMsgId);
    }, POLL_INTERVAL_MS);
  }, [pollAssets]);

  const load = useCallback(async () => {
    const token = await getToken();
    const [threadRes, assetsRes] = await Promise.all([
      api.get<TfResponse<{ thread: Thread; messages: Message[] }>>(
        `/api/workspaces/${slug}/threads/${threadId}`,
        token ?? undefined
      ),
      api.get<TfResponse<Asset[]>>(
        `/api/workspaces/${slug}/threads/${threadId}/assets`,
        token ?? undefined
      ),
    ]);
    if (threadRes.success && threadRes.data) {
      setThread(threadRes.data.thread);
      setMessages(threadRes.data.messages);

      if (assetsRes.success && assetsRes.data) {
        const byMsgId: Record<string, Asset> = {};
        for (const a of assetsRes.data) {
          if (a.message_id) byMsgId[a.message_id] = a;
        }
        setAssetsByMessageId(byMsgId);

        // Fetch blobs for all already-ready assets
        await Promise.all(
          assetsRes.data
            .filter((a) => a.status === 'ready')
            .map((a) => fetchBlobForAsset(a, token ?? ''))
        );

        // Kick off polling if any asset is still in progress
        const hasInProgress = assetsRes.data.some(
          (a) => a.status === 'generating' || a.status === 'pending'
        );
        if (hasInProgress) schedulePoll(byMsgId);
      }
    }
    setLoading(false);
  }, [slug, threadId]);

  useEffect(() => {
    load();
    return () => { if (pollTimer.current) clearTimeout(pollTimer.current); };
  }, [load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-send an initial message that was passed from WorkspacePage via router state
  useEffect(() => {
    if (loading) return;
    if (initialMessageFiredRef.current) return;
    const msg = (location.state as { initialMessage?: string } | null)?.initialMessage;
    if (!msg) return;
    initialMessageFiredRef.current = true;
    // Clear from history so a page refresh doesn't re-send
    window.history.replaceState({}, '');
    sendMessage(msg);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  function handleNewThread() {
    navigate(`/workspaces/${slug}`);
  }

  async function sendMessage(content: string) {
    if (!content.trim() || sending) return;
    setSending(true);

    // Optimistic user message
    const tempId = `temp-${Date.now()}`;
    const tempMsg: Message = {
      id: tempId,
      thread_id: threadId!,
      role: 'user',
      type: 'chat',
      content: content.trim(),
      post_package: null,
      created_at: Math.floor(Date.now() / 1000),
    };
    setMessages((prev) => [...prev, tempMsg]);
    setInput('');

    try {
      const token = await getToken();
      const res = await api.post<TfResponse<{
        userMessage: { id: string };
        assistantMessage: Message;
      }>>(
        `/api/workspaces/${slug}/threads/${threadId}/messages`,
        { content: content.trim(), textModel },
        token ?? undefined
      );

      if (res.success && res.data) {
        // Replace temp with real user message, add assistant message
        setMessages((prev) => [
          ...prev.filter((m) => m.id !== tempId),
          { ...tempMsg, id: res.data!.userMessage.id },
          res.data!.assistantMessage,
        ]);
        // Refresh thread to get updated status + title
        const threadRes = await api.get<TfResponse<{ thread: Thread; messages: Message[] }>>(
          `/api/workspaces/${slug}/threads/${threadId}`,
          token ?? undefined
        );
        if (threadRes.success && threadRes.data) {
          setThread(threadRes.data.thread);
          // Bump sidebar so the new title appears in the list
          setSidebarRefreshKey((k) => k + 1);
        }
      }
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  function handleOptionSelect(text: string) {
    sendMessage(text);
  }

  async function handleAssetGenerated(asset: Asset) {
    if (asset.message_id) {
      setAssetsByMessageId((p) => {
        const next = { ...p, [asset.message_id!]: asset };
        // If the asset is still generating, start polling to detect when it's done
        if (asset.status === 'generating' || asset.status === 'pending') {
          schedulePoll(next);
        }
        return next;
      });
    }
    if (asset.status === 'ready') {
      setThread((t) => t ? { ...t, status: 'ready' } : t);
      const token = await getToken();
      await fetchBlobForAsset(asset, token ?? '');
    }
  }

  const statusLabels: Record<Thread['status'], string> = {
    planning: 'Planning',
    draft: 'Draft ready',
    script_ready: 'Script ready',
    media_pending: 'Generating media',
    ready: 'Ready to publish',
    published: 'Published',
  };

  const statusColors: Record<Thread['status'], string> = {
    planning: 'text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/20 border-yellow-300 dark:border-yellow-700/30',
    draft: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-700/30',
    script_ready: 'text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20 border-purple-300 dark:border-purple-700/30',
    media_pending: 'text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/20 border-orange-300 dark:border-orange-700/30',
    ready: 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border-green-300 dark:border-green-700/30',
    published: 'text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-700',
  };

  return (
    <AppShell>
      <Sidebar onNewThread={handleNewThread} refreshKey={sidebarRefreshKey} />

      <main className='flex-1 flex flex-col min-w-0 bg-surface-chat/40 backdrop-blur-xl'>
        {/* Thread header */}
        <header className='flex items-center gap-3 px-5 py-4 border-b border-border-soft/60 bg-surface/50 backdrop-blur-xl'>
          <button
            onClick={() => navigate(`/workspaces/${slug}`)}
            className='text-text-secondary hover:text-text-primary lg:hidden'
          >
            <ArrowLeft size={18} />
          </button>
          <div className='flex-1 min-w-0'>
            <p className='text-chat-title text-text-primary truncate'>
              {thread?.title ?? 'New thread'}
            </p>
          </div>
          {thread && (
            <span className={cn('text-meta px-2.5 py-1 rounded-full border', statusColors[thread.status])}>
              {statusLabels[thread.status]}
            </span>
          )}
        </header>

        {/* Messages */}
        <div className='flex-1 overflow-y-auto px-4 py-6'>
          {loading ? (
            <div className='flex justify-center py-12'>
              <Loader2 size={20} className='animate-spin text-text-muted' />
            </div>
          ) : messages.length === 0 ? (
            <div className='flex flex-col items-center justify-center h-full gap-3 text-center'>
              <p className='text-text-secondary text-message'>Describe what you want to create.</p>
              <p className='text-text-muted text-meta max-w-xs'>
                The AI will ask a few questions to understand your idea, then generate a complete post.
              </p>
            </div>
          ) : (
            <div className='max-w-3xl mx-auto space-y-4'>
              {messages.map((msg) => (
                <ChatMessage
                  key={msg.id}
                  message={msg}
                  onOptionSelect={handleOptionSelect}
                  asset={assetsByMessageId[msg.id]}
                  assetBlobUrl={blobUrlsByMessageId[msg.id]}
                  slug={slug}
                  threadId={threadId}
                  onAssetGenerated={handleAssetGenerated}
                />
              ))}
              {sending && (
                <div className='flex justify-start'>
                  <div className='bg-ink rounded-2xl rounded-tl-md px-4 py-3'>
                    <Loader2 size={14} className='animate-spin text-on-ink' />
                  </div>
                </div>
              )}

              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* Publish bar (shows when ready) */}
        {thread && thread.status === 'ready' && (
          <PublishBar
            slug={slug!}
            thread={thread}
            onPublished={() => setThread((t) => t ? { ...t, status: 'published' } : t)}
          />
        )}

        {/* Input */}
        <div className='border-t border-border-soft/60 bg-surface/50 backdrop-blur-xl p-4'>
          <div className='max-w-3xl mx-auto'>
            <div className='bg-surface-white rounded-3xl shadow-[0_3px_15px_rgba(0,0,0,0.04)] border border-black/[0.04] dark:border-white/[0.06] focus-within:shadow-[0_4px_20px_rgba(0,0,0,0.08)] transition-shadow'>
              <div className='flex gap-3 items-end pl-5 pr-2 pt-3 pb-2'>
                <textarea
                  ref={inputRef}
                  rows={1}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={
                    thread?.status === 'planning'
                      ? 'Describe what you want to create...'
                      : 'Ask for changes, refinements, or say "looks good"...'
                  }
                  className='flex-1 bg-transparent text-message text-text-primary placeholder-text-muted resize-none focus:outline-none max-h-32 overflow-y-auto py-2'
                  style={{ height: 'auto' }}
                  onInput={(e) => {
                    const el = e.currentTarget;
                    el.style.height = 'auto';
                    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
                  }}
                  disabled={thread?.status === 'published'}
                />
                <button
                  onClick={() => sendMessage(input)}
                  disabled={!input.trim() || sending || thread?.status === 'published'}
                  className='flex-shrink-0 w-10 h-10 flex items-center justify-center bg-ink hover:bg-ink-hover disabled:opacity-30 disabled:cursor-not-allowed rounded-full transition-all hover:scale-[1.04]'
                >
                  {sending ? (
                    <Loader2 size={16} className='animate-spin text-on-ink' />
                  ) : (
                    <Send size={16} className='text-on-ink' />
                  )}
                </button>
              </div>
              {/* Model selector row */}
              <div className='px-4 pb-2.5 flex items-center gap-1'>
                <span className='text-meta text-text-muted'>Model</span>
                <ModelPicker
                  options={TEXT_MODELS}
                  value={textModel}
                  onChange={(id) => { setTextModel(id); writePref(TEXT_MODEL_KEY, id); }}
                />
              </div>
            </div>
            <p className='text-meta text-text-muted mt-2.5 text-center'>
              Press Enter to send • Shift+Enter for new line
            </p>
          </div>
        </div>
      </main>
    </AppShell>
  );
}
