import { useRef, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { Paperclip, AtSign, X, Loader2, Send, ArrowUp } from 'lucide-react';
import { cn } from '../lib/utils';
import ModelPicker from './ModelPicker';
import { useWorkspaceUploads } from '../hooks/useWorkspaceUploads';
import { TEXT_MODELS, TEXT_MODEL_KEY, readPref, writePref } from '../lib/models';

// All current generation models accept at most 1 reference image
const GLOBAL_REF_CAP = 1;
import type { Asset, WorkspaceUpload } from '../types';

export type ImageReference = { uploadId: string; name: string; publicUrl: string };

interface ChatInputProps {
  slug: string;
  threadId?: string;
  /** Called when the user submits with captured refs. */
  onSend: (content: string, imageReferences: ImageReference[]) => void;
  /** External loading state (e.g. waiting for AI response). Shows spinner on the send button. */
  sending?: boolean;
  /** When true, disable all inputs */
  disabled?: boolean;
  /** Generated image assets to show in the picker's "Generated images" section */
  imageAssets?: Asset[];
  /** Placeholder text; overrides the smart contextual default when provided */
  placeholder?: string;
  /** Style variant: 'rounded-xl' (thread) or 'rounded-2xl' (workspace). Default 'rounded-xl'. */
  rounded?: 'xl' | '2xl';
  /** Show ArrowUp icon instead of Send. Default: Send. */
  arrowSend?: boolean;
  autoFocus?: boolean;
  /** Controlled text model — parent owns model state */
  textModel: string;
  onTextModelChange: (id: string) => void;
}

export default function ChatInput({
  slug,
  threadId,
  onSend,
  sending = false,
  disabled = false,
  imageAssets = [],
  placeholder,
  rounded = 'xl',
  arrowSend = false,
  autoFocus = false,
  textModel,
  onTextModelChange,
}: ChatInputProps) {
  const { getToken } = useAuth();
  const [value, setValue] = useState('');
  const [attachedRefs, setAttachedRefs] = useState<ImageReference[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { uploads, uploading, uploadFile } = useWorkspaceUploads(slug, getToken);

  // ── handlers ──────────────────────────────────────────────────────────────

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value;
    // Open picker when user types "/" at the start of a word (only if under the ref cap)
    const lastChar = val[val.length - 1];
    const beforeLast = val[val.length - 2];
    if (lastChar === '/' && (!beforeLast || /\s/.test(beforeLast)) && attachedRefs.length < GLOBAL_REF_CAP) {
      setPickerOpen(true);
      setValue(val.slice(0, -1)); // strip trigger "/"
    } else {
      setValue(val);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function submit() {
    if (!value.trim() || sending || disabled) return;
    const refs = [...attachedRefs];
    // Reset local state
    setValue('');
    setAttachedRefs([]);
    setPickerOpen(false);
    onSend(value.trim(), refs);
    // Restore textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }

  function attachUpload(upload: WorkspaceUpload | { id: string; name: string; public_url: string }) {
    setAttachedRefs((prev) => {
      if (prev.some((r) => r.uploadId === upload.id)) return prev;
      return [...prev, { uploadId: upload.id, name: upload.name, publicUrl: upload.public_url }];
    });
    setPickerOpen(false);
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    try {
      const upload = await uploadFile(file, threadId);
      attachUpload(upload);
    } catch { /* silently fail */ }
  }

  function removeRef(uploadId: string) {
    setAttachedRefs((prev) => prev.filter((r) => r.uploadId !== uploadId));
  }

  // ── reference cap ────────────────────────────────────────────────────────
  const atRefCap = attachedRefs.length >= GLOBAL_REF_CAP;

  // ── computed placeholder ─────────────────────────────────────────────────
  const effectivePlaceholder = placeholder ?? (
    attachedRefs.length > 0
      ? 'References attached — ask anything, the AI will analyze them if needed...'
      : threadId
        ? 'Ask for changes, or type / to add reference images...'
        : 'Describe what you want to create… (type / to pick a reference)'
  );

  const roundedClass = rounded === '2xl' ? 'rounded-2xl' : 'rounded-xl';

  return (
    <>
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type='file'
        accept='image/*'
        className='hidden'
        onChange={handleFileSelect}
      />

      <div className={cn(
        'bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 focus-within:border-violet-500 transition-colors',
        roundedClass,
        rounded === '2xl' && 'shadow-xl'
      )}>
        {/* Attachment strip */}
        {attachedRefs.length > 0 && (
          <div className='px-3 pt-2 flex flex-wrap gap-2'>
            {attachedRefs.map((ref, idx) => (
              <div key={ref.uploadId} className='relative group' title={ref.name}>
                <img
                  src={ref.publicUrl}
                  alt={ref.name}
                  className={cn(
                    'w-10 h-10 object-cover border-2',
                    roundedClass,
                    idx === 0 ? 'border-violet-500' : 'border-gray-300 dark:border-gray-700'
                  )}
                />
                {idx === 0 && (
                  <span className='absolute -top-1.5 -left-1.5 text-[10px] bg-violet-600 text-white rounded px-1 leading-4'>
                    1st
                  </span>
                )}
                <button
                  onClick={() => removeRef(ref.uploadId)}
                  className='absolute -top-1.5 -right-1.5 bg-gray-800 dark:bg-gray-200 text-white dark:text-gray-900 rounded-full p-px opacity-0 group-hover:opacity-100 transition-opacity'
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Picker popover */}
        {pickerOpen && (
          <div className='mx-3 mt-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3 max-h-60 overflow-y-auto'>
            <div className='flex items-center justify-between mb-2'>
              <span className='text-xs font-medium text-gray-500 dark:text-gray-400'>Pick a reference</span>
              <button onClick={() => setPickerOpen(false)}>
                <X size={14} className='text-gray-400' />
              </button>
            </div>
            {uploads.length === 0 && imageAssets.length === 0 ? (
              <p className='text-xs text-gray-400 text-center py-4'>No uploads yet. Use the paperclip to upload an image.</p>
            ) : (
              <>
                {uploads.length > 0 && (
                  <>
                    <p className='text-[10px] text-gray-400 mb-1.5 uppercase tracking-wide'>Uploads</p>
                    <div className='flex flex-wrap gap-2 mb-2'>
                      {uploads.map((u) => (
                        <button key={u.id} onClick={() => attachUpload(u)} title={u.name}>
                          <img
                            src={u.public_url}
                            alt={u.name}
                            className={cn(
                              'w-14 h-14 object-cover rounded-lg border-2 transition-all',
                              attachedRefs.some((r) => r.uploadId === u.id)
                                ? 'border-violet-500'
                                : 'border-gray-200 dark:border-gray-700 hover:border-violet-400'
                            )}
                          />
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {imageAssets.length > 0 && (
                  <>
                    <p className='text-[10px] text-gray-400 mb-1.5 uppercase tracking-wide'>Generated images</p>
                    <div className='flex flex-wrap gap-2'>
                      {imageAssets.map((a) => a.public_url && (
                        <button
                          key={a.id}
                          onClick={() => attachUpload({ id: a.id, name: a.id, public_url: a.public_url! })}
                          title='Generated image'
                        >
                          <img
                            src={a.public_url}
                            alt='Generated'
                            className={cn(
                              'w-14 h-14 object-cover rounded-lg border-2 transition-all',
                              attachedRefs.some((r) => r.uploadId === a.id)
                                ? 'border-violet-500'
                                : 'border-gray-200 dark:border-gray-700 hover:border-violet-400'
                            )}
                          />
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        )}

        {/* Textarea + send button */}
        <div className={cn('flex gap-3 items-end px-4 pb-2', rounded === '2xl' ? 'pt-4' : 'pt-3')}>
          <textarea
            ref={textareaRef}
            rows={1}
            value={value}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={effectivePlaceholder}
            disabled={disabled}
            autoFocus={autoFocus}
            className='flex-1 bg-transparent text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 resize-none focus:outline-none max-h-32 overflow-y-auto leading-relaxed'
            style={{ height: 'auto' }}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
            }}
          />
          <button
            onClick={submit}
            disabled={!value.trim() || sending || disabled}
            className={cn(
              'flex-shrink-0 flex items-center justify-center bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-all',
              arrowSend ? 'mb-0.5 w-8 h-8' : 'p-1.5'
            )}
          >
            {sending
              ? <Loader2 size={arrowSend ? 15 : 16} className='animate-spin' />
              : arrowSend
                ? <ArrowUp size={15} />
                : <Send size={16} />
            }
          </button>
        </div>

        {/* Toolbar row */}
        <div className='px-3 pb-2.5 flex items-center gap-2'>
          {/* Paperclip — disabled when already at the reference cap */}
          <button
            onClick={() => !atRefCap && fileInputRef.current?.click()}
            disabled={uploading || disabled || atRefCap}
            title={atRefCap ? 'Only 1 reference image per generation' : 'Upload reference image'}
            className='text-gray-400 hover:text-violet-500 disabled:opacity-40 transition-colors'
          >
            {uploading ? <Loader2 size={15} className='animate-spin' /> : <Paperclip size={15} />}
          </button>
          {/* / picker toggle — disabled when at cap */}
          <button
            onClick={() => !atRefCap && setPickerOpen((o) => !o)}
            disabled={disabled || atRefCap}
            title={atRefCap ? 'Only 1 reference image per generation' : 'Pick reference from uploads (type / to open)'}
            className={cn(
              'transition-colors',
              pickerOpen ? 'text-violet-500' : atRefCap ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed' : 'text-gray-400 hover:text-violet-500'
            )}
          >
            <AtSign size={15} />
          </button>
          <span className='text-xs text-gray-400 dark:text-gray-600'>Model</span>
          <ModelPicker
            options={TEXT_MODELS}
            value={textModel}
            onChange={(id) => { onTextModelChange(id); writePref(TEXT_MODEL_KEY, id); }}
          />
        </div>
      </div>
    </>
  );
}
