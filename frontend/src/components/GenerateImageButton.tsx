import { useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { api } from '../lib/api';
import type { TfResponse, Asset, Message } from '../types';
import { ImageIcon, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { cn } from '../lib/utils';

type ImageSize = '1024x1024' | '1024x1792' | '1792x1024';

const SIZE_OPTIONS: { value: ImageSize; label: string; desc: string }[] = [
  { value: '1024x1024', label: '1:1',  desc: 'Square · Instagram feed' },
  { value: '1024x1792', label: '9:16', desc: 'Portrait · Stories / TikTok' },
  { value: '1792x1024', label: '16:9', desc: 'Landscape · YouTube / Twitter' },
];

interface GenerateImageButtonProps {
  slug: string;
  threadId: string;
  message: Message;
  existingAsset?: Asset;
  onGenerated?: (asset: Asset) => void;
}

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 120_000;

export default function GenerateImageButton({ slug, threadId, message, existingAsset, onGenerated }: GenerateImageButtonProps) {
  const { getToken } = useAuth();
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(!!existingAsset);
  const [error, setError] = useState<string | null>(null);

  // Parse AI-chosen size from package, default to square
  const pkgSize = (() => {
    try { return JSON.parse(message.post_package ?? '{}').imageSize as ImageSize | undefined; } catch { return undefined; }
  })();
  const [size, setSize] = useState<ImageSize>(pkgSize ?? '1024x1024');

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
      if (res.data?.status === 'failed') throw new Error('Image generation failed');
    }
    throw new Error('Image generation timed out');
  }

  async function handleGenerate() {
    if (!message.post_package) return;
    setLoading(true);
    setError(null);

    try {
      const pkg = JSON.parse(message.post_package);
      const prompt = pkg.imagePrompt;
      if (!prompt) { setError('No image prompt in this draft'); return; }

      const token = await getToken();
      const res = await api.post<TfResponse<{ assetId: string; status: string }>>(
        `/api/workspaces/${slug}/generate/image`,
        { threadId, prompt, messageId: message.id, size },
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

  // Don't render if no imagePrompt in this draft
  if (!message.post_package) return null;
  try {
    const pkg = JSON.parse(message.post_package);
    if (!pkg.imagePrompt) return null;
  } catch { return null; }

  return (
    <div className='space-y-2'>
      {/* Aspect ratio picker */}
      {!done && (
        <div>
          <p className='text-xs text-gray-500 mb-1.5'>Aspect ratio</p>
          <div className='flex gap-1.5'>
            {SIZE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => !loading && setSize(opt.value)}
                disabled={loading}
                title={opt.desc}
                className={cn(
                  'px-2.5 py-1 text-xs font-mono rounded-lg border transition-all',
                  size === opt.value
                    ? 'bg-blue-600 border-blue-500 text-white'
                    : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-blue-500 hover:text-white',
                  loading && 'cursor-not-allowed opacity-50'
                )}
              >
                {opt.label}
              </button>
            ))}
            <span className='text-xs text-gray-600 self-center ml-1'>
              {SIZE_OPTIONS.find(o => o.value === size)?.desc}
            </span>
          </div>
        </div>
      )}

      {/* Generate button */}
      <div className='flex items-center gap-2'>
        <button
          onClick={handleGenerate}
          disabled={loading || done}
          className='flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-lg transition-all'
        >
          {loading ? (
            <Loader2 size={12} className='animate-spin' />
          ) : done ? (
            <CheckCircle size={12} />
          ) : (
            <ImageIcon size={12} />
          )}
          {loading ? 'Generating...' : done ? 'Image generated' : 'Generate image'}
        </button>
        {error && (
          <span className='flex items-center gap-1 text-xs text-red-400'>
            <AlertCircle size={11} /> {error}
          </span>
        )}
      </div>
    </div>
  );
}
