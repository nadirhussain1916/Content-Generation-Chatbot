import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuthToken } from '../hooks/useAuthToken';
import { api } from '../lib/api';
import type { TfResponse, Asset, Message, ImagePostPackage, VideoPostPackage, WorkspaceUpload, Workspace, GenerationJob } from '../types';
import { usePublishStatus } from '../hooks/usePublishStatus';
import AppShell from '../components/AppShell';
import Sidebar from '../components/Sidebar';
import {
  ImageIcon, VideoIcon, Loader2, AlertCircle, X, Play,
  Copy, Check, Hash, Share2, CheckCircle, ExternalLink, RefreshCw, Download, Cpu, DollarSign, Star,
  Combine, Wand2, Sparkles, ChevronRight,
} from 'lucide-react';
import { cn } from '../lib/utils';
import ModelPicker from '../components/ModelPicker';
import {
  VIDEO_MODELS, DEFAULT_VIDEO_MODEL, I2V_CAPABLE_MODEL_IDS,
  VIDEO_DURATIONS, MODEL_MAX_CLIP_SECONDS,
  type VideoModelId,
} from '../lib/models';

// ─── Model display helpers ─────────────────────────────────────────────────────

import { shortModelLabel, formatCost, friendlyErrorMessage } from '../lib/display';

const BACKEND = import.meta.env.VITE_API_BASE_URL ?? '';
const POLL_INTERVAL_MS = 5000; // re-fetch list every 5 s when any asset is in-progress

