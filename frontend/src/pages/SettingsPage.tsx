import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useAuthToken } from '../hooks/useAuthToken';
import { api } from '../lib/api';
import type { TfResponse, Workspace, SocialAccountSafe, WorkspaceUpload } from '../types';
import AppShell from '../components/AppShell';
import Sidebar from '../components/Sidebar';
import { useNavigate } from 'react-router-dom';
import { CheckCircle, XCircle, Link2, Unlink, Loader2, Settings, Upload, X } from 'lucide-react';
import { cn } from '../lib/utils';

const BACKEND = import.meta.env.VITE_API_BASE_URL ?? '';

const SHORT_FORM_PLATFORMS = new Set(['instagram', 'tiktok', 'youtube_shorts']);

function deriveSizesFromPlatforms(platforms: string[]): { imageSize: string; videoDimensions: string } {
  const hasShortForm = platforms.some((p) => SHORT_FORM_PLATFORMS.has(p));
  return hasShortForm
    ? { imageSize: '1024x1792', videoDimensions: '720x1280' }
    : { imageSize: '1792x1024', videoDimensions: '1280x720' };
}

export default function SettingsPage() {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();
  const { getAuthToken: getToken } = useAuthToken();
  const navigate = useNavigate();

  const [, setWorkspace] = useState<Workspace | null>(null);
  const [accounts, setAccounts] = useState<SocialAccountSafe[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  const [form, setForm] = useState({
    ai_tone: '' as Workspace['ai_tone'],
    default_caption_style: '' as Workspace['default_caption_style'],
    brand_name: '',
    brand_description: '',
    brand_voice: '',
    target_audience: '',
    agent_instructions: '',
    // Platforms
    platforms: ['instagram'] as string[],
    // Media defaults (auto-derived from platforms)
    default_image_size: '1024x1024' as string,
    default_video_duration: 5 as number,
    target_video_length: 45 as number,
    default_video_dimensions: '1280x720' as string,
    // Locked character
    character_name: '',
    character_appearance: '',
    character_reference_ids: [] as string[],
  });
  const [characterUploads, setCharacterUploads] = useState<WorkspaceUpload[]>([]);
  const [uploadingRef, setUploadingRef] = useState(false);

  useEffect(() => {
    (async () => {
      const token = await getToken();
      const [wsRes, accountsRes] = await Promise.all([
        api.get<TfResponse<Workspace>>(`/api/workspaces/${slug}`, token ?? undefined),
        api.get<TfResponse<SocialAccountSafe[]>>(`/api/workspaces/${slug}/social/accounts`, token ?? undefined),
      ]);
      if (wsRes.success && wsRes.data) {
        setWorkspace(wsRes.data);
        let charRefIds: string[] = [];
        try { charRefIds = JSON.parse(wsRes.data.character_reference_ids ?? '[]'); } catch { /* ignore */ }
        let platforms: string[] = ['instagram'];
        try { platforms = JSON.parse(wsRes.data.default_platforms ?? '["instagram"]'); } catch { /* ignore */ }
        const derivedSizes = deriveSizesFromPlatforms(platforms);
        setForm({
          ai_tone: wsRes.data.ai_tone,
          default_caption_style: wsRes.data.default_caption_style,
          brand_name: wsRes.data.brand_name ?? '',
          brand_description: wsRes.data.brand_description ?? '',
          brand_voice: wsRes.data.brand_voice ?? '',
          target_audience: wsRes.data.target_audience ?? '',
          agent_instructions: wsRes.data.agent_instructions ?? '',
          platforms,
          default_image_size: derivedSizes.imageSize,
          default_video_duration: wsRes.data.default_video_duration ?? 5,
          target_video_length: wsRes.data.target_video_length ?? 45,
          default_video_dimensions: derivedSizes.videoDimensions,
          character_name: wsRes.data.character_name ?? '',
          character_appearance: wsRes.data.character_appearance ?? '',
          character_reference_ids: charRefIds,
        });
        // Pre-load uploads for existing character refs
        if (charRefIds.length > 0) {
          const uploadsRes = await api.get<TfResponse<WorkspaceUpload[]>>(
            `/api/workspaces/${slug}/uploads`,
            token ?? undefined
          );
          if (uploadsRes.success && uploadsRes.data) {
            setCharacterUploads(uploadsRes.data.filter((u) => charRefIds.includes(u.id)));
          }
        }
      }
      if (accountsRes.success) setAccounts(accountsRes.data ?? []);
      setLoading(false);
    })();

    // Show connection toast from OAuth redirect
    const connected = searchParams.get('connected');
    const error = searchParams.get('error');
    if (connected) setToast({ msg: `${connected} connected!`, ok: true });
    if (error) setToast({ msg: `Connection failed: ${error}`, ok: false });
    setTimeout(() => setToast(null), 4000);
  }, [slug]);

  async function saveSettings() {
    setSaving(true);
    const token = await getToken();
    const derivedSizes = deriveSizesFromPlatforms(form.platforms);
    const payload = {
      ai_tone: form.ai_tone,
      default_caption_style: form.default_caption_style,
      default_platforms: form.platforms.filter((p) => p === 'instagram' || p === 'tiktok') as ('instagram' | 'tiktok')[],
      brand_name: form.brand_name || null,
      brand_description: form.brand_description || null,
      brand_voice: form.brand_voice || null,
      target_audience: form.target_audience || null,
      agent_instructions: form.agent_instructions || null,
      default_image_size: derivedSizes.imageSize as '1024x1024' | '1024x1792' | '1792x1024',
      default_video_duration: form.default_video_duration,
      target_video_length: form.target_video_length,
      default_video_dimensions: derivedSizes.videoDimensions as '1280x720' | '720x1280',
      // Locked character
      character_name: form.character_name || null,
      character_appearance: form.character_appearance || null,
      character_reference_ids: form.character_reference_ids,
    };
    const res = await api.patch<TfResponse<Workspace>>(`/api/workspaces/${slug}`, payload, token ?? undefined);
    if (res.success) {
      setToast({ msg: 'Settings saved', ok: true });
      setTimeout(() => setToast(null), 3000);
    }
    setSaving(false);
  }

  async function disconnect(platform: string) {
    const token = await getToken();
    await api.delete(`/api/workspaces/${slug}/social/disconnect/${platform}`, token ?? undefined);
    setAccounts((prev) => prev.filter((a) => a.platform !== platform));
  }

  async function connectPlatform(platform: string) {
    const token = await getToken();
    const url = `${BACKEND}/api/workspaces/${slug}/social/connect/${platform}${token ? `?t=${token}` : ''}`;
    window.location.href = url;
  }

  async function handleNewThread() {
    const token = await getToken();
    const res = await api.post<TfResponse<{ id: string }>>(`/api/workspaces/${slug}/threads`, {}, token ?? undefined);
    if (res.success && res.data) navigate(`/workspaces/${slug}/threads/${res.data.id}`);
    else navigate(`/workspaces/${slug}`);
  }

  async function uploadCharacterRef(file: File) {
    if (form.character_reference_ids.length >= 8) return;
    setUploadingRef(true);
    try {
      const token = await getToken();
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`${BACKEND}/api/workspaces/${slug}/uploads`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const data: TfResponse<WorkspaceUpload> = await res.json();
      if (data.success && data.data) {
        setCharacterUploads((prev) => [...prev, data.data!]);
        setForm((f) => ({ ...f, character_reference_ids: [...f.character_reference_ids, data.data!.id] }));
      }
    } finally {
      setUploadingRef(false);
    }
  }

  function removeCharacterRef(uploadId: string) {
    setCharacterUploads((prev) => prev.filter((u) => u.id !== uploadId));
    setForm((f) => ({ ...f, character_reference_ids: f.character_reference_ids.filter((id) => id !== uploadId) }));
  }

  const igAccount = accounts.find((a) => a.platform === 'instagram');
  const ttAccount = accounts.find((a) => a.platform === 'tiktok');

  const inputClass = 'w-full bg-surface-white border border-border-soft rounded-xl px-3 py-2 text-message text-text-primary placeholder-text-muted focus:outline-none focus:border-ink transition-colors';
  const sectionClass = 'bg-surface-card rounded-xl p-5 space-y-4';
  const sectionHeadingClass = 'font-semibold text-meta uppercase tracking-wide text-text-secondary';
  const labelClass = 'block text-message font-medium text-text-primary';
  const inactiveButtonClass = 'bg-surface-white border-border-soft text-text-secondary hover:border-ink/30 hover:text-text-primary';

  return (
    <AppShell>
      <Sidebar onNewThread={handleNewThread} />

      <main className='flex-1 overflow-y-auto bg-surface-chat/40 backdrop-blur-xl'>
        <div className='max-w-2xl mx-auto px-6 py-8'>
          <div className='flex items-center gap-2 mb-8'>
            <Settings size={20} className='text-text-secondary' />
            <h1 className='text-heading text-text-primary'>Workspace settings</h1>
          </div>

          {loading ? (
            <div className='flex justify-center py-12'>
              <Loader2 size={20} className='animate-spin text-text-muted' />
            </div>
          ) : (
            <div className='space-y-8'>
              {/* AI Settings */}
              <section className={sectionClass}>
                <h2 className={sectionHeadingClass}>AI Preferences</h2>

                <div>
                  <label className={cn(labelClass, 'mb-2')}>Brand tone</label>
                  <div className='flex flex-wrap gap-2'>
                    {(['professional', 'casual', 'witty', 'formal', 'inspirational'] as const).map((t) => (
                      <button
                        key={t}
                        onClick={() => setForm((f) => ({ ...f, ai_tone: t }))}
                        className={cn(
                          'px-3 py-1.5 rounded-full border text-message capitalize transition-all',
                          form.ai_tone === t
                            ? 'bg-ink border-ink text-on-ink'
                            : inactiveButtonClass
                        )}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className={cn(labelClass, 'mb-2')}>Caption style</label>
                  <div className='flex gap-2'>
                    {(['short', 'medium', 'long'] as const).map((s) => (
                      <button
                        key={s}
                        onClick={() => setForm((f) => ({ ...f, default_caption_style: s }))}
                        className={cn(
                          'flex-1 py-2 rounded-full border text-message capitalize transition-all',
                          form.default_caption_style === s
                            ? 'bg-ink border-ink text-on-ink'
                            : inactiveButtonClass
                        )}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  onClick={saveSettings}
                  disabled={saving}
                  className='px-4 py-2 bg-brand hover:bg-brand-hover disabled:opacity-50 rounded-lg text-message font-medium transition-colors text-on-brand'
                >
                  {saving ? 'Saving...' : 'Save settings'}
                </button>
              </section>

              {/* Media Defaults */}
              <section className={sectionClass}>
                <div>
                  <h2 className={sectionHeadingClass}>Media Defaults</h2>
                  <p className='text-meta text-text-secondary mt-1'>Aspect ratio and image size are automatically set from your selected platforms. Duration settings are configured separately below.</p>
                </div>

                {/* Platform selection */}
                {(() => {
                  const platformOptions = [
                    { id: 'instagram', label: 'Instagram Reels', ratio: '9:16' },
                    { id: 'tiktok',    label: 'TikTok',          ratio: '9:16' },
                    { id: 'youtube_shorts', label: 'YouTube Shorts', ratio: '9:16' },
                  ];
                  const derivedSizes = deriveSizesFromPlatforms(form.platforms);
                  const isPortrait = derivedSizes.videoDimensions === '720x1280';
                  return (
                    <div>
                      <label className={cn(labelClass, 'mb-2')}>Target platforms</label>
                      <div className='flex flex-wrap gap-2'>
                        {platformOptions.map((opt) => {
                          const active = form.platforms.includes(opt.id);
                          return (
                            <button
                              key={opt.id}
                              onClick={() => {
                                const next = active
                                  ? form.platforms.filter((p) => p !== opt.id)
                                  : [...form.platforms, opt.id];
                                const sizes = deriveSizesFromPlatforms(next);
                                setForm((f) => ({
                                  ...f,
                                  platforms: next,
                                  default_image_size: sizes.imageSize,
                                  default_video_dimensions: sizes.videoDimensions,
                                }));
                              }}
                              className={cn(
                                'flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-message transition-all',
                                active ? 'bg-ink border-ink text-on-ink' : inactiveButtonClass
                              )}
                            >
                              {opt.label}
                              <span className={cn('text-meta opacity-70', active && 'opacity-80')}>{opt.ratio}</span>
                            </button>
                          );
                        })}
                      </div>
                      <div className='mt-2 flex items-center gap-3 text-meta text-text-muted'>
                        <span>Derived defaults:</span>
                        <span className='font-mono text-text-secondary'>image {isPortrait ? '9:16' : '16:9'}</span>
                        <span>·</span>
                        <span className='font-mono text-text-secondary'>video {isPortrait ? '9:16' : '16:9'}</span>
                      </div>
                    </div>
                  );
                })()}

                {/* Target video length */}
                {(() => {
                  const targetPresets = [30, 45, 60];
                  const isCustomTarget = !targetPresets.includes(form.target_video_length);
                  const minWords = Math.round(form.target_video_length * 2.4 * 0.9);
                  const maxWords = Math.round(form.target_video_length * 2.4 * 1.1);
                  const inactiveBtn = 'bg-surface-white border-border-soft text-text-secondary hover:border-ink/30 hover:text-text-primary';
                  return (
                    <div>
                      <label className={cn(labelClass, 'mb-1')}>Target video length</label>
                      <p className='text-meta text-text-muted mb-2'>Sets script word count target. {form.target_video_length}s → <span className='font-mono'>{minWords}–{maxWords} words</span></p>
                      <div className='flex gap-2'>
                        {[30, 45, 60].map((d) => (
                          <button
                            key={d}
                            onClick={() => setForm((f) => ({ ...f, target_video_length: d }))}
                            className={cn(
                              'flex-1 py-2 rounded-full border text-message font-medium transition-all',
                              form.target_video_length === d
                                ? 'bg-ink border-ink text-on-ink'
                                : inactiveBtn
                            )}
                          >
                            {d}s
                          </button>
                        ))}
                        <button
                          onClick={() => {
                            if (!isCustomTarget) setForm((f) => ({ ...f, target_video_length: 90 }));
                          }}
                          className={cn(
                            'flex-1 py-2 rounded-full border text-message font-medium transition-all',
                            isCustomTarget ? 'bg-ink border-ink text-on-ink' : inactiveBtn
                          )}
                        >
                          Custom
                        </button>
                      </div>
                      {isCustomTarget && (
                        <div className='mt-2 flex items-center gap-2'>
                          <input
                            type='number'
                            min={10}
                            max={600}
                            step={5}
                            value={form.target_video_length}
                            onChange={(e) => setForm((f) => ({ ...f, target_video_length: Number(e.target.value) }))}
                            className='w-24 bg-surface-white border border-border-soft rounded-lg px-2.5 py-1.5 text-message text-text-primary focus:outline-none focus:border-ink transition-colors font-mono'
                          />
                          <span className='text-meta text-text-secondary'>seconds</span>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Max clip length */}
                {(() => {
                  const clipPresets = [5, 10];
                  const isCustomClip = !clipPresets.includes(form.default_video_duration);
                  const inactiveBtn = 'bg-surface-white border-border-soft text-text-secondary hover:border-ink/30 hover:text-text-primary';
                  return (
                    <div>
                      <label className={cn(labelClass, 'mb-1')}>Max clip length</label>
                      <p className='text-meta text-text-muted mb-2'>Maximum duration of each individual generated video clip.</p>
                      <div className='flex gap-2'>
                        {[5, 10].map((d) => (
                          <button
                            key={d}
                            onClick={() => setForm((f) => ({ ...f, default_video_duration: d }))}
                            className={cn(
                              'flex-1 py-2 rounded-full border text-message font-medium transition-all',
                              form.default_video_duration === d
                                ? 'bg-ink border-ink text-on-ink'
                                : inactiveBtn
                            )}
                          >
                            {d}s
                          </button>
                        ))}
                        <button
                          onClick={() => {
                            if (!isCustomClip) setForm((f) => ({ ...f, default_video_duration: 15 }));
                          }}
                          className={cn(
                            'flex-1 py-2 rounded-full border text-message font-medium transition-all',
                            isCustomClip ? 'bg-ink border-ink text-on-ink' : inactiveBtn
                          )}
                        >
                          Custom
                        </button>
                      </div>
                      {isCustomClip && (
                        <div className='mt-2 flex items-center gap-2'>
                          <input
                            type='number'
                            min={1}
                            max={60}
                            step={1}
                            value={form.default_video_duration}
                            onChange={(e) => setForm((f) => ({ ...f, default_video_duration: Number(e.target.value) }))}
                            className='w-24 bg-surface-white border border-border-soft rounded-lg px-2.5 py-1.5 text-message text-text-primary focus:outline-none focus:border-ink transition-colors font-mono'
                          />
                          <span className='text-meta text-text-secondary'>seconds</span>
                        </div>
                      )}
                    </div>
                  );
                })()}


                <button
                  onClick={saveSettings}
                  disabled={saving}
                  className='px-4 py-2 bg-brand hover:bg-brand-hover disabled:opacity-50 rounded-lg text-message font-medium transition-colors text-on-brand'
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </section>

              {/* Brand Context */}
              <section className={sectionClass}>
                <div>
                  <h2 className={sectionHeadingClass}>Brand Context</h2>
                  <p className='text-meta text-text-secondary mt-1'>Help the AI understand your brand so every post feels consistent.</p>
                </div>

                <div>
                  <label className={cn(labelClass, 'mb-1.5')}>Brand name</label>
                  <input
                    type='text'
                    placeholder='e.g. Acme Studio'
                    value={form.brand_name}
                    onChange={(e) => setForm((f) => ({ ...f, brand_name: e.target.value }))}
                    className={inputClass}
                  />
                </div>

                <div>
                  <label className={cn(labelClass, 'mb-1.5')}>Brand description</label>
                  <textarea
                    rows={3}
                    placeholder='A short brand bio or elevator pitch. What do you do, and for whom?'
                    value={form.brand_description}
                    onChange={(e) => setForm((f) => ({ ...f, brand_description: e.target.value }))}
                    className={cn(inputClass, 'resize-none')}
                  />
                </div>

                <div>
                  <label className={cn(labelClass, 'mb-1.5')}>Brand voice notes</label>
                  <textarea
                    rows={2}
                    placeholder='e.g. "Bold and direct. Never corporate. Avoid exclamation marks."'
                    value={form.brand_voice}
                    onChange={(e) => setForm((f) => ({ ...f, brand_voice: e.target.value }))}
                    className={cn(inputClass, 'resize-none')}
                  />
                </div>

                <div>
                  <label className={cn(labelClass, 'mb-1.5')}>Target audience</label>
                  <input
                    type='text'
                    placeholder='e.g. Indie developers aged 25-35 who care about design'
                    value={form.target_audience}
                    onChange={(e) => setForm((f) => ({ ...f, target_audience: e.target.value }))}
                    className={inputClass}
                  />
                </div>

                <button
                  onClick={saveSettings}
                  disabled={saving}
                  className='px-4 py-2 bg-brand hover:bg-brand-hover disabled:opacity-50 rounded-lg text-message font-medium transition-colors text-on-brand'
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </section>

              {/* Agent Instructions */}
              <section className={sectionClass}>
                <div>
                  <h2 className={sectionHeadingClass}>Agent Instructions</h2>
                  <p className='text-meta text-text-secondary mt-1'>Custom rules the AI will always follow when creating content for this workspace.</p>
                </div>

                <div>
                  <textarea
                    rows={6}
                    placeholder={`e.g.\n- Always mention our product URL at the end\n- Never use the word "cheap"\n- Use only British English spelling\n- Include a call-to-action in every caption`}
                    value={form.agent_instructions}
                    onChange={(e) => setForm((f) => ({ ...f, agent_instructions: e.target.value }))}
                    className={cn(inputClass, 'resize-none font-mono')}
                  />
                  <p className='text-meta text-text-muted mt-1.5'>Each line is a separate instruction. Be specific and direct.</p>
                </div>

                <button
                  onClick={saveSettings}
                  disabled={saving}
                  className='px-4 py-2 bg-brand hover:bg-brand-hover disabled:opacity-50 rounded-lg text-message font-medium transition-colors text-on-brand'
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </section>

              {/* Locked Character */}
              <section className={sectionClass}>
                <div>
                  <h2 className={sectionHeadingClass}>Locked Character</h2>
                  <p className='text-meta text-text-secondary mt-1'>Define one character whose appearance is injected into every video generation prompt to maintain a consistent look across all clips.</p>
                </div>

                <div>
                  <label className={cn(labelClass, 'mb-1.5')}>Character name</label>
                  <input
                    type='text'
                    placeholder='e.g. Aria'
                    value={form.character_name}
                    onChange={(e) => setForm((f) => ({ ...f, character_name: e.target.value }))}
                    className={inputClass}
                  />
                </div>

                <div>
                  <label className={cn(labelClass, 'mb-1.5')}>Appearance description</label>
                  <textarea
                    rows={4}
                    placeholder='Describe physical appearance in detail: hair colour and style, eye colour, skin tone, facial features, typical wardrobe, distinguishing marks. Be specific — this is pasted verbatim into every video prompt.'
                    value={form.character_appearance}
                    onChange={(e) => setForm((f) => ({ ...f, character_appearance: e.target.value }))}
                    className={cn(inputClass, 'resize-none')}
                  />
                </div>

                <div>
                  <label className={cn(labelClass, 'mb-1.5')}>Reference images <span className='text-text-muted font-normal'>({form.character_reference_ids.length}/8)</span></label>
                  <p className='text-meta text-text-muted mb-2'>The first image will be used as the reference image for video generation.</p>
                  <div className='flex flex-wrap gap-2'>
                    {characterUploads.map((u, i) => (
                      <div key={u.id} className='relative group'>
                        <img
                          src={u.public_url}
                          alt={u.name}
                          className='w-16 h-16 object-cover rounded-lg border border-border-soft'
                        />
                        {i === 0 && (
                          <span className='absolute bottom-0.5 left-0.5 text-[9px] bg-ink/80 text-on-ink rounded px-1'>primary</span>
                        )}
                        <button
                          onClick={() => removeCharacterRef(u.id)}
                          className='absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity'
                        >
                          <X size={8} className='text-white' />
                        </button>
                      </div>
                    ))}
                    {form.character_reference_ids.length < 8 && (
                      <label className={cn(
                        'w-16 h-16 flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-border-soft text-text-muted cursor-pointer hover:border-ink/40 hover:text-text-secondary transition-colors',
                        uploadingRef && 'opacity-50 pointer-events-none'
                      )}>
                        {uploadingRef ? <Loader2 size={14} className='animate-spin' /> : <Upload size={14} />}
                        <span className='text-[10px] mt-1'>{uploadingRef ? 'Uploading' : 'Add'}</span>
                        <input
                          type='file'
                          accept='image/*'
                          className='sr-only'
                          onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadCharacterRef(f); e.target.value = ''; }}
                        />
                      </label>
                    )}
                  </div>
                </div>

                <button
                  onClick={saveSettings}
                  disabled={saving}
                  className='px-4 py-2 bg-brand hover:bg-brand-hover disabled:opacity-50 rounded-lg text-message font-medium transition-colors text-on-brand'
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </section>

              {/* Social Connections */}
              <section className={sectionClass}>
                <h2 className={sectionHeadingClass}>Social Accounts</h2>

                {/* Instagram */}
                <div className='flex items-center justify-between py-3 border-b border-border-soft'>
                  <div className='flex items-center gap-3'>
                    <div className='w-9 h-9 rounded-lg bg-gradient-to-br from-pink-500 to-orange-500 flex items-center justify-center'>
                      <span className='text-white font-bold text-sm'>IG</span>
                    </div>
                    <div>
                      <p className='text-message font-medium text-text-primary'>Instagram</p>
                      <p className='text-meta text-text-secondary'>
                        {igAccount ? `@${igAccount.username ?? igAccount.account_id}` : 'Not connected'}
                      </p>
                    </div>
                  </div>
                  {igAccount ? (
                    <button
                      onClick={() => disconnect('instagram')}
                      className='flex items-center gap-1.5 text-meta text-text-secondary hover:text-red-500 dark:hover:text-red-400 transition-colors'
                    >
                      <Unlink size={13} /> Disconnect
                    </button>
                  ) : (
                    <button
                      onClick={() => connectPlatform('instagram')}
                      className='flex items-center gap-1.5 text-meta bg-surface-white hover:bg-surface-card border border-border-soft text-text-primary px-3 py-1.5 rounded-full transition-colors'
                    >
                      <Link2 size={13} /> Connect
                    </button>
                  )}
                </div>

                {/* TikTok */}
                <div className='flex items-center justify-between py-3'>
                  <div className='flex items-center gap-3'>
                    <div className='w-9 h-9 rounded-lg bg-surface-white border border-border-soft flex items-center justify-center'>
                      <span className='text-text-primary font-bold text-sm'>TT</span>
                    </div>
                    <div>
                      <p className='text-message font-medium text-text-primary'>TikTok</p>
                      <p className='text-meta text-text-secondary'>
                        {ttAccount ? `@${ttAccount.username ?? ttAccount.account_id}` : 'Not connected'}
                      </p>
                    </div>
                  </div>
                  {ttAccount ? (
                    <button
                      onClick={() => disconnect('tiktok')}
                      className='flex items-center gap-1.5 text-meta text-text-secondary hover:text-red-500 dark:hover:text-red-400 transition-colors'
                    >
                      <Unlink size={13} /> Disconnect
                    </button>
                  ) : (
                    <button
                      onClick={() => connectPlatform('tiktok')}
                      className='flex items-center gap-1.5 text-meta bg-surface-white hover:bg-surface-card border border-border-soft text-text-primary px-3 py-1.5 rounded-full transition-colors'
                    >
                      <Link2 size={13} /> Connect
                    </button>
                  )}
                </div>
              </section>
            </div>
          )}
        </div>
      </main>

      {/* Toast */}
      {toast && (
        <div
          className={cn(
            'fixed bottom-6 right-6 flex items-center gap-2 px-4 py-3 rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.12)] text-message font-medium z-50 border',
            toast.ok
              ? 'bg-success/10 text-success border-success/30'
              : 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border-red-200 dark:border-red-700/30'
          )}
        >
          {toast.ok ? <CheckCircle size={15} /> : <XCircle size={15} />}
          {toast.msg}
        </div>
      )}
    </AppShell>
  );
}
