import { useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { api } from '../lib/api';
import type { TfResponse, Asset, Message } from '../types';
import { Video, Loader2, CheckCircle, AlertCircle } from 'lucide-react';

interface GenerateVideoButtonProps {
  slug: string;
  threadId: string;
  message: Message;
  existingAsset?: Asset;
  onGenerated?: (asset: Asset) => void;
}

const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 300_000; // 5 min — Replicate can be slow

export default function GenerateVideoButton({ slug, threadId, message, existingAsset, onGenerated }: GenerateVideoButtonProps) {
  const { getToken } = useAuth();
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(!!existingAsset);
  const [error, setError] = useState<string | null>(null);

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
        { threadId, prompt, messageId: message.id },
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
    <div className='flex items-center gap-2 pt-1'>
      <button
        onClick={handleGenerate}
        disabled={loading || done}
        className='flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-purple-600 hover:bg-purple-500 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-lg transition-all'
      >
        {loading ? (
          <Loader2 size={12} className='animate-spin' />
        ) : done ? (
          <CheckCircle size={12} />
        ) : (
          <Video size={12} />
        )}
        {loading ? 'Generating video...' : done ? 'Video generated' : 'Generate video'}
      </button>
      {loading && (
        <span className='text-xs text-gray-500'>This may take a few minutes</span>
      )}
      {error && (
        <span className='flex items-center gap-1 text-xs text-red-400'>
          <AlertCircle size={11} /> {error}
        </span>
      )}
    </div>
  );
}