export default function GenerationsPage() {
  const { slug } = useParams<{ slug: string }>();
  const { getAuthToken: getToken } = useAuthToken();
  const navigate = useNavigate();

  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Legacy blob URLs for assets that predate public bucket (no public_url in DB)
  const [blobUrls, setBlobUrls] = useState<Record<string, string>>({});
  const [loadingImages, setLoadingImages] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState<'all' | 'image' | 'video'>('all');
  const [detailAsset, setDetailAsset] = useState<Asset | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Combine (Flow B) + Continue (Flow C) ──────────────────────────────────
  const [combineMode, setCombineMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [combining, setCombining] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [continueAsset, setContinueAsset] = useState<Asset | null>(null);

  function toggleSelect(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }
  function enterCombine() { setCombineMode(true); setFilter('video'); setSelectedIds([]); setActionError(null); }
  function exitCombine() { setCombineMode(false); setSelectedIds([]); setActionError(null); }

  async function handleCombine() {
    if (selectedIds.length < 2) return;
    setCombining(true);
    setActionError(null);
    try {
      const token = await getToken();
      const res = await api.post<TfResponse<{ assetId: string; status: string }>>(
        `/api/workspaces/${slug}/generate/combine`,
        { assetIds: selectedIds },
        token ?? undefined,
      );
      if (!res.success) throw new Error(res.message ?? 'Combine failed');
      exitCombine();
      await load(true);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Combine failed');
    } finally {
      setCombining(false);
    }
  }

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
    // Use public URL directly — no Worker proxy needed
    if (asset.public_url) {
      setBlobUrls((p) => ({ ...p, [asset.id]: asset.public_url! }));
      return;
    }
    // Fallback: stream through Worker for assets created before public bucket
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
    <AppShell>
      <Sidebar onNewThread={() => navigate(`/workspaces/${slug}`)} />

      <main className='flex-1 flex flex-col min-w-0 bg-surface-chat/25 backdrop-blur-xl'>
        {/* Header */}
        <header className='flex items-center justify-between px-6 py-4 border-b border-border-soft/60 bg-surface/40 backdrop-blur-xl flex-shrink-0'>
          <div className='flex items-center gap-3'>
            <div>
              <h1 className='text-heading text-text-primary'>Generations</h1>
              <p className='text-meta text-text-secondary mt-0.5'>All generated images and videos</p>
            </div>
            {inProgressCount > 0 && (
              <span className='flex items-center gap-1.5 text-meta font-medium px-2.5 py-1 rounded-full bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700/30 text-amber-600 dark:text-amber-400'>
                <Loader2 size={10} className='animate-spin' />
                {inProgressCount} generating…
              </span>
            )}
          </div>
          <div className='flex items-center gap-2'>
            {combineMode ? (
              <button
                onClick={exitCombine}
                className='flex items-center gap-1.5 px-3 py-1.5 text-meta font-medium rounded-full bg-surface-card text-text-secondary hover:text-text-primary transition-colors'
              >
                <X size={13} /> Cancel
              </button>
            ) : (
              <button
                onClick={enterCombine}
                title='Combine multiple videos into one'
                className='flex items-center gap-1.5 px-3 py-1.5 text-meta font-medium rounded-full bg-surface-card text-text-secondary hover:text-text-primary transition-colors'
              >
                <Combine size={13} /> Combine
              </button>
            )}
            <button
              onClick={() => load(true)}
              disabled={refreshing}
              title='Refresh'
              className='p-1.5 text-text-muted hover:text-text-primary hover:bg-surface-card rounded-lg transition-colors disabled:opacity-50'
            >
              <RefreshCw size={14} className={cn(refreshing && 'animate-spin')} />
            </button>
            <div className='flex items-center gap-1 bg-surface-card rounded-full p-1'>
              {(['all', 'image', 'video'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={cn(
                    'px-3 py-1 text-meta font-medium rounded-full transition-all capitalize',
                    filter === f ? 'bg-ink text-on-ink' : 'text-text-secondary hover:text-text-primary'
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
        </header>

        {/* Grid */}
        <div className='flex-1 overflow-y-auto p-6'>
          {loading ? (
            <div className='flex justify-center py-16'>
              <Loader2 size={22} className='animate-spin text-text-muted' />
            </div>
          ) : filtered.length === 0 ? (
            <div className='flex flex-col items-center justify-center py-24 gap-3 text-center'>
              <div className='w-12 h-12 rounded-full bg-surface-card flex items-center justify-center'>
                <ImageIcon size={22} className='text-text-muted' />
              </div>
              <p className='text-message text-text-secondary'>No generations yet</p>
              <p className='text-meta text-text-muted max-w-xs'>
                Generated images and videos appear here after you create content in a thread.
              </p>
            </div>
          ) : (
            <div className='grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 auto-rows-fr gap-4'>
              {filtered.map((asset) => (
                <AssetCard
                  key={asset.id}
                  asset={asset}
                  slug={slug!}
                  blobUrl={blobUrls[asset.id]}
                  isLoadingBlob={loadingImages[asset.id] ?? false}
                  combineMode={combineMode}
                  selectionIndex={selectedIds.indexOf(asset.id)}
                  onToggleSelect={() => toggleSelect(asset.id)}
                  onContinue={() => setContinueAsset(asset)}
                  onVisible={() => loadBlobUrl(asset)}
                  onDetails={() => setDetailAsset(asset)}
                  onRecover={async () => {
                    const token = await getToken();
                    // No body — the backend recovers from the prediction ID it stored
                    // for this asset as the generation progressed.
                    const res = await api.post<TfResponse<Asset>>(
                      `/api/workspaces/${slug}/generate/assets/${asset.id}/recover`,
                      {},
                      token ?? undefined
                    );
                    if (!res.success) throw new Error(res.message ?? 'Recovery failed');
                    await load(true);
                  }}
                  onRetry={async () => {
                    const token = await getToken();
                    // Re-runs the stitch, reusing parts that already succeeded.
                    const res = await api.post<TfResponse<{ assetId: string; status: string }>>(
                      `/api/workspaces/${slug}/generate/assets/${asset.id}/retry`,
                      {},
                      token ?? undefined
                    );
                    if (!res.success) throw new Error(res.message ?? 'Retry failed');
                    await load(true);
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Floating Combine action bar */}
      {combineMode && (
        <div className='fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 rounded-full border border-border-soft bg-surface-white px-4 py-2.5 shadow-[0_12px_40px_rgba(0,0,0,0.16)]'>
          <span className='text-meta text-text-secondary'>
            {selectedIds.length === 0
              ? 'Select videos to combine (in order)'
              : `${selectedIds.length} selected`}
          </span>
          {actionError && <span className='text-meta text-red-500'>{actionError}</span>}
          <button
            onClick={handleCombine}
            disabled={selectedIds.length < 2 || combining}
            className='flex items-center gap-1.5 rounded-full bg-brand px-4 py-1.5 text-meta font-semibold text-on-brand transition-colors hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed'
          >
            {combining ? <Loader2 size={13} className='animate-spin' /> : <Combine size={13} />}
            {combining ? 'Combining…' : `Combine ${selectedIds.length || ''}`.trim()}
          </button>
        </div>
      )}

      {/* Continue modal */}
      {continueAsset && (
        <ContinueModal
          asset={continueAsset}
          slug={slug!}
          blobUrl={blobUrls[continueAsset.id]}
          onClose={() => setContinueAsset(null)}
          onStarted={async () => { setContinueAsset(null); await load(true); }}
        />
      )}

      {/* Details modal */}
      {detailAsset && (
        <DetailsModal
          asset={detailAsset}
          slug={slug!}
          blobUrl={blobUrls[detailAsset.id]}
          assets={assets}
          onClose={() => setDetailAsset(null)}
          onOpenThread={() => navigate(`/workspaces/${slug}/threads/${detailAsset.thread_id}`)}
        />
      )}
    </AppShell>
  );
}

// ─── Asset card ───────────────────────────────────────────────────────────────

async function downloadAsset(asset: Asset, blobUrl?: string, aiLabel = false) {
  const href = blobUrl ?? asset.public_url;
  if (!href) return;

  const shortId = asset.id.slice(0, 8);

  if (asset.type === 'image' && aiLabel) {
    // Draw "AI Generated" overlay on a canvas then download as PNG
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = reject; img.src = href; });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    // Overlay banner
    const bannerH = Math.max(28, Math.round(img.naturalHeight * 0.045));
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(0, img.naturalHeight - bannerH, img.naturalWidth, bannerH);
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.round(bannerH * 0.52)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('AI Generated', img.naturalWidth / 2, img.naturalHeight - bannerH / 2);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ai-generated-image-${shortId}.png`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }, 'image/png');
    return;
  }

  // Video or non-labelled image — plain download, filename encodes disclosure
  const ext = asset.type === 'video' ? 'mp4' : 'png';
  const prefix = aiLabel ? 'AI-Generated-' : '';
  const filename = `${prefix}${asset.type}-${shortId}.${ext}`;
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  a.rel = 'noopener noreferrer';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

// Format a playback length (seconds) as m:ss — e.g. 9 → "0:09", 75 → "1:15".
function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function AssetCard({
  asset, slug, blobUrl, isLoadingBlob, combineMode, selectionIndex, onToggleSelect, onContinue, onVisible, onDetails, onRecover, onRetry,
}: {
  asset: Asset; slug: string; blobUrl?: string; isLoadingBlob: boolean;
  combineMode: boolean; selectionIndex: number;
  onToggleSelect: () => void; onContinue: () => void;
  onVisible: () => void; onDetails: () => void; onRecover: () => Promise<void>; onRetry: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const isImage = asset.type === 'image';
  const isVideo = asset.type === 'video';
  const isGenerating = asset.status === 'generating' || asset.status === 'pending';
  const isFailed = asset.status === 'failed';
  const isReady = asset.status === 'ready';
  // How the video was assembled (authoritative field; falls back to the ffmpeg-concat
  // model slug for legacy rows created before generation_method existed).
  const method = asset.generation_method;
  const isMultiPart =
    method === 'combine' || method === 'continue' || method === 'generate_stitch' || asset.model === 'ffmpeg-concat';
  const methodLabel: string | null = !isVideo
    ? null
    : method === 'combine' || asset.model === 'ffmpeg-concat' ? 'combined'
    : method === 'continue' ? 'continued'
    : method === 'generate_stitch' ? 'stitched'
    : null;
  // Recovery re-imports ONE finished Replicate prediction — only meaningful for a
  // single-clip video. Multi-part videos (combine/stitch/continue) have no single
  // prediction; a failed one is fixed by "Retry" (regenerate only the failed parts).
  const canRecover = isFailed && isVideo && !!asset.prediction_id && !isMultiPart;
  const canRetry = isFailed && isVideo && isMultiPart;
  const progress = asset.progress && asset.progress.total > 0 ? asset.progress : null;
  // Combine (Flow B) only works on ready videos; other cards are inert while selecting.
  const selectable = combineMode && isReady && isVideo;
  const isSelected = selectionIndex >= 0;

  const [recovering, setRecovering] = useState(false);
  const [recoverError, setRecoverError] = useState<string | null>(null);
  // Actual playback duration, read from the video's own metadata once it loads.
  const [duration, setDuration] = useState<number | null>(null);

  async function handleRecover() {
    setRecovering(true);
    setRecoverError(null);
    try {
      await onRecover();
    } catch (e) {
      setRecoverError(e instanceof Error ? e.message : 'Recovery failed');
    } finally {
      setRecovering(false);
    }
  }

  async function handleRetry() {
    setRecovering(true);
    setRecoverError(null);
    try {
      await onRetry();
    } catch (e) {
      setRecoverError(e instanceof Error ? e.message : 'Retry failed');
    } finally {
      setRecovering(false);
    }
  }

  // Re-run when the asset flips to ready or gains a public_url (e.g. via the in-page
  // refresh/poll). A mount-only effect misses the generating→ready transition because
  // the card is reused (same key) rather than remounted, leaving blobUrl undefined.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { onVisible(); }, [asset.status, asset.public_url]);

  return (
    <div className={cn(
      'group relative flex h-full flex-col overflow-hidden rounded-2xl bg-surface-card border transition-all duration-200',
      'shadow-[0_1px_3px_rgba(0,0,0,0.04)] hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(0,0,0,0.10)]',
      isSelected ? 'border-brand ring-2 ring-brand'
      : isGenerating ? 'border-amber-300/50 dark:border-amber-700/30'
      : isFailed ? 'border-red-300/50 dark:border-red-800/30'
      : 'border-border-soft/70 hover:border-ink/25',
      combineMode && !selectable && 'opacity-40',
    )}>
      {/* Media — fixed square. Content is absolutely positioned so a portrait
          video can never override the aspect ratio and stretch the grid row. */}
      <div
        onClick={combineMode ? (selectable ? onToggleSelect : undefined) : isReady ? onDetails : undefined}
        className={cn(
          'relative aspect-square w-full overflow-hidden bg-gradient-to-br from-surface-white to-surface-card',
          (selectable || (!combineMode && isReady)) && 'cursor-pointer',
        )}
      >
        {/* Selection indicator (Combine mode) */}
        {selectable && (
          <div className='absolute right-2 top-2 z-10'>
            {isSelected ? (
              <span className='flex h-6 w-6 items-center justify-center rounded-full bg-brand text-[11px] font-bold text-on-brand shadow'>
                {selectionIndex + 1}
              </span>
            ) : (
              <span className='block h-6 w-6 rounded-full border-2 border-white/80 bg-black/25 shadow' />
            )}
          </div>
        )}
        {isGenerating ? (
          <div className='absolute inset-0 flex flex-col items-center justify-center gap-2'>
            <Loader2 size={22} className='animate-spin text-amber-500' />
            <span className='text-meta font-medium text-amber-600 dark:text-amber-400/80'>
              {progress
                ? progress.done >= progress.total
                  ? 'Stitching…'
                  : `Part ${progress.done + 1}/${progress.total}…`
                : 'Generating…'}
            </span>
            {progress && (
              <div className='mt-0.5 h-1 w-2/3 overflow-hidden rounded-full bg-amber-200/50 dark:bg-amber-900/30'>
                <div
                  className='h-full rounded-full bg-amber-500 transition-all duration-500'
                  style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
                />
              </div>
            )}
            <div className='absolute inset-0 bg-gradient-to-r from-transparent via-amber-100/25 dark:via-amber-900/10 to-transparent animate-pulse' />
          </div>
        ) : isFailed ? (
          <div className='absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center'>
            <div className='flex h-9 w-9 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30'>
              <AlertCircle size={18} className='text-red-500 dark:text-red-400' />
            </div>
            <span className='text-meta leading-tight text-red-600/90 dark:text-red-400/80 line-clamp-2'>
              {friendlyErrorMessage(asset.error_message).slice(0, 160)}
            </span>
          </div>
        ) : isLoadingBlob ? (
          <div className='absolute inset-0 flex items-center justify-center'>
            <Loader2 size={18} className='animate-spin text-text-muted' />
          </div>
        ) : blobUrl ? (
          isImage ? (
            <img
              src={blobUrl}
              alt={asset.prompt ?? ''}
              className='absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]'
            />
          ) : (
            <>
              <video
                src={blobUrl}
                className='absolute inset-0 h-full w-full object-cover'
                muted
                playsInline
                preload='metadata'
                onLoadedMetadata={(e) => {
                  const d = e.currentTarget.duration;
                  if (Number.isFinite(d) && d > 0) setDuration(d);
                }}
              />
              <div className='pointer-events-none absolute inset-0 flex items-center justify-center opacity-90 transition-opacity group-hover:opacity-100'>
                <div className='flex h-11 w-11 items-center justify-center rounded-full bg-black/45 backdrop-blur-sm ring-1 ring-white/20'>
                  <Play size={18} className='translate-x-0.5 text-white' fill='currentColor' />
                </div>
              </div>
              {duration != null && (
                <span className='pointer-events-none absolute bottom-2 right-2 rounded-md bg-black/60 px-1.5 py-0.5 text-meta font-medium text-white tabular-nums shadow-sm backdrop-blur-sm'>
                  {formatDuration(duration)}
                </span>
              )}
            </>
          )
        ) : (
          <div className='absolute inset-0 flex items-center justify-center'>
            <AlertCircle size={18} className='text-text-muted' />
          </div>
        )}

        {/* Scrim so badges stay legible over any media */}
        {isReady && blobUrl && (
          <div className='pointer-events-none absolute inset-x-0 top-0 h-14 bg-gradient-to-b from-black/35 to-transparent' />
        )}

        {/* Badges */}
        <div className='absolute left-2 top-2 flex items-center gap-1'>
          <span className={cn(
            'flex items-center gap-1 rounded-full px-2 py-0.5 text-meta font-semibold text-white shadow-sm backdrop-blur-sm',
            isImage ? 'bg-blue-500/85' : 'bg-purple-500/85'
          )}>
            {isImage ? <ImageIcon size={9} /> : <VideoIcon size={9} />}
            {asset.type}
          </span>
          {methodLabel && (
            <span
              title={methodLabel === 'combined'
                ? 'Assembled from multiple existing clips (ffmpeg concat)'
                : 'Generated in parts and stitched together'}
              className='flex items-center gap-1 rounded-full bg-teal-500/85 px-2 py-0.5 text-meta font-semibold text-white shadow-sm backdrop-blur-sm'
            >
              <Combine size={9} />
              {methodLabel}
            </span>
          )}
          {isGenerating && (
            <span className='rounded-full bg-amber-500/85 px-2 py-0.5 text-meta font-semibold text-white shadow-sm backdrop-blur-sm'>
              in progress
            </span>
          )}
          {isFailed && (
            <span className='rounded-full bg-red-500/85 px-2 py-0.5 text-meta font-semibold text-white shadow-sm backdrop-blur-sm'>
              failed
            </span>
          )}
        </div>

        {/* Hover-reveal download for ready assets */}
        {isReady && blobUrl && !combineMode && (
          <button
            onClick={(e) => { e.stopPropagation(); downloadAsset(asset, blobUrl, false); }}
            title='Download'
            className='absolute right-2 top-2 rounded-full bg-black/45 p-1.5 text-white opacity-0 shadow-sm backdrop-blur-sm transition-all hover:bg-black/70 group-hover:opacity-100'
          >
            <Download size={12} />
          </button>
        )}
      </div>

      {/* Footer */}
      <div className='flex flex-1 flex-col justify-between gap-2 p-2.5'>
        {isReady && (asset.model || formatCost(asset.cost_usd)) ? (
          <div className='flex flex-wrap items-center gap-1.5'>
            {asset.model && (
              <span className='flex items-center gap-1 rounded-md border border-border-soft bg-surface-white px-1.5 py-0.5 text-meta text-text-muted'>
                <Cpu size={8} />
                {shortModelLabel(asset.model)}
              </span>
            )}
            {formatCost(asset.cost_usd) && (
              <span className='rounded-md border border-border-soft bg-surface-white px-1.5 py-0.5 text-meta text-text-muted'>
                {formatCost(asset.cost_usd)}
              </span>
            )}
          </div>
        ) : (
          <div className='min-h-0' />
        )}

        {isReady ? (
          isVideo ? (
            <div className='flex items-center gap-1.5'>
              <button
                onClick={onDetails}
                disabled={combineMode}
                className='flex-1 rounded-lg bg-brand py-1.5 text-meta font-semibold text-on-brand transition-colors hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed'
              >
                Details
              </button>
              <button
                onClick={onContinue}
                disabled={combineMode}
                title='Generate the next part of this video'
                className='flex items-center justify-center gap-1 rounded-lg border border-border-soft bg-surface-white px-2 py-1.5 text-meta font-medium text-text-secondary transition-colors hover:bg-surface hover:text-text-primary disabled:opacity-50 disabled:cursor-not-allowed'
              >
                <Wand2 size={11} /> Continue
              </button>
            </div>
          ) : (
            <button
              onClick={onDetails}
              disabled={combineMode}
              className='w-full rounded-lg bg-brand py-1.5 text-meta font-semibold text-on-brand transition-colors hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed'
            >
              Details
            </button>
          )
        ) : canRecover ? (
          <div className='flex flex-col gap-1'>
            <div className='flex items-center gap-1.5'>
              <button
                onClick={handleRecover}
                disabled={recovering}
                title='Re-import this generation from Replicate (it succeeded but failed to save)'
                className='flex flex-1 items-center justify-center gap-1 rounded-lg bg-brand py-1.5 text-meta font-semibold text-on-brand transition-colors hover:bg-brand-hover disabled:opacity-60 disabled:cursor-not-allowed'
              >
                {recovering ? <Loader2 size={10} className='animate-spin' /> : <RefreshCw size={10} />}
                {recovering ? 'Recovering…' : 'Recover'}
              </button>
              <button
                onClick={() => navigate(`/workspaces/${slug}/threads/${asset.thread_id}`)}
                title='View thread'
                className='flex items-center justify-center rounded-lg border border-border-soft bg-surface-white px-2 py-1.5 text-text-secondary transition-colors hover:bg-surface hover:text-text-primary'
              >
                <ExternalLink size={12} />
              </button>
            </div>
            {recoverError && (
              <span className='text-[10px] leading-snug text-red-600/90 dark:text-red-400/80 line-clamp-2'>
                {recoverError}
              </span>
            )}
          </div>
        ) : canRetry ? (
          <div className='flex flex-col gap-1'>
            <div className='flex items-center gap-1.5'>
              <button
                onClick={handleRetry}
                disabled={recovering}
                title='Regenerate only the parts that failed, then re-stitch the video'
                className='flex flex-1 items-center justify-center gap-1 rounded-lg bg-brand py-1.5 text-meta font-semibold text-on-brand transition-colors hover:bg-brand-hover disabled:opacity-60 disabled:cursor-not-allowed'
              >
                {recovering ? <Loader2 size={10} className='animate-spin' /> : <RefreshCw size={10} />}
                {recovering ? 'Retrying…' : 'Retry parts'}
              </button>
              <button
                onClick={onDetails}
                title='View parts breakdown'
                className='flex items-center justify-center rounded-lg border border-border-soft bg-surface-white px-2 py-1.5 text-text-secondary transition-colors hover:bg-surface hover:text-text-primary'
              >
                <ExternalLink size={12} />
              </button>
            </div>
            {recoverError && (
              <span className='text-[10px] leading-snug text-red-600/90 dark:text-red-400/80 line-clamp-2'>
                {recoverError}
              </span>
            )}
          </div>
        ) : (
          <button
            onClick={() => navigate(`/workspaces/${slug}/threads/${asset.thread_id}`)}
            className='flex w-full items-center justify-center gap-1 rounded-lg border border-border-soft bg-surface-white py-1.5 text-meta font-medium text-text-secondary transition-colors hover:bg-surface hover:text-text-primary'
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
  asset, slug, blobUrl, assets, onClose, onOpenThread,
}: {
  asset: Asset; slug: string; blobUrl?: string; assets: Asset[];
  onClose: () => void; onOpenThread: () => void;
}) {
  const { getAuthToken: getToken } = useAuthToken();
  const [pkg, setPkg] = useState<(ImagePostPackage & VideoPostPackage) | null>(null);
  const [loadingPkg, setLoadingPkg] = useState(true);
  const [copied, setCopied] = useState(false);
  const [aiLabel, setAiLabel] = useState(false);
  const [jobs, setJobs] = useState<GenerationJob[]>([]);
  const isMultiPart =
    (asset.generation_method != null && asset.generation_method !== 'single') || asset.model === 'ffmpeg-concat';
  // Uploads + workspace character — needed to mirror the draft's reference images
  const [uploads, setUploads] = useState<WorkspaceUpload[]>([]);
  const [character, setCharacter] = useState<{ name: string | null; appearance: string | null; referenceIds: string[] }>(
    { name: null, appearance: null, referenceIds: [] }
  );
  const { status: publishStatus, publish: publishAsset } = usePublishStatus(slug, asset.id);

  useEffect(() => {
    if (!asset.message_id) { setLoadingPkg(false); return; }
    (async () => {
      const token = await getToken();
      const [threadRes, wsRes, uploadsRes] = await Promise.all([
        api.get<TfResponse<{ thread: unknown; messages: Message[] }>>(
          `/api/workspaces/${slug}/threads/${asset.thread_id}`,
          token ?? undefined
        ),
        api.get<TfResponse<Workspace>>(`/api/workspaces/${slug}`, token ?? undefined),
        api.get<TfResponse<WorkspaceUpload[]>>(`/api/workspaces/${slug}/uploads`, token ?? undefined),
      ]);
      if (threadRes.success && threadRes.data) {
        const msg = threadRes.data.messages.find((m) => m.id === asset.message_id);
        if (msg?.post_package) {
          try { setPkg(JSON.parse(msg.post_package)); } catch {}
        }
      }
      if (wsRes.success && wsRes.data) {
        let referenceIds: string[] = [];
        try { referenceIds = JSON.parse(wsRes.data.character_reference_ids ?? '[]') as string[]; } catch { /* ignore */ }
        setCharacter({ name: wsRes.data.character_name, appearance: wsRes.data.character_appearance, referenceIds });
      }
      if (uploadsRes.success && uploadsRes.data) setUploads(uploadsRes.data);
      setLoadingPkg(false);
    })();
  }, [asset.id]);

  // Load the per-part breakdown for multi-part videos (chunks / frames / concat).
  useEffect(() => {
    if (!isMultiPart) return;
    (async () => {
      const token = await getToken();
      const res = await api.get<TfResponse<GenerationJob[]>>(
        `/api/workspaces/${slug}/generate/assets/${asset.id}/jobs`,
        token ?? undefined,
      );
      if (res.success && res.data) setJobs(res.data);
    })();
  }, [asset.id, isMultiPart]);

  // Resolve a reference id (workspace upload or generated-image asset) to a URL.
  function resolveRefUrl(id: string): string | undefined {
    const u = uploads.find((up) => up.id === id);
    if (u) return u.public_url;
    return assets.find((a) => a.id === id)?.public_url ?? undefined;
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function publish(platform: 'instagram' | 'tiktok') {
    const body = platform === 'instagram'
      ? { assetId: asset.id, caption: pkg?.caption ?? '', hashtags: pkg?.hashtags ?? [] }
      : { assetId: asset.id, title: pkg?.title ?? '', description: pkg?.description ?? '', hashtags: pkg?.hashtags ?? [] };
    publishAsset(platform, body);
  }

  const isVideo = asset.type === 'video';

  // ── Draft references + locked character (mirror of what was sent) ──
  const includeCharacter = pkg?.includeCharacter ?? true;
  const primaryRefId = pkg?.primaryReferenceUploadId ?? null;
  const draftRefIds = pkg?.referenceUploadIds?.length
    ? pkg.referenceUploadIds
    : (primaryRefId ? [primaryRefId] : []);
  const isResolved = (r: { id: string; url: string | undefined }): r is { id: string; url: string } => !!r.url;
  const draftRefs = draftRefIds.map((id) => ({ id, url: resolveRefUrl(id) })).filter(isResolved);
  const characterRefs = includeCharacter
    ? character.referenceIds.map((id) => ({ id, url: resolveRefUrl(id) })).filter(isResolved)
    : [];
  const hasCharacterText = includeCharacter && !!(character.name || character.appearance);
  const hasAnyRefs = characterRefs.length > 0 || draftRefs.length > 0;

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4'>
      <div className='bg-surface-white border border-border-soft rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden'>
        {/* Modal header */}
        <div className='flex items-center justify-between px-5 py-4 border-b border-border-soft'>
          <div className='flex items-center gap-2'>
            <div className='w-2 h-2 rounded-full bg-ink' />
            <span className='text-message font-semibold text-text-primary'>
              {isVideo ? 'Video' : 'Image'} details
            </span>
          </div>
          <div className='flex items-center gap-2'>
            <button
              onClick={onOpenThread}
              className='flex items-center gap-1.5 px-3 py-1.5 text-meta text-text-secondary hover:text-text-primary bg-surface-card hover:bg-surface rounded-lg transition-colors'
            >
              <ExternalLink size={12} />
              Open thread
            </button>
            <button onClick={onClose} className='p-1.5 text-text-muted hover:text-text-primary rounded-lg hover:bg-surface-card transition-colors'>
              <X size={16} />
            </button>
          </div>
        </div>

        <div className='overflow-y-auto flex-1 p-5 space-y-5'>
          {/* Preview — sized to the media's own aspect ratio (portrait stays portrait),
              capped by max width/height so it never overflows the modal. */}
          {blobUrl && (
            <div className='flex justify-center rounded-xl overflow-hidden bg-surface-card'>
              {isVideo ? (
                <video src={blobUrl} controls className='w-auto max-w-full max-h-[60vh] object-contain' />
              ) : (
                <img src={blobUrl} alt='Generated' className='w-auto max-w-full max-h-[60vh] object-contain' />
              )}
            </div>
          )}

          {/* Generation info — model + cost */}
          {(asset.model || asset.cost_usd != null) && (
            <div className='flex items-center gap-3 flex-wrap'>
              {asset.model && (
                <div className='flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-card border border-border-soft'>
                  <Cpu size={12} className='text-text-muted' />
                  <span className='text-meta text-text-secondary font-medium'>{shortModelLabel(asset.model)}</span>
                </div>
              )}
              {formatCost(asset.cost_usd) && (
                <div className='flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-card border border-border-soft'>
                  <DollarSign size={12} className='text-text-muted' />
                  <span className='text-meta text-text-secondary font-medium'>
                    {formatCost(asset.cost_usd)} {isMultiPart ? 'actual' : 'estimated'} cost
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Parts breakdown — how a multi-part video was assembled */}
          {isMultiPart && jobs.length > 0 && (
            <div>
              <p className='text-meta font-semibold text-text-muted uppercase tracking-wide mb-2'>
                Parts{jobs.some((j) => j.kind === 'chunk') ? ` (${jobs.filter((j) => j.kind === 'chunk').length} generated)` : ''}
              </p>
              <div className='space-y-1'>
                {jobs.map((j) => {
                  const label = j.kind === 'chunk' ? `Part ${j.idx + 1}` : j.kind === 'frame' ? `Seed frame ${j.idx + 1}` : 'Stitch';
                  const dot =
                    j.status === 'succeeded' ? 'bg-emerald-500'
                    : j.status === 'failed' ? 'bg-red-500'
                    : j.status === 'running' ? 'bg-amber-500 animate-pulse'
                    : 'bg-text-muted/50';
                  return (
                    <div key={j.id} className='flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-card border border-border-soft'>
                      <span className={cn('h-2 w-2 rounded-full shrink-0', dot)} />
                      <span className='text-meta font-medium text-text-primary w-20 shrink-0'>{label}</span>
                      <span className='text-meta text-text-muted capitalize flex-1'>{j.status}</span>
                      {j.duration_sec != null && j.kind === 'chunk' && (
                        <span className='text-meta text-text-muted'>{j.duration_sec}s</span>
                      )}
                      {formatCost(j.cost_usd) && (
                        <span className='text-meta text-text-secondary font-medium w-14 text-right'>{formatCost(j.cost_usd)}</span>
                      )}
                    </div>
                  );
                })}
              </div>
              {jobs.some((j) => j.status === 'failed') && (
                <p className='mt-1.5 text-[10px] leading-snug text-text-muted'>
                  Failed parts can be regenerated with “Retry parts” — successful parts are reused.
                </p>
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
              <Loader2 size={16} className='animate-spin text-text-muted' />
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
                  <p className='text-meta font-semibold text-text-muted uppercase tracking-wide mb-2'>Hashtags</p>
                  <div className='flex flex-wrap gap-1.5'>
                    {pkg.hashtags.map((h) => (
                      <span key={h} className='inline-flex items-center gap-1 text-meta px-2 py-0.5 bg-surface-card text-text-secondary rounded-full'>
                        <Hash size={9} />{h}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Locked character text (mirror) */}
              {hasCharacterText && (
                <div>
                  <p className='text-meta font-semibold text-text-muted uppercase tracking-wide mb-1.5'>Character</p>
                  <div className='text-message text-text-secondary leading-relaxed'>
                    {character.name && <p><span className='font-medium text-text-primary'>Name: </span>{character.name}</p>}
                    {character.appearance && <p><span className='font-medium text-text-primary'>Appearance: </span>{character.appearance}</p>}
                  </div>
                </div>
              )}

              {/* Reference images — character (badged) + draft references */}
              {hasAnyRefs && (
                <div>
                  <p className='text-meta font-semibold text-text-muted uppercase tracking-wide mb-2'>References</p>
                  <div className='flex flex-wrap gap-2'>
                    {characterRefs.map(({ id, url }) => (
                      <div key={`char-${id}`} className='relative'>
                        <img src={url} alt='Character reference' className='w-14 h-14 object-cover rounded-lg border-2 border-purple-400/70' />
                        <span className='absolute -bottom-1.5 left-1/2 -translate-x-1/2 rounded-full bg-purple-500 px-1.5 py-px text-[9px] font-semibold text-white shadow-sm'>Character</span>
                      </div>
                    ))}
                    {draftRefs.map(({ id, url }) => {
                      const isPrimary = id === primaryRefId;
                      return (
                        <div key={id} className='relative'>
                          <img src={url} alt='Reference' className={cn('w-14 h-14 object-cover rounded-lg border-2', isPrimary ? 'border-brand' : 'border-border-soft')} />
                          {isPrimary && <Star size={12} className='absolute -top-1.5 -left-1.5 fill-brand text-brand' />}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className='text-meta text-text-muted text-center py-4'>No post data available</p>
          )}
        </div>

        {/* Publish footer */}
        <div className='px-5 py-4 border-t border-border-soft space-y-3'>
          {/* AI disclosure toggle */}
          <label className='flex items-center gap-2 cursor-pointer select-none'>
            <div
              onClick={() => setAiLabel((v) => !v)}
              className={cn(
                'relative w-8 h-4.5 rounded-full transition-colors flex-shrink-0',
                aiLabel ? 'bg-ink' : 'bg-border-soft'
              )}
              style={{ height: '18px', width: '32px' }}
            >
              <span
                className={cn(
                  'absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white shadow transition-transform',
                  aiLabel ? 'translate-x-[14px]' : 'translate-x-0.5'
                )}
              />
            </div>
            <span className='text-meta text-text-secondary'>Label this video as AI-generated</span>
          </label>
          <div className='flex items-center gap-3'>
          <button
            onClick={() => downloadAsset(asset, blobUrl, aiLabel)}
            className='flex items-center gap-1.5 px-3 py-2 rounded-full text-meta font-medium bg-surface-card hover:bg-surface border border-border-soft text-text-secondary hover:text-text-primary transition-colors'
          >
            <Download size={13} />
            {aiLabel ? 'Download (Labelled)' : 'Download'}
          </button>
          <span className='text-meta text-text-secondary flex-1'>Publish to</span>
          {(['instagram', 'tiktok'] as const).map((platform) => {
            const s = publishStatus[platform] ?? 'idle';
            return (
              <button
                key={platform}
                onClick={() => publish(platform)}
                disabled={s === 'publishing' || s === 'processing' || s === 'done'}
                className={cn(
                  'flex items-center gap-1.5 px-4 py-2 rounded-full text-meta font-medium transition-all',
                  s === 'done' ? 'bg-green-900/10 text-green-700 dark:text-green-400 border border-green-700/20'
                  : s === 'failed' ? 'bg-red-900/10 text-red-700 dark:text-red-400 border border-red-700/20'
                  : s === 'processing' ? 'bg-yellow-900/10 text-yellow-700 dark:text-yellow-400 border border-yellow-700/20'
                  : platform === 'instagram'
                  ? 'bg-gradient-to-r from-pink-600 to-orange-500 text-white hover:opacity-90 disabled:opacity-50'
                  : 'bg-brand text-on-brand hover:bg-brand-hover disabled:opacity-50'
                )}
              >
                {(s === 'publishing' || s === 'processing') ? <Loader2 size={13} className='animate-spin' />
                  : s === 'done' ? <CheckCircle size={13} />
                  : s === 'failed' ? <AlertCircle size={13} />
                  : <Share2 size={13} />}
                {s === 'processing' ? 'Processing…'
                  : platform === 'instagram' ? 'Instagram' : 'TikTok'}
              </button>
            );
          })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Continue modal (Flow C) ──────────────────────────────────────────────────

function ContinueModal({ asset, slug, blobUrl, onClose, onStarted }: {
  asset: Asset; slug: string; blobUrl?: string; onClose: () => void; onStarted: () => Promise<void>;
}) {
  const { getAuthToken: getToken } = useAuthToken();
  const navigate = useNavigate();
  // 'choose' = pick With Agent vs Manual; 'manual' = the hands-on prompt/pickers form.
  const [mode, setMode] = useState<'choose' | 'manual'>('choose');
  const [startingAgent, setStartingAgent] = useState(false);
  const [chooseError, setChooseError] = useState<string | null>(null);

  // With Agent → create a dedicated continuation chat bound to this video and open it;
  // the agent plans the full multi-part storyboard there.
  async function startWithAgent() {
    setStartingAgent(true);
    setChooseError(null);
    try {
      const token = await getToken();
      const res = await api.post<TfResponse<{ threadId: string }>>(
        `/api/workspaces/${slug}/generate/continue/agent`,
        { assetId: asset.id },
        token ?? undefined,
      );
      if (!res.success || !res.data?.threadId) throw new Error(res.message ?? 'Could not start agent');
      navigate(`/workspaces/${slug}/threads/${res.data.threadId}`, {
        state: {
          draftPrompt: 'Continue this video into a longer clip — keep the same subject, style, and motion, and carry on naturally from where it ends. Add 1–2 new parts.',
        },
      });
    } catch (e) {
      setChooseError(e instanceof Error ? e.message : 'Could not start agent');
      setStartingAgent(false);
    }
  }

  const i2vModels = VIDEO_MODELS.filter((m) => I2V_CAPABLE_MODEL_IDS.includes(m.id as VideoModelId));
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState<VideoModelId>(
    (I2V_CAPABLE_MODEL_IDS as string[]).includes(DEFAULT_VIDEO_MODEL)
      ? DEFAULT_VIDEO_MODEL
      : (i2vModels[0].id as VideoModelId),
  );
  const [duration, setDuration] = useState<string>(() => String(MODEL_MAX_CLIP_SECONDS[model]));
  const [parts, setParts] = useState<string>('1');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const durationOptions = VIDEO_DURATIONS[model] ?? VIDEO_DURATIONS['google/veo-2'];
  const partsOptions = [
    { id: '1', label: '1 part', desc: '' },
    { id: '2', label: '2 parts', desc: '' },
    { id: '3', label: '3 parts', desc: '' },
    { id: '4', label: '4 parts', desc: '' },
    { id: '6', label: '6 parts', desc: '' },
  ] as const;

  async function submit() {
    if (!prompt.trim()) { setError('Describe what happens next'); return; }
    setSubmitting(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await api.post<TfResponse<{ assetId: string; status: string }>>(
        `/api/workspaces/${slug}/generate/continue`,
        { assetId: asset.id, prompt: prompt.trim(), videoModel: model, duration: Number(duration), chunkCount: Number(parts) },
        token ?? undefined,
      );
      if (!res.success) throw new Error(res.message ?? 'Continue failed');
      await onStarted();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Continue failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4'>
      <div className='bg-surface-white border border-border-soft rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden'>
        <div className='flex items-center justify-between px-5 py-4 border-b border-border-soft'>
          <div className='flex items-center gap-2'>
            <Wand2 size={15} className='text-ink' />
            <span className='text-message font-semibold text-text-primary'>Continue this video</span>
          </div>
          <button onClick={onClose} className='p-1.5 text-text-muted hover:text-text-primary rounded-lg hover:bg-surface-card transition-colors'>
            <X size={16} />
          </button>
        </div>

        {/* Step 1: pick how to continue */}
        {mode === 'choose' ? (
          <div className='overflow-y-auto flex-1 p-5 space-y-3'>
            {blobUrl && (
              <div className='flex justify-center rounded-xl overflow-hidden bg-surface-card'>
                <video src={blobUrl} muted playsInline className='w-auto max-h-[26vh] object-contain' />
              </div>
            )}
            <p className='text-meta text-text-muted'>How do you want to extend this video?</p>

            <button
              onClick={startWithAgent}
              disabled={startingAgent}
              className='w-full flex items-start gap-3 rounded-xl border border-border-soft hover:border-brand/60 bg-surface-white hover:bg-surface-card px-4 py-3 text-left transition-colors disabled:opacity-60'
            >
              <div className='mt-0.5 flex-shrink-0 rounded-lg bg-brand/10 p-1.5'>
                {startingAgent ? <Loader2 size={16} className='text-brand animate-spin' /> : <Sparkles size={16} className='text-brand' />}
              </div>
              <div className='flex-1 min-w-0'>
                <p className='text-message font-semibold text-text-primary'>With Agent</p>
                <p className='text-meta text-text-muted leading-snug'>
                  {startingAgent ? 'Opening a continuation chat…' : 'Chat with the agent to plan the whole continuation — it storyboards the next parts for you.'}
                </p>
              </div>
              {!startingAgent && <ChevronRight size={16} className='text-text-muted mt-1 flex-shrink-0' />}
            </button>

            <button
              onClick={() => setMode('manual')}
              disabled={startingAgent}
              className='w-full flex items-start gap-3 rounded-xl border border-border-soft hover:border-brand/60 bg-surface-white hover:bg-surface-card px-4 py-3 text-left transition-colors disabled:opacity-60'
            >
              <div className='mt-0.5 flex-shrink-0 rounded-lg bg-surface-card p-1.5'>
                <Wand2 size={16} className='text-ink' />
              </div>
              <div className='flex-1 min-w-0'>
                <p className='text-message font-semibold text-text-primary'>Manual</p>
                <p className='text-meta text-text-muted leading-snug'>
                  Write the next-part prompt and pick the model, clip length, and parts yourself.
                </p>
              </div>
              <ChevronRight size={16} className='text-text-muted mt-1 flex-shrink-0' />
            </button>

            {chooseError && (
              <div className='flex items-start gap-1.5 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-700/40 rounded-lg px-3 py-2'>
                <AlertCircle size={12} className='text-red-500 mt-0.5 flex-shrink-0' />
                <p className='text-meta text-red-600 dark:text-red-300'>{chooseError}</p>
              </div>
            )}
          </div>
        ) : (
          <>
            <div className='overflow-y-auto flex-1 p-5 space-y-4'>
              {blobUrl && (
                <div className='flex justify-center rounded-xl overflow-hidden bg-surface-card'>
                  <video src={blobUrl} muted playsInline className='w-auto max-h-[30vh] object-contain' />
                </div>
              )}
              <p className='text-meta text-text-muted'>
                We take the last frame of this video and generate the next part from it, then stitch them into one longer clip.
              </p>

              <div>
                <p className='text-meta font-semibold text-text-muted uppercase tracking-wide mb-1.5'>Next part prompt</p>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder='Describe what happens next…'
                  rows={3}
                  className='w-full rounded-lg border border-border-soft bg-surface-white px-3 py-2 text-message text-text-primary resize-none focus:outline-none focus:ring-2 focus:ring-brand/40'
                />
              </div>

              <div className='flex items-center gap-4 flex-wrap'>
                <div className='flex items-center gap-1.5'>
                  <span className='text-meta text-text-secondary'>Model</span>
                  <ModelPicker
                    options={i2vModels}
                    value={model}
                    onChange={(id) => {
                      const m = id as VideoModelId;
                      setModel(m);
                      setDuration(String(MODEL_MAX_CLIP_SECONDS[m]));
                    }}
                  />
                </div>
                <div className='flex items-center gap-1.5'>
                  <span className='text-meta text-text-secondary'>Clip</span>
                  <ModelPicker options={durationOptions} value={duration} onChange={setDuration} />
                </div>
                <div className='flex items-center gap-1.5'>
                  <span className='text-meta text-text-secondary'>Parts</span>
                  <ModelPicker options={partsOptions} value={parts} onChange={setParts} />
                </div>
              </div>

              {error && (
                <div className='flex items-start gap-1.5 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-700/40 rounded-lg px-3 py-2'>
                  <AlertCircle size={12} className='text-red-500 mt-0.5 flex-shrink-0' />
                  <p className='text-meta text-red-600 dark:text-red-300'>{error}</p>
                </div>
              )}
            </div>

            <div className='px-5 py-4 border-t border-border-soft flex items-center justify-between gap-2'>
              <button onClick={() => setMode('choose')} className='px-3 py-2 rounded-lg text-meta font-medium text-text-secondary hover:text-text-primary transition-colors'>
                Back
              </button>
              <button
                onClick={submit}
                disabled={submitting || !prompt.trim()}
                className='flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-meta font-semibold text-on-brand transition-colors hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed'
              >
                {submitting ? <Loader2 size={13} className='animate-spin' /> : <Wand2 size={13} />}
                {submitting ? 'Starting…' : 'Generate next part'}
              </button>
            </div>
          </>
        )}
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
        <p className='text-meta font-semibold text-text-muted uppercase tracking-wide'>{label}</p>
        <button onClick={onCopy} className='text-meta text-text-muted hover:text-text-primary flex items-center gap-1 transition-colors'>
          {copied ? <Check size={11} /> : <Copy size={11} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <p className={cn('text-message text-text-secondary leading-relaxed', mono && 'font-mono text-meta bg-surface-card p-2 rounded-lg')}>
        {value}
      </p>
    </div>
  );
}
