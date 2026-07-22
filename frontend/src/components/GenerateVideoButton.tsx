import { useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { api } from '../lib/api';
import type { TfResponse, Asset, Message } from '../types';
import { Video, Loader2, CheckCircle, AlertCircle, RefreshCw } from 'lucide-react';
import { cn } from '../lib/utils';
import ModelPicker from './ModelPicker';
import { VIDEO_MODELS, DEFAULT_VIDEO_MODEL, VIDEO_MODEL_KEY, readPref, writePref } from '../lib/models';

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
  const { getToken } = useAuth();
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

  async function pollUntilReady(assetId: string): Promise<Asset> {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
      const freshToken = await getToken();
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
      const pkg = JSON.parse(message.post_package);
      const prompt = pkg.videoPrompt;
      if (!prompt) { setError('No video prompt in this draft'); return; }

      const token = await getToken();
      const res = await api.post<TfResponse<{ assetId: string; predictionId: string; status: string }>>(
        `/api/workspaces/${slug}/generate/video`,
        { threadId, prompt, messageId: message.id, videoModel },
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
        <div className='flex items-center gap-1.5'>
          <span className='text-xs text-gray-500'>Model</span>
          <ModelPicker
            options={VIDEO_MODELS}
            value={videoModel}
            onChange={(id) => { setVideoModel(id); writePref(VIDEO_MODEL_KEY, id); }}
          />
        </div>
      )}

      {/* Error banner */}
      {error && !loading && (
        <div className='flex items-start gap-1.5 bg-red-950/40 border border-red-700/40 rounded-lg px-3 py-2'>
          <AlertCircle size={12} className='text-red-400 mt-0.5 flex-shrink-0' />
          <p className='text-xs text-red-300 leading-snug'>{error}</p>
        </div>
      )}

      <div className='flex items-center gap-2'>
        <button
          onClick={handleGenerate}
          disabled={loading || done}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white rounded-lg transition-all disabled:opacity-60 disabled:cursor-not-allowed',
            error && !done
              ? 'bg-red-600 hover:bg-red-500'
              : 'bg-purple-600 hover:bg-purple-500'
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
          <span className='text-xs text-gray-500'>This may take a few minutes</span>
        )}
      </div>
    </div>
  );
}
