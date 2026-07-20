import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@clerk/clerk-react';
import { api } from '../lib/api';
import type { TfResponse, Thread, Message, Asset } from '../types';
import Sidebar from '../components/Sidebar';
import ChatMessage from '../components/ChatMessage';
import PublishBar from '../components/PublishBar';
import { Send, Loader2, ArrowLeft } from 'lucide-react';
import { cn } from '../lib/utils';

export default function ThreadPage() {
  const { slug, threadId } = useParams<{ slug: string; threadId: string }>();
  const { getToken } = useAuth();
  const navigate = useNavigate();

  const [thread, setThread] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sidebarRefreshKey, setSidebarRefreshKey] = useState(0);
  // keyed by message.id
  const [assetsByMessageId, setAssetsByMessageId] = useState<Record<string, Asset>>({});
  const [blobUrlsByMessageId, setBlobUrlsByMessageId] = useState<Record<string, string>>({});

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const BACKEND = import.meta.env.VITE_API_BASE_URL ?? '';

  async function fetchBlobForAsset(asset: Asset, token: string) {
    if (!asset.message_id) return;
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
        // Fetch blobs for all ready assets
        await Promise.all(assetsRes.data.map((a) => fetchBlobForAsset(a, token ?? '')));
      }
    }
    setLoading(false);
  }, [slug, threadId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleNewThread() {
    const token = await getToken();
    const res = await api.post<TfResponse<Thread>>(
      `/api/workspaces/${slug}/threads`,
      {},
      token ?? undefined
    );
    if (res.success && res.data) {
      setSidebarRefreshKey((k) => k + 1);
      navigate(`/workspaces/${slug}/threads/${res.data.id}`);
    }
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
        { content: content.trim() },
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
      setAssetsByMessageId((p) => ({ ...p, [asset.message_id!]: asset }));
    }
    setThread((t) => t ? { ...t, status: 'ready' } : t);
    const token = await getToken();
    await fetchBlobForAsset(asset, token ?? '');
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
    planning: 'text-yellow-400 bg-yellow-900/20 border-yellow-700/30',
    draft: 'text-blue-400 bg-blue-900/20 border-blue-700/30',
    script_ready: 'text-purple-400 bg-purple-900/20 border-purple-700/30',
    media_pending: 'text-orange-400 bg-orange-900/20 border-orange-700/30',
    ready: 'text-green-400 bg-green-900/20 border-green-700/30',
    published: 'text-gray-400 bg-gray-800 border-gray-700',
  };

  return (
    <div className='flex h-screen bg-gray-950 text-white'>
      <Sidebar onNewThread={handleNewThread} refreshKey={sidebarRefreshKey} />

      <main className='flex-1 flex flex-col min-w-0'>
        {/* Thread header */}
        <header className='flex items-center gap-3 px-4 py-3 border-b border-gray-800 bg-gray-900/50'>
          <button
            onClick={() => navigate(`/workspaces/${slug}`)}
            className='text-gray-400 hover:text-white lg:hidden'
          >
            <ArrowLeft size={18} />
          </button>
          <div className='flex-1 min-w-0'>
            <p className='text-sm font-medium truncate'>
              {thread?.title ?? 'New thread'}
            </p>
          </div>
          {thread && (
            <span className={cn('text-xs px-2 py-0.5 rounded-full border', statusColors[thread.status])}>
              {statusLabels[thread.status]}
            </span>
          )}
        </header>

        {/* Messages */}
        <div className='flex-1 overflow-y-auto px-4 py-6'>
          {loading ? (
            <div className='flex justify-center py-12'>
              <Loader2 size={20} className='animate-spin text-gray-500' />
            </div>
          ) : messages.length === 0 ? (
            <div className='flex flex-col items-center justify-center h-full gap-3 text-center'>
              <p className='text-gray-500 text-sm'>Describe what you want to create.</p>
              <p className='text-gray-600 text-xs max-w-xs'>
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
                  <div className='bg-gray-900 border border-gray-800 rounded-2xl rounded-tl-sm px-4 py-2.5'>
                    <Loader2 size={14} className='animate-spin text-gray-400' />
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
        <div className='border-t border-gray-800 p-4'>
          <div className='max-w-3xl mx-auto'>
            <div className='flex gap-3 items-end bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 focus-within:border-violet-500 transition-colors'>
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
                className='flex-1 bg-transparent text-sm text-white placeholder-gray-500 resize-none focus:outline-none max-h-32 overflow-y-auto'
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
                className='flex-shrink-0 p-1.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-all'
              >
                {sending ? (
                  <Loader2 size={16} className='animate-spin' />
                ) : (
                  <Send size={16} />
                )}
              </button>
            </div>
            <p className='text-xs text-gray-600 mt-2 text-center'>
              Press Enter to send • Shift+Enter for new line
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
