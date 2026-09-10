import { useState } from 'react';
import { useAuthToken } from '../hooks/useAuthToken';
import { api } from '../lib/api';
import type { TfResponse, Asset, Message, ImagePostPackage, VideoPostPackage } from '../types';
import { ImageIcon, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { cn } from '../lib/utils';
import ModelPicker from './ModelPicker';
import { IMAGE_MODELS, DEFAULT_IMAGE_MODEL, IMAGE_MODEL_KEY, readPref, writePref, type ImageModelId } from '../lib/models';
import { friendlyErrorMessage } from '../lib/display';

type ImageSize = '1024x1024' | '1024x1792' | '1792x1024';
type GenerationMode = 'edit' | 'inspire';

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
  hasCharacter?: boolean;
  characterName?: string | null;
}

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 120_000;

export default function GenerateImageButton({ slug, threadId, message, existingAsset, onGenerated, hasCharacter = false }: GenerateImageButtonProps) {
  const { getAuthToken } = useAuthToken();
  const [loading, setLoading] = useState(false);
  // only treat as done when the asset is actually ready — not failed/pending
  const [done, setDone] = useState(existingAsset?.status === 'ready');
  // pre-populate the error if the asset already failed before mounting
  const [error, setError] = useState<string | null>(
    existingAsset?.status === 'failed'
      ? friendlyErrorMessage(existingAsset.error_message)
      : null
  );
  // Parse AI-chosen settings + reference fields from the draft package. The agent
  // may have picked the model / size / edit-vs-inspire mode; we pre-select those
  // here (falling back to the saved pref) and the user can still override below.
  const pkg = (() => {
    try { return JSON.parse(message.post_package ?? '{}') as Partial<ImagePostPackage & VideoPostPackage>; } catch { return {}; }
  })();

  const [imageModel, setImageModel] = useState<ImageModelId>(() => {
    const fromPkg = pkg.imageModel;
    if (fromPkg && IMAGE_MODELS.some((m) => m.id === fromPkg)) return fromPkg as ImageModelId;
    return readPref(IMAGE_MODEL_KEY, DEFAULT_IMAGE_MODEL);
  });
  const [generationMode, setGenerationMode] = useState<GenerationMode>(() => {
    const fromPkg = pkg.generationMode;
    return fromPkg === 'edit' || fromPkg === 'inspire' ? fromPkg : 'inspire';
  });
  // Include-character is now saved on the draft (toggled in the card); absent = on.
  const includeCharacter = pkg.includeCharacter ?? true;
  const pkgSize = pkg.imageSize as ImageSize | undefined;
  const [size, setSize] = useState<ImageSize>(pkgSize ?? '1024x1024');
  const primaryReferenceUploadId = pkg.primaryReferenceUploadId ?? null;
  // All draft references (falls back to the single primary). gpt-image-2 composites
  // these together with the workspace character image(s) server-side.
  const referenceUploadIds = pkg.referenceUploadIds?.length
    ? pkg.referenceUploadIds
    : (primaryReferenceUploadId ? [primaryReferenceUploadId] : []);
  const hasReference = referenceUploadIds.length > 0;

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
      if (res.data?.status === 'failed') throw new Error(friendlyErrorMessage(res.data.error_message));
    }
    throw new Error('Image generation timed out');
  }

  async function handleGenerate() {
    if (!message.post_package) return;
    setLoading(true);
    setError(null);

    try {
      const parsedPkg = JSON.parse(message.post_package) as Partial<ImagePostPackage & VideoPostPackage>;
      const prompt = parsedPkg.imagePrompt;
      if (!prompt) { setError('No image prompt in this draft'); return; }

      const token = await getAuthToken();
      const res = await api.post<TfResponse<{ assetId: string; status: string }>>(
        `/api/workspaces/${slug}/generate/image`,
        {
          threadId, prompt, messageId: message.id, size,
          imageModel,
          ...(hasCharacter && { includeCharacter }),
          ...(referenceUploadIds.length > 0 && {
            referenceUploadIds,
            generationMode,
          }),
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

  // Don't render if no imagePrompt in this draft
  if (!message.post_package) return null;
  try {
    const parsedCheck = JSON.parse(message.post_package);
    if (!parsedCheck.imagePrompt) return null;
  } catch { return null; }

  return (
    <div className='space-y-2'>
      {/* Pickers — only shown before generation */}
      {!done && (
        <div className='space-y-2'>
          {/* Aspect ratio */}
          <div>
            <p className='text-meta text-text-secondary mb-1.5'>Aspect ratio</p>
            <div className='flex gap-1.5'>
              {SIZE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => !loading && setSize(opt.value)}
                  disabled={loading}
                  title={opt.desc}
                  className={cn(
                    'px-2.5 py-1 text-meta font-mono rounded-full border transition-all',
                    size === opt.value
                      ? 'bg-ink border-ink text-on-ink'
                      : 'bg-surface-card border-border-soft text-text-secondary hover:border-ink/40 hover:text-text-primary',
                    loading && 'cursor-not-allowed opacity-50'
                  )}
                >
                  {opt.label}
                </button>
              ))}
              <span className='text-meta text-text-muted self-center ml-1'>
                {SIZE_OPTIONS.find(o => o.value === size)?.desc}
              </span>
            </div>
          </div>
          {/* Image model */}
          <div className='flex items-center gap-1.5'>
            <span className='text-meta text-text-secondary'>Model</span>
            <ModelPicker
              options={IMAGE_MODELS}
              value={imageModel}
              onChange={(id) => { setImageModel(id); writePref(IMAGE_MODEL_KEY, id); }}
            />
          </div>
          {/* Reference mode toggle — only shown when a primary reference is set */}
          {hasReference && (
            <div className='flex items-center gap-1.5'>
              <span className='text-xs text-text-secondary'>Reference</span>
              <div className='flex gap-1'>
                {(['inspire', 'edit'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setGenerationMode(mode)}
                    disabled={loading}
                    className={cn(
                      'px-2.5 py-1 text-xs rounded-lg border transition-all capitalize',
                      generationMode === mode
                        ? 'bg-brand border-brand text-on-brand'
                        : 'bg-surface-card border-border-soft text-text-secondary hover:border-brand hover:text-brand',
                      loading && 'cursor-not-allowed opacity-50'
                    )}
                  >
                    {mode === 'inspire' ? 'Inspired by' : 'Edit reference'}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Error banner */}
      {error && !loading && (
        <div className='flex items-start gap-1.5 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-700/40 rounded-lg px-3 py-2'>
          <AlertCircle size={12} className='text-red-500 dark:text-red-400 mt-0.5 flex-shrink-0' />
          <p className='text-meta text-red-600 dark:text-red-300 leading-snug'>{error}</p>
        </div>
      )}

      {/* Generate / Retry button */}
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
            <AlertCircle size={12} />
          ) : (
            <ImageIcon size={12} />
          )}
          {loading ? 'Generating...' : done ? 'Image generated' : error ? 'Retry' : 'Generate image'}
        </button>
      </div>
    </div>
  );
}
