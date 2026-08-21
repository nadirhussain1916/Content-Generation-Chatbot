import { useState } from 'react';
import { useAuthToken } from '../hooks/useAuthToken';
import { api } from '../lib/api';
import type { TfResponse, Asset, Message, VideoPostPackage } from '../types';
import { Video, Loader2, CheckCircle, AlertCircle, RefreshCw } from 'lucide-react';
import { cn } from '../lib/utils';
import ModelPicker from './ModelPicker';
import {
  VIDEO_MODELS, DEFAULT_VIDEO_MODEL, VIDEO_MODEL_KEY,
  VIDEO_ASPECT_RATIOS, DEFAULT_VIDEO_ASPECT_RATIO, VIDEO_ASPECT_RATIO_KEY,
  VIDEO_DURATIONS, DEFAULT_VIDEO_DURATIONS, VIDEO_DURATION_KEY,
  ASPECT_RATIO_MODEL_IDS, DURATION_MODEL_IDS,
  LTX_EXTEND_OPTIONS, LTX_EXTEND_KEY,
  type VideoModelId, type LtxExtendOption,
  readPref, writePref,
} from '../lib/models';

interface GenerateVideoButtonProps {
  slug: string;
  threadId: string;
  message: Message;
  existingAsset?: Asset;
  onGenerated?: (asset: Asset) => void;
}

const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 900_000; // 15 min — covers slow cold starts

