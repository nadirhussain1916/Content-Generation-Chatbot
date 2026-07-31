import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@clerk/clerk-react';
import { api } from '../lib/api';
import type { TfResponse, Workspace } from '../types';
import { Zap } from 'lucide-react';
import { cn } from '../lib/utils';

const TONES = ['professional', 'casual', 'witty', 'formal', 'inspirational'] as const;
const CAPTION_STYLES = ['short', 'medium', 'long'] as const;
const PLATFORMS = ['instagram', 'tiktok'] as const;

export default function OnboardingPage() {
  const { getToken } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    workspaceName: '',
    aiTone: 'professional' as typeof TONES[number],
    defaultCaptionStyle: 'short' as typeof CAPTION_STYLES[number],
    defaultPlatforms: ['instagram'] as typeof PLATFORMS[number][],
  });

  async function handleComplete() {
    if (!form.workspaceName.trim()) return;
    setLoading(true);
    try {
      const token = await getToken();
      const res = await api.post<TfResponse<{ workspace: Workspace }>>(
        '/api/onboarding/complete',
        form,
        token ?? undefined
      );
      if (res.success && res.data?.workspace) {
        navigate(`/workspaces/${res.data.workspace.slug}`, { replace: true });
      }
    } finally {
      setLoading(false);
    }
  }

  function togglePlatform(p: typeof PLATFORMS[number]) {
    setForm((f) => ({
      ...f,
      defaultPlatforms: f.defaultPlatforms.includes(p)
        ? f.defaultPlatforms.filter((x) => x !== p)
        : [...f.defaultPlatforms, p],
    }));
  }

  const inactiveBtn = 'bg-surface-card border-border-soft text-text-secondary hover:border-text-muted';

  return (
    <div
      className='min-h-screen w-full flex items-center justify-center p-2.5 sm:p-5'
      style={{
        background: 'linear-gradient(135deg, var(--color-atmo-a) 0%, var(--color-atmo-b) 50%, var(--color-atmo-c) 100%)',
      }}
    >
      <div className='w-full max-w-md bg-surface-white border border-black/[0.04] dark:border-white/[0.06] rounded-3xl shadow-[0_30px_80px_rgba(40,70,70,0.16)] px-6 py-8 sm:px-10 sm:py-10'>
        {/* Logo */}
        <div className='flex justify-center mb-8'>
          <div className='w-12 h-12 rounded-2xl bg-ink flex items-center justify-center'>
            <Zap size={22} className='text-on-ink' />
          </div>
        </div>

        {/* Progress */}
        <div className='flex gap-2 mb-8'>
          {[1, 2].map((s) => (
            <div
              key={s}
              className={cn(
                'h-1 flex-1 rounded-full transition-all',
                step >= s ? 'bg-ink' : 'bg-border-soft'
              )}
            />
          ))}
        </div>

        {step === 1 && (
          <div className='space-y-6'>
            <div>
              <h1 className='text-heading text-text-primary mb-1'>Welcome aboard</h1>
              <p className='text-message text-text-secondary'>Let's set up your first workspace.</p>
            </div>

            <div>
              <label className='block text-meta font-medium text-text-secondary mb-2'>
                Workspace name
              </label>
              <input
                type='text'
                placeholder='My Brand, Agency Name, etc.'
                value={form.workspaceName}
                onChange={(e) => setForm((f) => ({ ...f, workspaceName: e.target.value }))}
                className='w-full bg-surface-card border border-border-soft rounded-2xl px-4 py-3 text-message text-text-primary placeholder-text-muted focus:outline-none focus:border-ink transition-colors'
              />
            </div>

            <div>
              <label className='block text-meta font-medium text-text-secondary mb-2'>
                Default platforms
              </label>
              <div className='flex gap-3'>
                {PLATFORMS.map((p) => (
                  <button
                    key={p}
                    onClick={() => togglePlatform(p)}
                    className={cn(
                      'flex-1 py-2.5 rounded-xl border text-message font-medium capitalize transition-all',
                      form.defaultPlatforms.includes(p)
                        ? 'bg-ink border-ink text-on-ink'
                        : inactiveBtn
                    )}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={() => setStep(2)}
              disabled={!form.workspaceName.trim()}
              className='w-full bg-brand hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors py-3 rounded-lg font-semibold text-message text-on-brand'
            >
              Continue
            </button>
          </div>
        )}

        {step === 2 && (
          <div className='space-y-6'>
            <div>
              <h1 className='text-heading text-text-primary mb-1'>AI preferences</h1>
              <p className='text-message text-text-secondary'>How should the AI write for <strong className='text-text-primary'>{form.workspaceName}</strong>?</p>
            </div>

            <div>
              <label className='block text-meta font-medium text-text-secondary mb-2'>Brand tone</label>
              <div className='grid grid-cols-3 gap-2'>
                {TONES.map((t) => (
                  <button
                    key={t}
                    onClick={() => setForm((f) => ({ ...f, aiTone: t }))}
                    className={cn(
                      'py-2 rounded-xl border text-message capitalize transition-all',
                      form.aiTone === t
                        ? 'bg-ink border-ink text-on-ink'
                        : inactiveBtn
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className='block text-meta font-medium text-text-secondary mb-2'>Caption style</label>
              <div className='flex gap-2'>
                {CAPTION_STYLES.map((s) => (
                  <button
                    key={s}
                    onClick={() => setForm((f) => ({ ...f, defaultCaptionStyle: s }))}
                    className={cn(
                      'flex-1 py-2 rounded-xl border text-message capitalize transition-all',
                      form.defaultCaptionStyle === s
                        ? 'bg-ink border-ink text-on-ink'
                        : inactiveBtn
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div className='flex gap-3'>
              <button
                onClick={() => setStep(1)}
                className='flex-1 bg-surface-white border-2 border-brand text-brand hover:bg-brand/5 transition-colors py-3 rounded-lg font-medium text-message'
              >
                Back
              </button>
              <button
                onClick={handleComplete}
                disabled={loading}
                className='flex-1 bg-brand hover:bg-brand-hover disabled:opacity-50 transition-colors py-3 rounded-lg font-semibold text-message text-on-brand'
              >
                {loading ? 'Setting up...' : 'Launch workspace'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
