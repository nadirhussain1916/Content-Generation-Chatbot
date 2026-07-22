import { useState } from 'react';
import type { Message, PlannerResult, PlannerQuestion, ImagePostPackage, VideoPostPackage, Asset } from '../types';
import { cn } from '../lib/utils';
import { ChevronDown, ChevronUp, Copy, Check, Hash, Loader2, Share2, CheckCircle, AlertCircle } from 'lucide-react';
import GenerateImageButton from './GenerateImageButton';
import GenerateVideoButton from './GenerateVideoButton';
import { useAuth } from '@clerk/clerk-react';
import { api } from '../lib/api';
import type { TfResponse, PublishRecord } from '../types';

interface ChatMessageProps {
  message: Message;
  onOptionSelect?: (text: string) => void;
  // image generation state for this specific message
  asset?: Asset;
  assetBlobUrl?: string;
  slug?: string;
  threadId?: string;
  onAssetGenerated?: (asset: Asset) => void;
}

export default function ChatMessage({ message, onOptionSelect, asset, assetBlobUrl, slug, threadId, onAssetGenerated }: ChatMessageProps) {
  const { getToken } = useAuth();
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [publishStatus, setPublishStatus] = useState<Record<string, 'idle' | 'publishing' | 'done' | 'failed'>>({});

  async function handlePublish(platform: 'instagram' | 'tiktok') {
    if (!asset || !slug || !message.post_package) return;
    setPublishStatus(s => ({ ...s, [platform]: 'publishing' }));
    try {
      const pkg = JSON.parse(message.post_package) as ImagePostPackage & VideoPostPackage;
      const token = await getToken();
      const body = platform === 'instagram'
        ? { assetId: asset.id, caption: pkg.caption, hashtags: pkg.hashtags }
        : { assetId: asset.id, title: pkg.title, description: pkg.description, hashtags: pkg.hashtags };

      const res = await api.post<TfResponse<PublishRecord>>(
        `/api/workspaces/${slug}/publish/${platform}`,
        body,
        token ?? undefined
      );
      setPublishStatus(s => ({ ...s, [platform]: res.success ? 'done' : 'failed' }));
    } catch {
      setPublishStatus(s => ({ ...s, [platform]: 'failed' }));
    }
  }

  const isUser = message.role === 'user';
  const isDraft = message.type === 'draft' || message.type === 'followup';

  function copy(text: string) {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Parse planner response
  let plannerData: PlannerResult | null = null;
  let postPackage: ImagePostPackage | VideoPostPackage | null = null;

  if (!isUser) {
    if (message.post_package) {
      try { postPackage = JSON.parse(message.post_package); } catch {}
    } else if (message.type === 'chat') {
      try {
        const parsed = JSON.parse(message.content);
        if ('ready' in parsed) plannerData = parsed as PlannerResult;
      } catch {}
    }
  }

  // User message
  if (isUser) {
    return (
      <div className='flex justify-end'>
        <div className='max-w-[75%] bg-violet-600 text-white rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm'>
          {message.content}
        </div>
      </div>
    );
  }

  // Planner response with multiple question chip groups
  if (plannerData) {
    return (
      <div className='flex justify-start'>
        <div className='max-w-[85%] space-y-3'>
          <div className='bg-gray-900 border border-gray-800 rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-gray-200 leading-relaxed'>
            {plannerData.reply}
          </div>
          {plannerData.questions && plannerData.questions.length > 0 && (
            <QuestionGroups
              questions={plannerData.questions}
              onSelect={onOptionSelect}
            />
          )}
        </div>
      </div>
    );
  }

  // Draft / PostPackage card
  if (isDraft && postPackage) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pkg = postPackage as any as ImagePostPackage & VideoPostPackage;
    const isVideo = 'script' in (postPackage as object);

    return (
      <div className='flex justify-start'>
        <div className='max-w-[90%] w-full bg-gray-900 border border-violet-700/50 rounded-2xl overflow-hidden'>
          {/* Header */}
          <div className='flex items-center justify-between px-4 py-3 border-b border-gray-800'>
            <div className='flex items-center gap-2'>
              <div className='w-2 h-2 rounded-full bg-violet-500' />
              <span className='text-sm font-semibold text-violet-300'>
                {isVideo ? 'Video Script' : 'Image Post'} Draft
              </span>
            </div>
            <button onClick={() => setExpanded((p) => !p)} className='text-gray-400 hover:text-white'>
              {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
          </div>

          {expanded && (
            <div className='p-4 space-y-4'>
              {/* Caption */}
              <Section
                label='Caption'
                value={pkg.caption}
                onCopy={() => copy(pkg.caption)}
                copied={copied}
              />

              {/* Video script */}
              {isVideo && pkg.script && (
                <div className='space-y-2'>
                  <p className='text-xs font-semibold text-gray-400 uppercase tracking-wide'>Script</p>
                  <div className='bg-gray-800/50 rounded-lg p-3 space-y-2 text-sm text-gray-300'>
                    <div><span className='text-yellow-400 font-medium'>Hook: </span>{pkg.script.hook}</div>
                    <div><span className='text-blue-400 font-medium'>Body: </span>{pkg.script.body}</div>
                    <div><span className='text-green-400 font-medium'>CTA: </span>{pkg.script.callToAction}</div>
                    <div className='text-gray-500 text-xs'>⏱ {pkg.script.estimatedDuration}</div>
                  </div>
                </div>
              )}

              {/* Video prompt */}
              {isVideo && pkg.videoPrompt && (
                <Section
                  label='Video Prompt'
                  value={pkg.videoPrompt}
                  onCopy={() => copy(pkg.videoPrompt)}
                  copied={copied}
                  mono
                />
              )}

              {/* Image prompt */}
              {!isVideo && pkg.imagePrompt && (
                <Section
                  label='Image Prompt'
                  value={pkg.imagePrompt}
                  onCopy={() => copy(pkg.imagePrompt)}
                  copied={copied}
                  mono
                />
              )}

              {/* Generate media inline */}
              {slug && threadId && (
                <div className='border-t border-gray-800 pt-3'>
                  {assetBlobUrl ? (
                    <div className='space-y-3'>
                      <p className='text-xs font-semibold text-gray-400 uppercase tracking-wide'>
                        {isVideo ? 'Generated Video' : 'Generated Image'}
                      </p>
                      {isVideo ? (
                        <video
                          src={assetBlobUrl}
                          controls
                          className='w-full rounded-lg max-h-[480px] bg-gray-950'
                        />
                      ) : (
                        <img
                          src={assetBlobUrl}
                          alt='Generated post image'
                          className='w-full rounded-lg object-contain max-h-[480px] bg-gray-950'
                        />
                      )}
                      {/* Publish buttons */}
                      <div className='flex items-center gap-2 pt-1'>
                        <span className='text-xs text-gray-500'>Publish to</span>
                        {(['instagram', 'tiktok'] as const).map((platform) => {
                          const s = publishStatus[platform] ?? 'idle';
                          return (
                            <button
                              key={platform}
                              onClick={() => handlePublish(platform)}
                              disabled={s === 'publishing' || s === 'done'}
                              className={cn(
                                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                                s === 'done' ? 'bg-green-900/30 text-green-400 border border-green-700/30'
                                : s === 'failed' ? 'bg-red-900/30 text-red-400 border border-red-700/30'
                                : platform === 'instagram'
                                ? 'bg-gradient-to-r from-pink-600 to-orange-500 text-white hover:opacity-90 disabled:opacity-50'
                                : 'bg-gray-800 text-white border border-gray-700 hover:bg-gray-700 disabled:opacity-50'
                              )}
                            >
                              {s === 'publishing' ? <Loader2 size={12} className='animate-spin' />
                                : s === 'done' ? <CheckCircle size={12} />
                                : s === 'failed' ? <AlertCircle size={12} />
                                : <Share2 size={12} />}
                              {platform === 'instagram' ? 'Instagram' : 'TikTok'}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : asset && asset.status === 'failed' ? (
                    <div className='flex items-start gap-2 text-xs text-red-400 bg-red-950/30 border border-red-800/40 rounded-lg px-3 py-2'>
                      <AlertCircle size={12} className='flex-shrink-0 mt-0.5' />
                      <span>
                        Generation failed.{' '}
                        {asset.error_message && (
                          <span className='text-red-500/80'>{asset.error_message}</span>
                        )}
                      </span>
                    </div>
                  ) : asset && asset.status === 'generating' ? (
                    <div className='flex items-center gap-2 text-xs text-gray-400'>
                      <Loader2 size={12} className='animate-spin' />
                      {isVideo ? 'Generating video...' : 'Generating image...'}
                    </div>
                  ) : isVideo ? (
                    <GenerateVideoButton
                      slug={slug}
                      threadId={threadId}
                      message={message}
                      existingAsset={asset}
                      onGenerated={onAssetGenerated}
                    />
                  ) : (
                    <GenerateImageButton
                      slug={slug}
                      threadId={threadId}
                      message={message}
                      existingAsset={asset}
                      onGenerated={onAssetGenerated}
                    />
                  )}
                </div>
              )}

              {/* Hashtags */}
              <div>
                <p className='text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2'>Hashtags</p>
                <div className='flex flex-wrap gap-1.5'>
                  {pkg.hashtags.map((h) => (
                    <span
                      key={h}
                      className='inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-gray-800 text-violet-300 rounded-full'
                    >
                      <Hash size={10} />
                      {h}
                    </span>
                  ))}
                </div>
              </div>

              {/* TikTok title */}
              {pkg.title && (
                <Section label='TikTok Title' value={pkg.title} onCopy={() => copy(pkg.title)} copied={copied} />
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Plain assistant message
  return (
    <div className='flex justify-start'>
      <div className='max-w-[85%] bg-gray-900 border border-gray-800 rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm text-gray-200 leading-relaxed'>
        {message.content}
      </div>
    </div>
  );
}

function QuestionGroups({
  questions,
  onSelect,
}: {
  questions: PlannerQuestion[];
  onSelect?: (text: string) => void;
}) {
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [submitted, setSubmitted] = useState(false);

  function toggle(qId: string, optId: string, allowMultiple: boolean) {
    setSelected((prev) => {
      const current = prev[qId] ?? [];
      if (allowMultiple) {
        return {
          ...prev,
          [qId]: current.includes(optId) ? current.filter((x) => x !== optId) : [...current, optId],
        };
      }
      return { ...prev, [qId]: [optId] };
    });
  }

  function handleSubmit() {
    if (submitted) return;
    const lines = questions.map((q) => {
      const picks = (selected[q.id] ?? [])
        .map((id) => q.options.find((o) => o.id === id)?.label)
        .filter(Boolean)
        .join(', ');
      return picks ? `${q.text}: ${picks}` : null;
    }).filter(Boolean);
    if (lines.length === 0) return;
    setSubmitted(true);
    onSelect?.(lines.join('\n'));
  }

  const allAnswered = questions.every((q) => (selected[q.id]?.length ?? 0) > 0);

  return (
    <div className='bg-gray-900/50 border border-gray-800 rounded-xl p-4 space-y-4'>
      {questions.map((q) => (
        <div key={q.id}>
          <p className='text-xs font-medium text-gray-400 mb-2'>{q.text}</p>
          <div className='flex flex-wrap gap-2'>
            {q.options.map((opt) => {
              const isSelected = selected[q.id]?.includes(opt.id);
              return (
                <button
                  key={opt.id}
                  onClick={() => !submitted && toggle(q.id, opt.id, q.allowMultiple)}
                  disabled={submitted}
                  className={cn(
                    'px-3 py-1.5 text-sm rounded-full border transition-all',
                    isSelected
                      ? 'bg-violet-600 border-violet-500 text-white'
                      : 'bg-gray-800 border-gray-700 text-gray-300 hover:border-violet-500 hover:text-white',
                    submitted && 'opacity-60 cursor-not-allowed'
                  )}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <button
        onClick={handleSubmit}
        disabled={!allAnswered || submitted}
        className={cn(
          'mt-1 px-4 py-1.5 text-sm font-medium rounded-lg transition-all',
          allAnswered && !submitted
            ? 'bg-violet-600 hover:bg-violet-500 text-white'
            : 'bg-gray-800 text-gray-500 cursor-not-allowed'
        )}
      >
        {submitted ? 'Sent ✓' : 'Continue →'}
      </button>
    </div>
  );
}

function Section({
  label,
  value,
  onCopy,
  copied,
  mono = false,
}: {
  label: string;
  value: string;
  onCopy: () => void;
  copied: boolean;
  mono?: boolean;
}) {
  return (
    <div>
      <div className='flex items-center justify-between mb-1.5'>
        <p className='text-xs font-semibold text-gray-400 uppercase tracking-wide'>{label}</p>
        <button
          onClick={onCopy}
          className='text-xs text-gray-500 hover:text-white flex items-center gap-1 transition-colors'
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <p className={cn('text-sm text-gray-300 leading-relaxed', mono && 'font-mono text-xs bg-gray-800 p-2 rounded')}>
        {value}
      </p>
    </div>
  );
}
