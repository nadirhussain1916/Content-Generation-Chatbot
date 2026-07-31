import { useState } from 'react';
import type { Thread } from '../types';
import { usePublishStatus } from '../hooks/usePublishStatus';
import { Share2, Loader2, CheckCircle, AlertCircle, ImageIcon, Video } from 'lucide-react';
import { cn } from '../lib/utils';

interface PublishBarProps {
  slug: string;
  thread: Thread;
  onPublished?: () => void;
}

export default function PublishBar({ slug, thread, onPublished }: PublishBarProps) {
  const [publishingTo, setPublishingTo] = useState<string | null>(null);
  const { status, publish } = usePublishStatus(slug, thread.active_draft_id ?? undefined);

  const canPublish = thread.status === 'ready' && thread.active_draft_id;

  async function handlePublish(platform: 'instagram' | 'tiktok') {
    if (!canPublish) return;
    setPublishingTo(platform);
    await publish(platform, { assetId: thread.active_draft_id, caption: 'Created with AI' });
    setPublishingTo(null);
    if (status[platform] === 'done') onPublished?.();
  }

  if (!canPublish && thread.status !== 'ready') return null;

  const statusIcon = (p: string) => {
    const s = status[p] ?? 'idle';
    if (s === 'publishing' || s === 'processing') return <Loader2 size={14} className='animate-spin' />;
    if (s === 'done') return <CheckCircle size={14} />;
    if (s === 'failed') return <AlertCircle size={14} />;
    return <Share2 size={14} />;
  };

  const statusLabel = (p: 'instagram' | 'tiktok') => {
    const s = status[p] ?? 'idle';
    if (s === 'processing') return 'Processing…';
    return p === 'instagram' ? 'Instagram' : 'TikTok';
  };

  return (
    <div className='border-t border-border-soft bg-surface-card/60 px-4 py-3'>
      <div className='flex items-center gap-2'>
        <div className='flex items-center gap-1.5 text-meta text-text-secondary'>
          {thread.media_type === 'image' ? (
            <ImageIcon size={13} />
          ) : (
            <Video size={13} />
          )}
          <span>Ready to publish</span>
        </div>
        <div className='flex-1' />
        {(['instagram', 'tiktok'] as const).map((platform) => {
          const s = status[platform] ?? 'idle';
          return (
            <button
              key={platform}
              onClick={() => handlePublish(platform)}
              disabled={!!publishingTo || s === 'done' || s === 'processing'}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-meta font-medium transition-all',
                s === 'done' ? 'bg-green-900/10 text-green-700 dark:text-green-400 border border-green-700/20'
                : s === 'failed' ? 'bg-red-900/10 text-red-700 dark:text-red-400 border border-red-700/20'
                : s === 'processing' ? 'bg-yellow-900/10 text-yellow-700 dark:text-yellow-400 border border-yellow-700/20'
                : platform === 'instagram'
                ? 'bg-gradient-to-r from-pink-600 to-orange-500 text-white hover:opacity-90 disabled:opacity-50'
                : 'bg-brand text-on-brand hover:bg-brand-hover disabled:opacity-50'
              )}
            >
              {statusIcon(platform)}
              {statusLabel(platform)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
