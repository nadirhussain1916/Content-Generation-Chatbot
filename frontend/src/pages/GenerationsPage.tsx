import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@clerk/clerk-react';
import { api } from '../lib/api';
import type { TfResponse, Asset, Message, ImagePostPackage, VideoPostPackage } from '../types';
import Sidebar from '../components/Sidebar';
import {
  ImageIcon, VideoIcon, Loader2, AlertCircle, X,
  Copy, Check, Hash, Share2, CheckCircle, ExternalLink, RefreshCw,
} from 'lucide-react';
import { cn } from '../lib/utils';

const BACKEND = import.meta.env.VITE_API_BASE_URL ?? '';
const POLL_INTERVAL_MS = 5000; // re-fetch list every 5 s when any asset is in-progress

export default function GenerationsPage() {
  const { slug } = useParams<{ slug: string }>();
  const { getToken } = useAuth();
  const navigate = useNavigate();

  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [blobUrls, setBlobUrls] = useState<Record<string, string>>({});
  const [loadingImages, setLoadingImages] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState<'all' | 'image' | 'video'>('all');
  const [detailAsset, setDetailAsset] = useState<Asset | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    const token = await getToken();
    const res = await api.get<TfResponse<Asset[]>>(
      `/api/workspaces/${slug}/generate/assets`,
      token ?? undefined
    );
    if (res.success && res.data) {
      setAssets(res.data);
      // If there are still in-progress assets, schedule another refresh
      const hasInProgress = res.data.some((a) => a.status === 'generating' || a.status === 'pending');
      if (hasInProgress) {
        pollTimer.current = setTimeout(() => load(true), POLL_INTERVAL_MS);
      }
    }
    setLoading(false);
    setRefreshing(false);
  }, [slug]);

  useEffect(() => {
    load();
    return () => { if (pollTimer.current) clearTimeout(pollTimer.current); };
  }, [load]);

  async function loadBlobUrl(asset: Asset) {
    if (asset.status !== 'ready') return;
    if (blobUrls[asset.id] || loadingImages[asset.id] || !asset.r2_key) return;
    setLoadingImages((p) => ({ ...p, [asset.id]: true }));
    try {
      const token = await getToken();
      const res = await fetch(
        `${BACKEND}/api/workspaces/${slug}/generate/assets/${asset.id}/file`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (res.ok) {
        const blob = await res.blob();
        setBlobUrls((p) => ({ ...p, [asset.id]: URL.createObjectURL(blob) }));
      }
    } finally {
      setLoadingImages((p) => ({ ...p, [asset.id]: false }));
    }
  }

  const filtered = filter === 'all' ? assets : assets.filter((a) => a.type === filter);
  const inProgressCount = assets.filter((a) => a.status === 'generating' || a.status === 'pending').length;

  return (
    <div className='flex h-screen bg-gray-950 text-white'>
      <Sidebar onNewThread={() => navigate(`/workspaces/${slug}`)} />

      <main className='flex-1 flex flex-col min-w-0 overflow-hidden relative bg-gradient-to-br from-gray-950 via-gray-950 to-violet-950/25'>
        {/* Ambient glows */}
        <div className='pointer-events-none absolute inset-0 z-0'>
          <div className='absolute -top-32 right-0 w-[600px] h-[600px] bg-violet-600/5 rounded-full blur-3xl' />
          <div className='absolute bottom-0 left-1/4 w-96 h-96 bg-violet-800/5 rounded-full blur-3xl' />
        </div>

        {/* Header */}
        <header className='relative z-10 flex items-center justify-between px-6 py-4 border-b border-gray-800/60 bg-gray-950/60 backdrop-blur-sm flex-shrink-0'>
          <div className='flex items-center gap-3'>
            <div>
              <h1 className='text-base font-semibold'>Generations</h1>
              <p className='text-xs text-gray-500 mt-0.5'>All generated images and videos</p>
            </div>
            {inProgressCount > 0 && (
              <span className='flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-amber-900/40 border border-amber-700/40 text-amber-300'>
                <Loader2 size={10} className='animate-spin' />
                {inProgressCount} generating…
              </span>
            )}
          </div>
          <div className='flex items-center gap-2'>
            <button
              onClick={() => load(true)}
              disabled={refreshing}
              title='Refresh'
              className='p-1.5 text-gray-500 hover:text-white hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-50'
            >
              <RefreshCw size={14} className={cn(refreshing && 'animate-spin')} />
            </button>
            <div className='flex items-center gap-1 bg-gray-800 rounded-lg p-1'>
              {(['all', 'image', 'video'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={cn(
                    'px-3 py-1 text-xs font-medium rounded-md transition-all capitalize',
                    filter === f ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-white'
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
        </header>

        {/* Grid */}
        <div className='relative z-10 flex-1 overflow-y-auto p-6'>
          {loading ? (
            <div className='flex justify-center py-16'>
              <Loader2 size={22} className='animate-spin text-gray-500' />
            </div>
          ) : filtered.length === 0 ? (
            <div className='flex flex-col items-center justify-center py-24 gap-3 text-center'>
              <div className='w-12 h-12 rounded-full bg-gray-800 flex items-center justify-center'>
                <ImageIcon size={22} className='text-gray-600' />
              </div>
              <p className='text-sm text-gray-400'>No generations yet</p>
              <p className='text-xs text-gray-600 max-w-xs'>
                Generated images and videos appear here after you create content in a thread.
              </p>
            </div>
          ) : (
            <div className='grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4'>
              {filtered.map((asset) => (
                <AssetCard
                  key={asset.id}
                  asset={asset}
                  slug={slug!}
                  blobUrl={blobUrls[asset.id]}
                  isLoadingBlob={loadingImages[asset.id] ?? false}
                  onVisible={() => loadBlobUrl(asset)}
                  onDetails={() => setDetailAsset(asset)}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Details modal */}
      {detailAsset && (
        <DetailsModal
          asset={detailAsset}
          slug={slug!}
          blobUrl={blobUrls[detailAsset.id]}
          onClose={() => setDetailAsset(null)}
          onOpenThread={() => navigate(`/workspaces/${slug}/threads/${detailAsset.thread_id}`)}
        />
      )}
    </div>
  );
}

// ─── Asset card ───────────────────────────────────────────────────────────────

function AssetCard({
  asset, slug, blobUrl, isLoadingBlob, onVisible, onDetails,
}: {
  asset: Asset; slug: string; blobUrl?: string; isLoadingBlob: boolean;
  onVisible: () => void; onDetails: () => void;
}) {
  const navigate = useNavigate();
  const isImage = asset.type === 'image';
  const isGenerating = asset.status === 'generating' || asset.status === 'pending';
  const isFailed = asset.status === 'failed';

  useEffect(() => { onVisible(); }, []);

  return (
    <div className={cn(
      'group relative bg-gray-900 border rounded-xl overflow-hidden flex flex-col transition-colors',
      isGenerating ? 'border-amber-700/40 hover:border-amber-600/60'
      : isFailed ? 'border-red-800/40 hover:border-red-700/60'
      : 'border-gray-800 hover:border-violet-700/50'
    )}>
      {/* Thumbnail */}
      <div className='aspect-square bg-gray-950 flex items-center justify-center relative'>
        {isGenerating ? (
          <div className='flex flex-col items-center gap-2'>
            <Loader2 size={22} className='animate-spin text-amber-500' />
            <span className='text-[10px] text-amber-400/80 font-medium'>Generating…</span>
          </div>
        ) : isFailed ? (
          <div className='flex flex-col items-center gap-2 px-3 text-center'>
            <AlertCircle size={20} className='text-red-400' />
            <span className='text-[10px] text-red-400/80 leading-tight'>
              {asset.error_message
                ? asset.error_message.slice(0, 60) + (asset.error_message.length > 60 ? '…' : '')
                : 'Generation failed'}
            </span>
          </div>
        ) : isLoadingBlob ? (
          <Loader2 size={18} className='animate-spin text-gray-600' />
        ) : blobUrl ? (
          isImage ? (
            <img src={blobUrl} alt={asset.prompt ?? ''} className='w-full h-full object-cover' />
          ) : (
            <video src={blobUrl} className='w-full h-full object-cover' muted playsInline />
          )
        ) : (
          <AlertCircle size={18} className='text-gray-600' />
        )}

        {/* Animated shimmer overlay for generating */}
        {isGenerating && (
          <div className='absolute inset-0 bg-gradient-to-r from-transparent via-amber-900/10 to-transparent animate-pulse' />
        )}
      </div>

      {/* Type + status badge */}
      <div className='absolute top-2 left-2 flex items-center gap-1'>
        <span className={cn(
          'flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full',
          isImage ? 'bg-blue-900/80 text-blue-300' : 'bg-purple-900/80 text-purple-300'
        )}>
          {isImage ? <ImageIcon size={9} /> : <VideoIcon size={9} />}
          {asset.type}
        </span>
        {isGenerating && (
          <span className='text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-900/80 text-amber-300'>
            in progress
          </span>
        )}
        {isFailed && (
          <span className='text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-red-900/80 text-red-300'>
            failed
          </span>
        )}
      </div>

      {/* Action buttons */}
      <div className='p-2 flex gap-1.5'>
        {asset.status === 'ready' ? (
          <>
            <button
              onClick={onDetails}
              className='flex-1 py-1.5 text-xs font-medium bg-violet-600 hover:bg-violet-500 text-white rounded-lg transition-colors'
            >
              Details
            </button>
            <button
              onClick={() => navigate(`/workspaces/${slug}/threads/${asset.thread_id}`)}
              className='flex-1 py-1.5 text-xs font-medium bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors flex items-center justify-center gap-1'
            >
              <ExternalLink size={10} />
              Thread
            </button>
          </>
        ) : (
          <button
            onClick={() => navigate(`/workspaces/${slug}/threads/${asset.thread_id}`)}
            className='flex-1 py-1.5 text-xs font-medium bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors flex items-center justify-center gap-1'
          >
            <ExternalLink size={10} />
            View thread
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Details modal ────────────────────────────────────────────────────────────

function DetailsModal({
  asset, slug, blobUrl, onClose, onOpenThread,
}: {
  asset: Asset; slug: string; blobUrl?: string;
  onClose: () => void; onOpenThread: () => void;
}) {
  const { getToken } = useAuth();
  const [pkg, setPkg] = useState<(ImagePostPackage & VideoPostPackage) | null>(null);
  const [loadingPkg, setLoadingPkg] = useState(true);
  const [copied, setCopied] = useState(false);
  const [publishStatus, setPublishStatus] = useState<Record<string, 'idle' | 'publishing' | 'done' | 'failed'>>({});

  useEffect(() => {
    if (!asset.message_id) { setLoadingPkg(false); return; }
    (async () => {
      const token = await getToken();
      const res = await api.get<TfResponse<{ thread: unknown; messages: Message[] }>>(
        `/api/workspaces/${slug}/threads/${asset.thread_id}`,
        token ?? undefined
      );
      if (res.success && res.data) {
        const msg = res.data.messages.find((m) => m.id === asset.message_id);
        if (msg?.post_package) {
          try { setPkg(JSON.parse(msg.post_package)); } catch {}
        }
      }
      setLoadingPkg(false);
    })();
  }, [asset.id]);

  function copy(text: string) {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function publish(platform: 'instagram' | 'tiktok') {
    setPublishStatus((s) => ({ ...s, [platform]: 'publishing' }));
    const token = await getToken();
    try {
      const body = platform === 'instagram'
        ? { assetId: asset.id, caption: pkg?.caption ?? '', hashtags: pkg?.hashtags ?? [] }
        : { assetId: asset.id, title: pkg?.title ?? '', description: pkg?.description ?? '', hashtags: pkg?.hashtags ?? [] };

      const res = await api.post<TfResponse<unknown>>(
        `/api/workspaces/${slug}/publish/${platform}`,
        body,
        token ?? undefined
      );
      setPublishStatus((s) => ({ ...s, [platform]: res.success ? 'done' : 'failed' }));
    } catch {
      setPublishStatus((s) => ({ ...s, [platform]: 'failed' }));
    }
  }

  const isVideo = asset.type === 'video';

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4'>
      <div className='bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden'>
        {/* Modal header */}
        <div className='flex items-center justify-between px-5 py-4 border-b border-gray-800'>
          <div className='flex items-center gap-2'>
            <div className='w-2 h-2 rounded-full bg-violet-500' />
            <span className='text-sm font-semibold text-white'>
              {isVideo ? 'Video' : 'Image'} details
            </span>
          </div>
          <div className='flex items-center gap-2'>
            <button
              onClick={onOpenThread}
              className='flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors'
            >
              <ExternalLink size={12} />
              Open thread
            </button>
            <button onClick={onClose} className='p-1.5 text-gray-500 hover:text-white rounded-lg hover:bg-gray-800 transition-colors'>
              <X size={16} />
            </button>
          </div>
        </div>

        <div className='overflow-y-auto flex-1 p-5 space-y-5'>
          {/* Preview */}
          {blobUrl && (
            <div className='rounded-xl overflow-hidden bg-gray-950'>
              {isVideo ? (
                <video src={blobUrl} controls className='w-full max-h-64 object-contain' />
              ) : (
                <img src={blobUrl} alt='Generated' className='w-full max-h-64 object-contain' />
              )}
            </div>
          )}

          {/* Prompt */}
          {asset.prompt && (
            <Field label='Prompt' value={asset.prompt} onCopy={() => copy(asset.prompt!)} copied={copied} mono />
          )}

          {/* Post package */}
          {loadingPkg ? (
            <div className='flex justify-center py-6'>
              <Loader2 size={16} className='animate-spin text-gray-500' />
            </div>
          ) : pkg ? (
            <>
              <Field label='Caption' value={pkg.caption} onCopy={() => copy(pkg.caption)} copied={copied} />
              {pkg.title && <Field label='TikTok title' value={pkg.title} onCopy={() => copy(pkg.title)} copied={copied} />}
              {(pkg as VideoPostPackage).script?.hook && (
                <Field label='Script hook' value={(pkg as VideoPostPackage).script.hook} onCopy={() => copy((pkg as VideoPostPackage).script.hook)} copied={copied} />
              )}
              {pkg.hashtags?.length > 0 && (
                <div>
                  <p className='text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2'>Hashtags</p>
                  <div className='flex flex-wrap gap-1.5'>
                    {pkg.hashtags.map((h) => (
                      <span key={h} className='inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-gray-800 text-violet-300 rounded-full'>
                        <Hash size={9} />{h}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className='text-xs text-gray-500 text-center py-4'>No post data available</p>
          )}
        </div>

        {/* Publish footer */}
        <div className='px-5 py-4 border-t border-gray-800 flex items-center gap-3'>
          <span className='text-xs text-gray-500 flex-1'>Publish to</span>
          {(['instagram', 'tiktok'] as const).map((platform) => {
            const s = publishStatus[platform] ?? 'idle';
            return (
              <button
                key={platform}
                onClick={() => publish(platform)}
                disabled={s === 'publishing' || s === 'done'}
                className={cn(
                  'flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-all',
                  s === 'done' ? 'bg-green-900/30 text-green-400 border border-green-700/30'
                  : s === 'failed' ? 'bg-red-900/30 text-red-400 border border-red-700/30'
                  : platform === 'instagram'
                  ? 'bg-gradient-to-r from-pink-600 to-orange-500 text-white hover:opacity-90 disabled:opacity-50'
                  : 'bg-gray-800 text-white border border-gray-700 hover:bg-gray-700 disabled:opacity-50'
                )}
              >
                {s === 'publishing' ? <Loader2 size={13} className='animate-spin' />
                  : s === 'done' ? <CheckCircle size={13} />
                  : s === 'failed' ? <AlertCircle size={13} />
                  : <Share2 size={13} />}
                {platform === 'instagram' ? 'Instagram' : 'TikTok'}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Field ────────────────────────────────────────────────────────────────────

function Field({ label, value, onCopy, copied, mono = false }: {
  label: string; value: string; onCopy: () => void; copied: boolean; mono?: boolean;
}) {
  return (
    <div>
      <div className='flex items-center justify-between mb-1.5'>
        <p className='text-xs font-semibold text-gray-400 uppercase tracking-wide'>{label}</p>
        <button onClick={onCopy} className='text-xs text-gray-500 hover:text-white flex items-center gap-1 transition-colors'>
          {copied ? <Check size={11} /> : <Copy size={11} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <p className={cn('text-sm text-gray-300 leading-relaxed', mono && 'font-mono text-xs bg-gray-800/60 p-2 rounded-lg')}>
        {value}
      </p>
    </div>
  );
}
