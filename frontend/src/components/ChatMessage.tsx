import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { useAuth } from '@clerk/clerk-react';
import type { Message, PlannerResult, PlannerQuestion, ImagePostPackage, VideoPostPackage, Asset, WorkspaceUpload } from '../types';
import { cn, formatMessageTime } from '../lib/utils';
import { ChevronDown, ChevronUp, Copy, Check, Hash, Loader2, Share2, CheckCircle, AlertCircle, Star, X, Plus, Pencil } from 'lucide-react';
import GenerateImageButton from './GenerateImageButton';
import GenerateVideoButton from './GenerateVideoButton';
import EditDraftModal from './EditDraftModal';
import { usePublishStatus } from '../hooks/usePublishStatus';
import { readPref, IMAGE_MODEL_KEY, VIDEO_MODEL_KEY, DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL, IMAGE_MODEL_REF_CAPS, VIDEO_MODEL_REF_CAPS } from '../lib/models';

interface ChatMessageProps {
  message: Message;
  onOptionSelect?: (text: string) => void;
  asset?: Asset;
  assetBlobUrl?: string;
  slug?: string;
  threadId?: string;
  onAssetGenerated?: (asset: Asset) => void;
  // Reference image thumbnails to display in user bubbles
  attachedImages?: { publicUrl: string; name: string }[];
  // For the draft card reference picker
  uploads?: WorkspaceUpload[];
  imageAssets?: Asset[];
}

