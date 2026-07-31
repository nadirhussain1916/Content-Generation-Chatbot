import { useState } from 'react';
import type { Message, PlannerResult, PlannerQuestion, ImagePostPackage, VideoPostPackage, Asset } from '../types';
import { cn } from '../lib/utils';
import { ChevronDown, ChevronUp, Copy, Check, Hash, Loader2, Share2, CheckCircle, AlertCircle } from 'lucide-react';
import GenerateImageButton from './GenerateImageButton';
import GenerateVideoButton from './GenerateVideoButton';
import { usePublishStatus } from '../hooks/usePublishStatus';

interface ChatMessageProps {
  message: Message;
  onOptionSelect?: (text: string) => void;
  asset?: Asset;
  assetBlobUrl?: string;
  slug?: string;
  threadId?: string;
  onAssetGenerated?: (asset: Asset) => void;
}

export default function ChatMessage({ message, onOptionSelect, asset, assetBlobUrl, slug, threadId, onAssetGenerated }: ChatMessageProps) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const { status: publishStatus, publish } = usePublishStatus(slug, asset?.id);

  async function handlePublish(platform: 'instagram' | 'tiktok') {
    if (!asset || !slug || !message.post_package) return;
    const pkg = JSON.parse(message.post_package) as ImagePostPackage & VideoPostPackage;
    const body = platform === 'instagram'
      ? { assetId: asset.id, caption: pkg.caption, hashtags: pkg.hashtags }
      : { assetId: asset.id, title: pkg.title, description: pkg.description, hashtags: pkg.hashtags };
    await publish(platform, body);
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
        <div className='max-w-[75%] bg-surface-white border border-black/[0.04] dark:border-white/[0.06] text-text-primary rounded-2xl rounded-br-[4px] px-4 py-2.5 text-message shadow-[0_2px_10px_rgba(0,0,0,0.03)]'>
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
          <div className='bg-ink text-on-ink rounded-2xl rounded-tl-none px-4 py-3 text-message leading-relaxed'>
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
        <div className='max-w-[90%] w-full bg-surface-card border border-border-soft rounded-2xl overflow-hidden'>
          {/* Header */}
          <div className='flex items-center justify-between px-4 py-3 border-b border-border-soft'>
            <div className='flex items-center gap-2'>
              <div className='w-2 h-2 rounded-full bg-ink' />
              <span className='text-message font-semibold text-text-primary'>
                {isVideo ? 'Video Script' : 'Image Post'} Draft
              </span>
            </div>
            <button onClick={() => setExpanded((p) => !p)} className='text-text-muted hover:text-text-primary'>
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
                  <p className='text-meta font-semibold text-text-muted uppercase tracking-wide'>Script</p>
                  <div className='bg-surface-white rounded-xl p-3 space-y-2 text-message text-text-secondary'>
                    <div><span className='text-yellow-600 dark:text-yellow-400 font-medium'>Hook: </span>{pkg.script.hook}</div>
                    <div><span className='text-blue-600 dark:text-blue-400 font-medium'>Body: </span>{pkg.script.body}</div>
                    <div><span className='text-green-600 dark:text-green-400 font-medium'>CTA: </span>{pkg.script.callToAction}</div>
                    <div className='text-text-muted text-meta'>⏱ {pkg.script.estimatedDuration}</div>
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
                <div className='border-t border-border-soft pt-3'>
                  {assetBlobUrl ? (
                    <div className='space-y-3'>
                      <p className='text-meta font-semibold text-text-muted uppercase tracking-wide'>
                        {isVideo ? 'Generated Video' : 'Generated Image'}
                      </p>
                      {isVideo ? (
                        <video
                          src={assetBlobUrl}
                          controls
                          className='w-full rounded-xl max-h-[480px] bg-surface-white'
                        />
                      ) : (
                        <img
                          src={assetBlobUrl}
                          alt='Generated post image'
                          className='w-full rounded-xl object-contain max-h-[480px] bg-surface-white'
                        />
                      )}
                      {/* Publish buttons */}
                      <div className='flex items-center gap-2 pt-1'>
                        <span className='text-meta text-text-secondary'>Publish to</span>
                        {(['instagram', 'tiktok'] as const).map((platform) => {
                          const s = publishStatus[platform] ?? 'idle';
                          return (
                            <button
                              key={platform}
                              onClick={() => handlePublish(platform)}
                              disabled={s === 'publishing' || s === 'processing' || s === 'done'}
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
                              {(s === 'publishing' || s === 'processing') ? <Loader2 size={12} className='animate-spin' />
                                : s === 'done' ? <CheckCircle size={12} />
                                : s === 'failed' ? <AlertCircle size={12} />
                                : <Share2 size={12} />}
                              {s === 'processing' ? 'Processing…'
                                : platform === 'instagram' ? 'Instagram' : 'TikTok'}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : asset && asset.status === 'generating' ? (
                    <div className='flex items-center gap-2 text-meta text-text-muted'>
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
                <p className='text-meta font-semibold text-text-muted uppercase tracking-wide mb-2'>Hashtags</p>
                <div className='flex flex-wrap gap-1.5'>
                  {pkg.hashtags.map((h) => (
                    <span
                      key={h}
                      className='inline-flex items-center gap-1 text-meta px-2 py-0.5 bg-surface-white text-text-secondary rounded-full'
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
      <div className='max-w-[85%] bg-ink text-on-ink rounded-2xl rounded-tl-none px-4 py-2.5 text-message leading-relaxed'>
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
    <div className='bg-surface-card border border-border-soft rounded-xl p-4 space-y-4'>
      {questions.map((q) => (
        <div key={q.id}>
          <p className='text-meta font-medium text-text-secondary mb-2'>{q.text}</p>
          <div className='flex flex-wrap gap-2'>
            {q.options.map((opt) => {
              const isSelected = selected[q.id]?.includes(opt.id);
              return (
                <button
                  key={opt.id}
                  onClick={() => !submitted && toggle(q.id, opt.id, q.allowMultiple)}
                  disabled={submitted}
                  className={cn(
                    'px-3 py-1.5 text-message rounded-full border transition-all',
                    isSelected
                      ? 'bg-ink border-ink text-on-ink'
                      : 'bg-surface-white border-border-soft text-text-secondary hover:border-ink/40 hover:text-text-primary',
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
          'mt-1 px-4 py-1.5 text-message font-medium rounded-full transition-all',
          allAnswered && !submitted
            ? 'bg-brand hover:bg-brand-hover text-on-brand'
            : 'bg-surface-white text-text-muted cursor-not-allowed'
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
        <p className='text-meta font-semibold text-text-muted uppercase tracking-wide'>{label}</p>
        <button
          onClick={onCopy}
          className='text-meta text-text-muted hover:text-text-primary flex items-center gap-1 transition-colors'
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <p className={cn('text-message text-text-secondary leading-relaxed', mono && 'font-mono text-meta bg-surface-white p-2 rounded-lg')}>
        {value}
      </p>
    </div>
  );
}
