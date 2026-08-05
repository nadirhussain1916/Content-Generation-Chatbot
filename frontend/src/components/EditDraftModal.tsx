import { useState, useEffect, useRef } from 'react';
import { X, Save, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';
import type { ImagePostPackage, VideoPostPackage } from '../types';

type DraftPkg = ImagePostPackage & VideoPostPackage;

interface EditDraftModalProps {
  open: boolean;
  onClose: () => void;
  pkg: DraftPkg;
  isVideo: boolean;
  onSave: (updated: DraftPkg) => Promise<void>;
}

export default function EditDraftModal({ open, onClose, pkg, isVideo, onSave }: EditDraftModalProps) {
  const [form, setForm] = useState<DraftPkg>(pkg);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  // Sync form when the source package changes (e.g. after an AI refinement)
  useEffect(() => {
    setForm(pkg);
    setError(null);
  }, [pkg]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  function set<K extends keyof DraftPkg>(key: K, value: DraftPkg[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function setScript<K extends keyof DraftPkg['script']>(key: K, value: DraftPkg['script'][K]) {
    setForm((prev) => ({
      ...prev,
      script: { ...prev.script, [key]: value },
    }));
  }

  function parseHashtags(raw: string): string[] {
    return raw
      .split(/[\s,]+/)
      .map((t) => t.replace(/^#/, '').trim())
      .filter(Boolean);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await onSave(form);
      onClose();
    } catch {
      setError('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      ref={backdropRef}
      onClick={(e) => { if (e.target === backdropRef.current) onClose(); }}
      className='fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4'
    >
      <div className='bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col'>
        {/* Header */}
        <div className='flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-800 flex-shrink-0'>
          <div className='flex items-center gap-2'>
            <div className='w-2 h-2 rounded-full bg-violet-500' />
            <span className='font-semibold text-sm text-gray-900 dark:text-white'>
              Edit {isVideo ? 'Video Script' : 'Image Post'} Draft
            </span>
          </div>
          <button onClick={onClose} className='text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors'>
            <X size={18} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className='flex-1 overflow-y-auto p-5 space-y-5'>
          {/* Caption */}
          <Field label='Caption'>
            <textarea
              rows={3}
              value={form.caption}
              onChange={(e) => set('caption', e.target.value)}
              maxLength={2200}
              className={fieldClass}
            />
            <CharCount current={form.caption.length} max={2200} />
          </Field>

          {/* TikTok title */}
          <Field label='TikTok Title'>
            <input
              type='text'
              value={form.title}
              onChange={(e) => set('title', e.target.value)}
              maxLength={150}
              className={fieldClass}
            />
            <CharCount current={form.title.length} max={150} />
          </Field>

          {/* TikTok description */}
          <Field label='TikTok Description'>
            <textarea
              rows={3}
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              maxLength={2200}
              className={fieldClass}
            />
            <CharCount current={form.description.length} max={2200} />
          </Field>

          {/* Hashtags */}
          <Field label='Hashtags' hint='Separate with spaces or commas, no # needed'>
            <textarea
              rows={2}
              value={form.hashtags.join(' ')}
              onChange={(e) => set('hashtags', parseHashtags(e.target.value))}
              className={fieldClass}
            />
          </Field>

          {/* ── Image-specific fields ─────────────────────────────────────── */}
          {!isVideo && (
            <>
              <Field label='Image Prompt'>
                <textarea
                  rows={5}
                  value={form.imagePrompt}
                  onChange={(e) => set('imagePrompt', e.target.value)}
                  className={cn(fieldClass, 'font-mono text-xs')}
                />
              </Field>

              <Field label='Image Size'>
                <select
                  value={form.imageSize}
                  onChange={(e) => set('imageSize', e.target.value as DraftPkg['imageSize'])}
                  className={fieldClass}
                >
                  <option value='1024x1024'>1:1 — Square (Instagram feed)</option>
                  <option value='1024x1792'>9:16 — Portrait (Stories / TikTok)</option>
                  <option value='1792x1024'>16:9 — Landscape (YouTube / Twitter)</option>
                </select>
              </Field>

              <Field label='Image Style'>
                <input
                  type='text'
                  value={form.imageStyle}
                  onChange={(e) => set('imageStyle', e.target.value)}
                  className={fieldClass}
                />
              </Field>
            </>
          )}

          {/* ── Video-specific fields ─────────────────────────────────────── */}
          {isVideo && form.script && (
            <>
              <div className='border-t border-gray-100 dark:border-gray-800 pt-4'>
                <p className='text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3'>Script</p>
                <div className='space-y-4'>
                  <Field label='Hook (opening 3-5 seconds)'>
                    <textarea
                      rows={2}
                      value={form.script.hook}
                      onChange={(e) => setScript('hook', e.target.value)}
                      className={fieldClass}
                    />
                  </Field>
                  <Field label='Body'>
                    <textarea
                      rows={4}
                      value={form.script.body}
                      onChange={(e) => setScript('body', e.target.value)}
                      className={fieldClass}
                    />
                  </Field>
                  <Field label='Call to Action'>
                    <textarea
                      rows={2}
                      value={form.script.callToAction}
                      onChange={(e) => setScript('callToAction', e.target.value)}
                      className={fieldClass}
                    />
                  </Field>
                  <Field label='Estimated Duration'>
                    <input
                      type='text'
                      value={form.script.estimatedDuration}
                      onChange={(e) => setScript('estimatedDuration', e.target.value)}
                      className={fieldClass}
                    />
                  </Field>
                  <Field label='Voiceover Notes'>
                    <textarea
                      rows={2}
                      value={form.script.voiceoverNotes}
                      onChange={(e) => setScript('voiceoverNotes', e.target.value)}
                      className={fieldClass}
                    />
                  </Field>
                </div>
              </div>

              <Field label='Video Prompt'>
                <textarea
                  rows={6}
                  value={form.videoPrompt}
                  onChange={(e) => set('videoPrompt', e.target.value)}
                  className={cn(fieldClass, 'font-mono text-xs')}
                />
              </Field>
            </>
          )}
        </div>

        {/* Footer */}
        <div className='flex items-center justify-between px-5 py-4 border-t border-gray-200 dark:border-gray-800 flex-shrink-0'>
          {error ? (
            <p className='text-xs text-red-500'>{error}</p>
          ) : (
            <span className='text-xs text-gray-400'>Changes are saved to the draft immediately.</span>
          )}
          <div className='flex items-center gap-2'>
            <button
              onClick={onClose}
              className='px-4 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors'
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className='flex items-center gap-1.5 px-4 py-1.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors'
            >
              {saving ? <Loader2 size={14} className='animate-spin' /> : <Save size={14} />}
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className='block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5'>
        {label}
        {hint && <span className='ml-1.5 font-normal normal-case text-gray-400'>{hint}</span>}
      </label>
      {children}
    </div>
  );
}

function CharCount({ current, max }: { current: number; max: number }) {
  const near = current > max * 0.9;
  return (
    <p className={cn('text-right text-xs mt-1', near ? 'text-amber-500' : 'text-gray-400')}>
      {current}/{max}
    </p>
  );
}

const fieldClass =
  'w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 ' +
  'rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white ' +
  'placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500 ' +
  'focus:border-transparent transition-all resize-none';