export default function ChatMessage({ message, onOptionSelect, asset, assetBlobUrl, slug, threadId, onAssetGenerated, attachedImages, uploads = [], imageAssets = [] }: ChatMessageProps) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const { status: publishStatus, publish } = usePublishStatus(slug, asset?.id);
  const { getToken } = useAuth();

  // Local post_package state for optimistic draft reference/content edits
  const [localPkg, setLocalPkg] = useState<(ImagePostPackage & VideoPostPackage) | null>(() => {
    try { return message.post_package ? JSON.parse(message.post_package) : null; } catch { return null; }
  });
  const [refPickerOpen, setRefPickerOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);

  // Sync from prop only when the message id changes (avoid clobbering local edits during polls)
  useEffect(() => {
    try { setLocalPkg(message.post_package ? JSON.parse(message.post_package) : null); } catch { setLocalPkg(null); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message.id]);

  const BACKEND = import.meta.env.VITE_API_BASE_URL ?? '';

  async function patchReferences(referenceUploadIds: string[], primaryReferenceUploadId: string | null) {
    if (!slug || !threadId) return;
    const token = await getToken();
    try {
      await fetch(
        `${BACKEND}/api/workspaces/${slug}/threads/${threadId}/messages/${message.id}/references`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            ...(token && { Authorization: `Bearer ${token}` }),
          },
          body: JSON.stringify({ referenceUploadIds, primaryReferenceUploadId }),
        }
      );
    } catch { /* revert handled by caller */ }
  }

  async function savePackage(updatedPkg: ImagePostPackage | VideoPostPackage) {
    if (!slug || !threadId) return;
    const token = await getToken();
    const prevPkg = localPkg;
    // Optimistic update
    setLocalPkg(updatedPkg as ImagePostPackage & VideoPostPackage);
    try {
      await fetch(
        `${BACKEND}/api/workspaces/${slug}/threads/${threadId}/messages/${message.id}/package`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            ...(token && { Authorization: `Bearer ${token}` }),
          },
          body: JSON.stringify({ post_package: JSON.stringify(updatedPkg) }),
        }
      );
    } catch {
      // Revert on error
      setLocalPkg(prevPkg);
      throw new Error('Failed to save');
    }
  }

  function optimisticUpdateRefs(referenceUploadIds: string[], primaryReferenceUploadId: string | null) {
    const prevPkg = localPkg;
    setLocalPkg((prev) => prev ? { ...prev, referenceUploadIds, primaryReferenceUploadId } : prev);
    patchReferences(referenceUploadIds, primaryReferenceUploadId).catch(() => {
      // Revert on error
      setLocalPkg(prevPkg);
    });
  }

  function removeRef(uploadId: string) {
    const ids = (localPkg?.referenceUploadIds ?? []).filter((id) => id !== uploadId);
    let primary = localPkg?.primaryReferenceUploadId ?? null;
    if (primary === uploadId) primary = ids[0] ?? null;
    optimisticUpdateRefs(ids, primary);
  }

  function swapPrimary(uploadId: string) {
    const ids = localPkg?.referenceUploadIds ?? [];
    optimisticUpdateRefs(ids, uploadId);
  }

  function addRef(upload: WorkspaceUpload) {
    const ids = [...(localPkg?.referenceUploadIds ?? [])];
    if (ids.includes(upload.id)) return;
    ids.push(upload.id);
    const primary = localPkg?.primaryReferenceUploadId ?? ids[0] ?? null;
    optimisticUpdateRefs(ids, primary);
    setRefPickerOpen(false);
  }

  function getRefUrl(uploadId: string): string | undefined {
    const u = uploads.find((up) => up.id === uploadId);
    if (u) return u.public_url;
    const a = imageAssets.find((a) => a.id === uploadId);
    return a?.public_url ?? undefined;
  }

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

  // Markdown component overrides — styled to match the dark ink bubble
  const mdComponents: React.ComponentProps<typeof ReactMarkdown>['components'] = {
    p:      ({ children }) => <p className='mb-2 last:mb-0'>{children}</p>,
    strong: ({ children }) => <strong className='font-semibold text-white'>{children}</strong>,
    em:     ({ children }) => <em className='italic opacity-90'>{children}</em>,
    ul:     ({ children }) => <ul className='list-disc list-inside mb-2 space-y-0.5'>{children}</ul>,
    ol:     ({ children }) => <ol className='list-decimal list-inside mb-2 space-y-0.5'>{children}</ol>,
    li:     ({ children }) => <li className='leading-relaxed'>{children}</li>,
    h1:     ({ children }) => <h1 className='text-base font-bold mb-1'>{children}</h1>,
    h2:     ({ children }) => <h2 className='text-sm font-bold mb-1'>{children}</h2>,
    h3:     ({ children }) => <h3 className='text-sm font-semibold mb-1'>{children}</h3>,
    code:   ({ children }) => <code className='bg-white/10 rounded px-1 py-0.5 text-meta font-mono'>{children}</code>,
    pre:    ({ children }) => <pre className='bg-white/10 rounded-lg p-3 mb-2 overflow-x-auto text-meta font-mono'>{children}</pre>,
    a:      ({ href, children }) => <a href={href} target='_blank' rel='noopener noreferrer' className='underline underline-offset-2 opacity-80 hover:opacity-100'>{children}</a>,
  };

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
        <div className='max-w-[75%] space-y-1.5'>
          {attachedImages && attachedImages.length > 0 && (
            <div className='flex flex-wrap gap-1.5 justify-end'>
              {attachedImages.map((img) => (
                <img
                  key={img.publicUrl}
                  src={img.publicUrl}
                  alt={img.name}
                  title={img.name}
                  className='w-12 h-12 object-cover rounded-lg border-2 border-violet-400/60'
                />
              ))}
            </div>
          )}
          <div className='bg-surface-white border border-black/[0.04] dark:border-white/[0.06] text-text-primary rounded-2xl rounded-br-[4px] px-4 py-2.5 text-message shadow-[0_2px_10px_rgba(0,0,0,0.03)]'>
            {message.content}
          </div>
          <p className='text-right text-[10px] text-text-muted mt-1 px-1'>
            {formatMessageTime(message.created_at)}
          </p>
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
            <ReactMarkdown components={mdComponents}>{plannerData.reply}</ReactMarkdown>
          </div>
          {plannerData.questions && plannerData.questions.length > 0 && (
            <QuestionGroups
              questions={plannerData.questions}
              onSelect={onOptionSelect}
            />
          )}
          <p className='text-[10px] text-text-muted px-1'>
            {formatMessageTime(message.created_at)}
          </p>
        </div>
      </div>
    );
  }

  // Draft / PostPackage card
  if (isDraft && postPackage) {
    // Use localPkg for all fields (supports optimistic edits); fall back to postPackage
    const pkg = (localPkg ?? postPackage) as ImagePostPackage & VideoPostPackage;
    const isVideo = 'script' in (postPackage as object);
    const refIds: string[] = pkg.referenceUploadIds ?? [];
    const primaryId = pkg.primaryReferenceUploadId ?? null;

    // ── Reference cap based on user's current preferred generation model ──────
    const preferredImageModel = readPref(IMAGE_MODEL_KEY, DEFAULT_IMAGE_MODEL);
    const preferredVideoModel = readPref(VIDEO_MODEL_KEY, DEFAULT_VIDEO_MODEL);
    const refCap = isVideo
      ? (VIDEO_MODEL_REF_CAPS[preferredVideoModel as keyof typeof VIDEO_MODEL_REF_CAPS] ?? 1)
      : (IMAGE_MODEL_REF_CAPS[preferredImageModel as keyof typeof IMAGE_MODEL_REF_CAPS] ?? 1);
    const isWanT2V = isVideo && preferredVideoModel === 'wan-video/wan-2.7-t2v';
    const refAtCap = refIds.length >= refCap;

    return (
      <>
        {editModalOpen && (
          <EditDraftModal
            open={editModalOpen}
            onClose={() => setEditModalOpen(false)}
            pkg={pkg}
            isVideo={isVideo}
            onSave={savePackage}
          />
        )}
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
            <div className='flex items-center gap-1'>
              {slug && threadId && (
                <button
                  onClick={() => setEditModalOpen(true)}
                  title='Edit draft'
                  className='p-1 text-text-muted hover:text-ink transition-colors'
                >
                  <Pencil size={14} />
                </button>
              )}
              <button onClick={() => setExpanded((p) => !p)} className='p-1 text-text-muted hover:text-text-primary'>
                {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
            </div>
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

              {/* ── References section ── */}
              {(refIds.length > 0 || (uploads.length > 0 || imageAssets.length > 0)) && (
                <div>
                  <p className='text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2'>References</p>
                  <div className='flex flex-wrap gap-2 items-start'>
                    {refIds.map((id) => {
                      const url = getRefUrl(id);
                      const isPrimary = id === primaryId;
                      if (!url) return null;
                      return (
                        <div key={id} className='relative group'>
                          <button
                            onClick={() => !isPrimary && swapPrimary(id)}
                            title={isPrimary ? 'Primary reference' : 'Make primary'}
                          >
                            <img
                              src={url}
                              alt='Reference'
                              className={cn(
                                'w-14 h-14 object-cover rounded-lg border-2 transition-all',
                                isPrimary
                                  ? 'border-violet-500'
                                  : 'border-gray-200 dark:border-gray-700 hover:border-violet-400'
                              )}
                            />
                          </button>
                          {isPrimary && (
                            <Star size={12} className='absolute -top-1.5 -left-1.5 fill-violet-500 text-violet-500' />
                          )}
                          <button
                            onClick={() => removeRef(id)}
                            className='absolute -top-1.5 -right-1.5 bg-gray-800 dark:bg-gray-200 text-white dark:text-gray-900 rounded-full p-px opacity-0 group-hover:opacity-100 transition-opacity'
                          >
                            <X size={10} />
                          </button>
                        </div>
                      );
                    })}

                    {/* Add reference button — hidden when model doesn't support refs or at cap */}
                    {isWanT2V ? (
                      <p className='text-xs text-amber-600 dark:text-amber-400 self-center'>
                        Wan 2.7 T2V is text-only — references are not supported
                      </p>
                    ) : refAtCap ? (
                      <p className='text-xs text-gray-400 dark:text-gray-500 self-center'>
                        Max {refCap} reference for this model
                      </p>
                    ) : (
                      <div className='relative'>
                        <button
                          onClick={() => setRefPickerOpen((o) => !o)}
                          className='w-14 h-14 flex items-center justify-center rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-700 text-gray-400 hover:border-violet-500 hover:text-violet-500 transition-colors'
                          title='Add reference'
                        >
                          <Plus size={16} />
                        </button>
                        {refPickerOpen && (
                          <div className='absolute bottom-16 left-0 z-20 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3 w-56 max-h-52 overflow-y-auto'>
                            <div className='flex items-center justify-between mb-2'>
                              <span className='text-xs font-medium text-gray-500'>Pick a reference</span>
                              <button onClick={() => setRefPickerOpen(false)}>
                                <X size={12} className='text-gray-400' />
                              </button>
                            </div>
                            <div className='flex flex-wrap gap-2'>
                              {uploads.map((u) => (
                                <button key={u.id} onClick={() => addRef(u)} title={u.name}>
                                  <img src={u.public_url} alt={u.name} className={cn('w-12 h-12 object-cover rounded-lg border-2 transition-all', refIds.includes(u.id) ? 'border-violet-500' : 'border-gray-200 dark:border-gray-700 hover:border-violet-400')} />
                                </button>
                              ))}
                              {imageAssets.map((a) => a.public_url && (
                                <button key={a.id} onClick={() => addRef({ id: a.id, name: a.id, public_url: a.public_url!, workspace_id: '', thread_id: null, mime_type: null, vision_description: null, created_at: 0 })} title='Generated image'>
                                  <img src={a.public_url} alt='Generated' className={cn('w-12 h-12 object-cover rounded-lg border-2 transition-all', refIds.includes(a.id) ? 'border-violet-500' : 'border-gray-200 dark:border-gray-700 hover:border-violet-400')} />
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <p className='text-[10px] text-text-muted mt-1 px-1'>
        {formatMessageTime(message.created_at)}
      </p>
    </>
    );
  }

  // Plain assistant message
  return (
    <div className='flex justify-start'>
      <div className='max-w-[85%] space-y-1'>
        <div className='bg-ink text-on-ink rounded-2xl rounded-tl-none px-4 py-2.5 text-message leading-relaxed'>
          <ReactMarkdown components={mdComponents}>{message.content}</ReactMarkdown>
        </div>
        <p className='text-[10px] text-text-muted px-1'>
          {formatMessageTime(message.created_at)}
        </p>
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