export default function GenerateVideoButton({ slug, threadId, message, existingAsset, onGenerated }: GenerateVideoButtonProps) {
  const { getAuthToken } = useAuthToken();
  const [loading, setLoading] = useState(false);
  // only treat as done when the asset is actually ready — not failed/pending
  const [done, setDone] = useState(existingAsset?.status === 'ready');
  // pre-populate the error if the asset already failed before mounting
  const [error, setError] = useState<string | null>(
    existingAsset?.status === 'failed'
      ? (existingAsset.error_message ?? 'Video generation failed')
      : null
  );
  const [videoModel, setVideoModel] = useState(() => readPref(VIDEO_MODEL_KEY, DEFAULT_VIDEO_MODEL));
  const [aspectRatio, setAspectRatio] = useState(() => readPref(VIDEO_ASPECT_RATIO_KEY, DEFAULT_VIDEO_ASPECT_RATIO));
  const [duration, setDuration] = useState(() => readPref(VIDEO_DURATION_KEY, DEFAULT_VIDEO_DURATIONS[DEFAULT_VIDEO_MODEL]));
  const [ltxExtendId, setLtxExtendId] = useState<string>(() => readPref(LTX_EXTEND_KEY, '0'));

  const currentModelId = videoModel as VideoModelId;
  const supportsAspectRatio = ASPECT_RATIO_MODEL_IDS.includes(currentModelId);
  const isLtxPro = currentModelId === 'lightricks/ltx-2.3-pro';
  const selectedExtend: LtxExtendOption =
    LTX_EXTEND_OPTIONS.find((o) => o.id === ltxExtendId) ?? LTX_EXTEND_OPTIONS[0];
  const chainCount = isLtxPro ? selectedExtend.chainCount : 0;
  // Hide the duration picker for LTX Pro when extend is active (initial duration is fixed at 10s)
  const supportsDuration = DURATION_MODEL_IDS.includes(currentModelId) && !(isLtxPro && chainCount > 0);
  const durationOptions = VIDEO_DURATIONS[currentModelId] ?? VIDEO_DURATIONS['google/veo-2'];

  async function pollUntilReady(assetId: string): Promise<Asset> {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
      const freshToken = await getAuthToken();
      const res = await api.get<TfResponse<Asset>>(
        `/api/workspaces/${slug}/generate/assets/${assetId}/status`,
        freshToken ?? undefined
      );
      if (!res.success) throw new Error(res.message ?? 'Polling failed');
      if (res.data?.status === 'ready') return res.data;
      if (res.data?.status === 'failed') throw new Error('Video generation failed');
    }
    throw new Error('Video generation timed out');
  }

  async function handleGenerate() {
    if (!message.post_package) return;
    setLoading(true);
    setError(null);

    try {
      const pkg = JSON.parse(message.post_package) as Partial<VideoPostPackage>;
      const prompt = pkg.videoPrompt;
      if (!prompt) { setError('No video prompt in this draft'); return; }

      const primaryReferenceUploadId = pkg.primaryReferenceUploadId ?? null;

      const token = await getAuthToken();
      const res = await api.post<TfResponse<{ assetId: string; predictionId: string; status: string }>>(
        `/api/workspaces/${slug}/generate/video`,
        {
          threadId,
          prompt,
          messageId: message.id,
          videoModel,
          ...(supportsAspectRatio && { aspectRatio }),
          // When LTX Pro extend is active, fix initial duration at 10s and use per-option extendDuration
          ...(isLtxPro && chainCount > 0
            ? { duration: 10, chainCount, extendDuration: selectedExtend.extendDuration }
            : supportsDuration && { duration: Number(duration) }),
          ...(primaryReferenceUploadId && { referenceUploadId: primaryReferenceUploadId }),
        },
        token ?? undefined
      );

      if (!res.success || !res.data?.assetId) {
        setError(res.message ?? 'Generation failed');
        return;
      }

      const asset = await pollUntilReady(res.data.assetId);
      setDone(true);
      onGenerated?.(asset);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unexpected error');
    } finally {
      setLoading(false);
    }
  }

  // Don't render if no videoPrompt
  if (!message.post_package) return null;
  try {
    const pkg = JSON.parse(message.post_package);
    if (!pkg.videoPrompt) return null;
  } catch { return null; }

  return (
    <div className='space-y-2 pt-1'>
      {/* Model picker — only shown before generation */}
      {!done && (
        <div className='flex items-center gap-3 flex-wrap'>
          <div className='flex items-center gap-1.5'>
            <span className='text-meta text-text-secondary'>Model</span>
            <ModelPicker
              options={VIDEO_MODELS}
              value={videoModel}
              onChange={(id) => {
                setVideoModel(id);
                writePref(VIDEO_MODEL_KEY, id);
                const defaultDur = DEFAULT_VIDEO_DURATIONS[id as VideoModelId] ?? '5';
                setDuration(defaultDur);
                writePref(VIDEO_DURATION_KEY, defaultDur);
              }}
            />
          </div>
          {supportsAspectRatio && (
            <div className='flex items-center gap-1.5'>
              <span className='text-meta text-text-secondary'>Size</span>
              <ModelPicker
                options={VIDEO_ASPECT_RATIOS}
                value={aspectRatio}
                onChange={(id) => { setAspectRatio(id); writePref(VIDEO_ASPECT_RATIO_KEY, id); }}
              />
            </div>
          )}
          {supportsDuration && (
            <div className='flex items-center gap-1.5'>
              <span className='text-meta text-text-secondary'>Duration</span>
              <ModelPicker
                options={durationOptions}
                value={duration}
                onChange={(id) => { setDuration(id); writePref(VIDEO_DURATION_KEY, id); }}
              />
            </div>
          )}
          {isLtxPro && (
            <div className='flex items-center gap-1.5'>
              <span className='text-meta text-text-secondary'>Length</span>
              <ModelPicker
                options={LTX_EXTEND_OPTIONS}
                value={ltxExtendId}
                onChange={(id) => { setLtxExtendId(id); writePref(LTX_EXTEND_KEY, id); }}
              />
            </div>
          )}
        </div>
      )}

      {/* Wan T2V + reference warning */}
      {(() => {
        try {
          const pkg = JSON.parse(message.post_package ?? '{}');
          if (currentModelId === 'wan-video/wan-2.7-t2v' && pkg.primaryReferenceUploadId) {
            return (
              <div className='flex items-start gap-1.5 bg-amber-950/30 border border-amber-700/40 rounded-lg px-3 py-2'>
                <AlertCircle size={12} className='text-amber-400 mt-0.5 flex-shrink-0' />
                <p className='text-xs text-amber-300 leading-snug'>
                  Wan 2.7 T2V is text-only — the reference image will not be used for this generation.
                </p>
              </div>
            );
          }
        } catch { /* ignore */ }
        return null;
      })()}

      {/* Error banner */}
      {error && !loading && (
        <div className='flex items-start gap-1.5 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-700/40 rounded-lg px-3 py-2'>
          <AlertCircle size={12} className='text-red-500 dark:text-red-400 mt-0.5 flex-shrink-0' />
          <p className='text-meta text-red-600 dark:text-red-300 leading-snug'>{error}</p>
        </div>
      )}

      <div className='flex items-center gap-2'>
        <button
          onClick={handleGenerate}
          disabled={loading || done}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 text-meta font-medium rounded-lg transition-all disabled:opacity-60 disabled:cursor-not-allowed',
            error && !done
              ? 'bg-red-600 hover:bg-red-500 text-white'
              : 'bg-brand hover:bg-brand-hover text-on-brand'
          )}
        >
          {loading ? (
            <Loader2 size={12} className='animate-spin' />
          ) : done ? (
            <CheckCircle size={12} />
          ) : error ? (
            <RefreshCw size={12} />
          ) : (
            <Video size={12} />
          )}
          {loading ? 'Generating video...' : done ? 'Video generated' : error ? 'Retry' : 'Generate video'}
        </button>
        {loading && (
          <span className='text-meta text-text-secondary'>
            {isLtxPro && chainCount > 0
              ? `Generating ${chainCount + 1} clips (${selectedExtend.label} video) — this may take ${Math.round((chainCount + 1) * 2)}–${Math.round((chainCount + 1) * 3)} min`
              : 'This may take a few minutes'}
          </span>
        )}
      </div>
    </div>
  );
}
