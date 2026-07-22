import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '@clerk/clerk-react';
import { api } from '../lib/api';
import type { TfResponse, Workspace, SocialAccountSafe } from '../types';
import Sidebar from '../components/Sidebar';
import { useNavigate } from 'react-router-dom';
import { CheckCircle, XCircle, Link2, Unlink, Loader2, Settings } from 'lucide-react';
import { cn } from '../lib/utils';

const BACKEND = import.meta.env.VITE_API_BASE_URL ?? '';

export default function SettingsPage() {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();
  const { getToken } = useAuth();
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
    // Media defaults
    default_image_size: '1024x1024' as Workspace['default_image_size'],
    default_video_duration: 5 as number,
    default_video_dimensions: '1280x720' as Workspace['default_video_dimensions'],
  });

  useEffect(() => {
    (async () => {
      const token = await getToken();
      const [wsRes, accountsRes] = await Promise.all([
        api.get<TfResponse<Workspace>>(`/api/workspaces/${slug}`, token ?? undefined),
        api.get<TfResponse<SocialAccountSafe[]>>(`/api/workspaces/${slug}/social/accounts`, token ?? undefined),
      ]);
      if (wsRes.success && wsRes.data) {
        setWorkspace(wsRes.data);
        setForm({
          ai_tone: wsRes.data.ai_tone,
          default_caption_style: wsRes.data.default_caption_style,
          brand_name: wsRes.data.brand_name ?? '',
          brand_description: wsRes.data.brand_description ?? '',
          brand_voice: wsRes.data.brand_voice ?? '',
          target_audience: wsRes.data.target_audience ?? '',
          agent_instructions: wsRes.data.agent_instructions ?? '',
          default_image_size: wsRes.data.default_image_size ?? '1024x1024',
          default_video_duration: wsRes.data.default_video_duration ?? 5,
          default_video_dimensions: wsRes.data.default_video_dimensions ?? '1280x720',
        });
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
    const payload = {
      ai_tone: form.ai_tone,
      default_caption_style: form.default_caption_style,
      brand_name: form.brand_name || null,
      brand_description: form.brand_description || null,
      brand_voice: form.brand_voice || null,
      target_audience: form.target_audience || null,
      agent_instructions: form.agent_instructions || null,
      default_image_size: form.default_image_size,
      default_video_duration: form.default_video_duration,
      default_video_dimensions: form.default_video_dimensions,
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

  function connectUrl(platform: string) {
    return `${BACKEND}/api/workspaces/${slug}/social/connect/${platform}`;
  }

  async function handleNewThread() {
    const token = await getToken();
    const res = await api.post<TfResponse<{ id: string }>>(`/api/workspaces/${slug}/threads`, {}, token ?? undefined);
    if (res.success && res.data) navigate(`/workspaces/${slug}/threads/${res.data.id}`);
    else navigate(`/workspaces/${slug}`);
  }

  const igAccount = accounts.find((a) => a.platform === 'instagram');
  const ttAccount = accounts.find((a) => a.platform === 'tiktok');

  return (
    <div className='flex h-screen bg-gray-950 text-white'>
      <Sidebar onNewThread={handleNewThread} />

      <main className='flex-1 overflow-y-auto'>
        <div className='max-w-2xl mx-auto px-6 py-8'>
          <div className='flex items-center gap-2 mb-8'>
            <Settings size={20} className='text-gray-400' />
            <h1 className='text-xl font-semibold'>Workspace settings</h1>
          </div>

          {loading ? (
            <div className='flex justify-center py-12'>
              <Loader2 size={20} className='animate-spin text-gray-500' />
            </div>
          ) : (
            <div className='space-y-8'>
              {/* AI Settings */}
              <section className='bg-gray-900 rounded-xl p-5 space-y-4'>
                <h2 className='font-semibold text-sm uppercase tracking-wide text-gray-400'>AI Preferences</h2>

                <div>
                  <label className='block text-sm font-medium text-gray-300 mb-2'>Brand tone</label>
                  <div className='flex flex-wrap gap-2'>
                    {(['professional', 'casual', 'witty', 'formal', 'inspirational'] as const).map((t) => (
                      <button
                        key={t}
                        onClick={() => setForm((f) => ({ ...f, ai_tone: t }))}
                        className={cn(
                          'px-3 py-1.5 rounded-lg border text-sm capitalize transition-all',
                          form.ai_tone === t
                            ? 'bg-violet-600 border-violet-500 text-white'
                            : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500'
                        )}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className='block text-sm font-medium text-gray-300 mb-2'>Caption style</label>
                  <div className='flex gap-2'>
                    {(['short', 'medium', 'long'] as const).map((s) => (
                      <button
                        key={s}
                        onClick={() => setForm((f) => ({ ...f, default_caption_style: s }))}
                        className={cn(
                          'flex-1 py-2 rounded-lg border text-sm capitalize transition-all',
                          form.default_caption_style === s
                            ? 'bg-violet-600 border-violet-500 text-white'
                            : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500'
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
                  className='px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors'
                >
                  {saving ? 'Saving...' : 'Save settings'}
                </button>
              </section>

              {/* Media Defaults */}
              <section className='bg-gray-900 rounded-xl p-5 space-y-5'>
                <div>
                  <h2 className='font-semibold text-sm uppercase tracking-wide text-gray-400'>Media Defaults</h2>
                  <p className='text-xs text-gray-500 mt-1'>Set the default dimensions and duration used when generating images and videos for this workspace. The AI will always respect these unless you ask otherwise.</p>
                </div>

                {/* Default image size */}
                <div>
                  <label className='block text-sm font-medium text-gray-300 mb-2'>Default image size</label>
                  <div className='grid grid-cols-3 gap-2'>
                    {([
                      { value: '1024x1024', label: '1:1', sub: 'Square · Instagram feed' },
                      { value: '1024x1792', label: '9:16', sub: 'Portrait · Stories / TikTok' },
                      { value: '1792x1024', label: '16:9', sub: 'Landscape · YouTube / Twitter' },
                    ] as const).map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => setForm((f) => ({ ...f, default_image_size: opt.value }))}
                        className={cn(
                          'flex flex-col items-center gap-0.5 px-3 py-3 rounded-xl border text-sm transition-all',
                          form.default_image_size === opt.value
                            ? 'bg-blue-600 border-blue-500 text-white'
                            : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-blue-500 hover:text-white'
                        )}
                      >
                        <span className='font-mono font-semibold'>{opt.label}</span>
                        <span className='text-[10px] opacity-70 text-center leading-tight'>{opt.sub}</span>
                      </button>
                    ))}
                  </div>
                  <p className='text-xs text-gray-600 mt-1.5'>Current: <span className='font-mono text-gray-400'>{form.default_image_size}</span></p>
                </div>

                {/* Default video duration */}
                <div>
                  <label className='block text-sm font-medium text-gray-300 mb-2'>Default video duration</label>
                  <div className='flex gap-2'>
                    {([5, 10] as const).map((d) => (
                      <button
                        key={d}
                        onClick={() => setForm((f) => ({ ...f, default_video_duration: d }))}
                        className={cn(
                          'flex-1 py-2 rounded-lg border text-sm font-medium transition-all',
                          form.default_video_duration === d
                            ? 'bg-purple-600 border-purple-500 text-white'
                            : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-purple-500 hover:text-white'
                        )}
                      >
                        {d}s
                      </button>
                    ))}
                  </div>
                  <p className='text-xs text-gray-600 mt-1.5'>Saved as a preference. Duration is model-dependent — the current WAN 2.1 model generates ~5s clips.</p>
                </div>

                {/* Default video dimensions */}
                <div>
                  <label className='block text-sm font-medium text-gray-300 mb-2'>Default video dimensions</label>
                  <div className='grid grid-cols-2 gap-2'>
                    {([
                      { value: '1280x720', label: '16:9', sub: 'Landscape · 1280×720' },
                      { value: '720x1280', label: '9:16', sub: 'Portrait · 720×1280 · TikTok / Reels' },
                    ] as const).map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => setForm((f) => ({ ...f, default_video_dimensions: opt.value }))}
                        className={cn(
                          'flex flex-col items-center gap-0.5 px-3 py-3 rounded-xl border text-sm transition-all',
                          form.default_video_dimensions === opt.value
                            ? 'bg-purple-600 border-purple-500 text-white'
                            : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-purple-500 hover:text-white'
                        )}
                      >
                        <span className='font-mono font-semibold'>{opt.label}</span>
                        <span className='text-[10px] opacity-70 text-center leading-tight'>{opt.sub}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  onClick={saveSettings}
                  disabled={saving}
                  className='px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors'
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </section>

              {/* Brand Context */}
              <section className='bg-gray-900 rounded-xl p-5 space-y-4'>
                <div>
                  <h2 className='font-semibold text-sm uppercase tracking-wide text-gray-400'>Brand Context</h2>
                  <p className='text-xs text-gray-500 mt-1'>Help the AI understand your brand so every post feels consistent.</p>
                </div>

                <div>
                  <label className='block text-sm font-medium text-gray-300 mb-1.5'>Brand name</label>
                  <input
                    type='text'
                    placeholder='e.g. Acme Studio'
                    value={form.brand_name}
                    onChange={(e) => setForm((f) => ({ ...f, brand_name: e.target.value }))}
                    className='w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-violet-500 transition-colors'
                  />
                </div>

                <div>
                  <label className='block text-sm font-medium text-gray-300 mb-1.5'>Brand description</label>
                  <textarea
                    rows={3}
                    placeholder='A short brand bio or elevator pitch. What do you do, and for whom?'
                    value={form.brand_description}
                    onChange={(e) => setForm((f) => ({ ...f, brand_description: e.target.value }))}
                    className='w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-violet-500 transition-colors resize-none'
                  />
                </div>

                <div>
                  <label className='block text-sm font-medium text-gray-300 mb-1.5'>Brand voice notes</label>
                  <textarea
                    rows={2}
                    placeholder='e.g. "Bold and direct. Never corporate. Avoid exclamation marks."'
                    value={form.brand_voice}
                    onChange={(e) => setForm((f) => ({ ...f, brand_voice: e.target.value }))}
                    className='w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-violet-500 transition-colors resize-none'
                  />
                </div>

                <div>
                  <label className='block text-sm font-medium text-gray-300 mb-1.5'>Target audience</label>
                  <input
                    type='text'
                    placeholder='e.g. Indie developers aged 25-35 who care about design'
                    value={form.target_audience}
                    onChange={(e) => setForm((f) => ({ ...f, target_audience: e.target.value }))}
                    className='w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-violet-500 transition-colors'
                  />
                </div>

                <button
                  onClick={saveSettings}
                  disabled={saving}
                  className='px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors'
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </section>

              {/* Agent Instructions */}
              <section className='bg-gray-900 rounded-xl p-5 space-y-4'>
                <div>
                  <h2 className='font-semibold text-sm uppercase tracking-wide text-gray-400'>Agent Instructions</h2>
                  <p className='text-xs text-gray-500 mt-1'>Custom rules the AI will always follow when creating content for this workspace.</p>
                </div>

                <div>
                  <textarea
                    rows={6}
                    placeholder={`e.g.\n- Always mention our product URL at the end\n- Never use the word "cheap"\n- Use only British English spelling\n- Include a call-to-action in every caption`}
                    value={form.agent_instructions}
                    onChange={(e) => setForm((f) => ({ ...f, agent_instructions: e.target.value }))}
                    className='w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-violet-500 transition-colors resize-none font-mono'
                  />
                  <p className='text-xs text-gray-600 mt-1.5'>Each line is a separate instruction. Be specific and direct.</p>
                </div>

                <button
                  onClick={saveSettings}
                  disabled={saving}
                  className='px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors'
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </section>

              {/* Social Connections */}
              <section className='bg-gray-900 rounded-xl p-5 space-y-4'>
                <h2 className='font-semibold text-sm uppercase tracking-wide text-gray-400'>Social Accounts</h2>

                {/* Instagram */}
                <div className='flex items-center justify-between py-3 border-b border-gray-800'>
                  <div className='flex items-center gap-3'>
                    <div className='w-9 h-9 rounded-lg bg-gradient-to-br from-pink-500 to-orange-500 flex items-center justify-center'>
                      <span className='text-white font-bold text-sm'>IG</span>
                    </div>
                    <div>
                      <p className='text-sm font-medium'>Instagram</p>
                      <p className='text-xs text-gray-400'>
                        {igAccount ? `@${igAccount.username ?? igAccount.account_id}` : 'Not connected'}
                      </p>
                    </div>
                  </div>
                  {igAccount ? (
                    <button
                      onClick={() => disconnect('instagram')}
                      className='flex items-center gap-1.5 text-xs text-gray-400 hover:text-red-400 transition-colors'
                    >
                      <Unlink size={13} /> Disconnect
                    </button>
                  ) : (
                    <a
                      href={connectUrl('instagram')}
                      className='flex items-center gap-1.5 text-xs bg-gray-800 hover:bg-gray-700 border border-gray-700 text-white px-3 py-1.5 rounded-lg transition-colors'
                    >
                      <Link2 size={13} /> Connect
                    </a>
                  )}
                </div>

                {/* TikTok */}
                <div className='flex items-center justify-between py-3'>
                  <div className='flex items-center gap-3'>
                    <div className='w-9 h-9 rounded-lg bg-gray-800 flex items-center justify-center'>
                      <span className='text-white font-bold text-sm'>TT</span>
                    </div>
                    <div>
                      <p className='text-sm font-medium'>TikTok</p>
                      <p className='text-xs text-gray-400'>
                        {ttAccount ? `@${ttAccount.username ?? ttAccount.account_id}` : 'Not connected'}
                      </p>
                    </div>
                  </div>
                  {ttAccount ? (
                    <button
                      onClick={() => disconnect('tiktok')}
                      className='flex items-center gap-1.5 text-xs text-gray-400 hover:text-red-400 transition-colors'
                    >
                      <Unlink size={13} /> Disconnect
                    </button>
                  ) : (
                    <a
                      href={connectUrl('tiktok')}
                      className='flex items-center gap-1.5 text-xs bg-gray-800 hover:bg-gray-700 border border-gray-700 text-white px-3 py-1.5 rounded-lg transition-colors'
                    >
                      <Link2 size={13} /> Connect
                    </a>
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
            'fixed bottom-6 right-6 flex items-center gap-2 px-4 py-3 rounded-xl shadow-xl text-sm font-medium z-50',
            toast.ok ? 'bg-green-900 text-green-200 border border-green-700' : 'bg-red-900 text-red-200 border border-red-700'
          )}
        >
          {toast.ok ? <CheckCircle size={15} /> : <XCircle size={15} />}
          {toast.msg}
        </div>
      )}
    </div>
  );
}
