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

  return (
    <div className='min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center px-4'>
      <div className='w-full max-w-md'>
        {/* Logo */}
        <div className='flex justify-center mb-8'>
          <div className='w-12 h-12 rounded-xl bg-violet-600 flex items-center justify-center'>
            <Zap size={22} className='text-white' />
          </div>
        </div>

        {/* Progress */}
        <div className='flex gap-2 mb-8'>
          {[1, 2].map((s) => (
            <div
              key={s}
              className={cn(
                'h-1 flex-1 rounded-full transition-all',
                step >= s ? 'bg-violet-500' : 'bg-gray-800'
              )}
            />
          ))}
        </div>

        {step === 1 && (
          <div className='space-y-6'>
            <div>
              <h1 className='text-2xl font-bold mb-1'>Welcome to CreatorOS</h1>
              <p className='text-gray-400'>Let's set up your first workspace.</p>
            </div>

            <div>
              <label className='block text-sm font-medium text-gray-300 mb-2'>
                Workspace name
              </label>
              <input
                type='text'
                placeholder='My Brand, Agency Name, etc.'
                value={form.workspaceName}
                onChange={(e) => setForm((f) => ({ ...f, workspaceName: e.target.value }))}
                className='w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-violet-500 transition-colors'
              />
            </div>

            <div>
              <label className='block text-sm font-medium text-gray-300 mb-2'>
                Default platforms
              </label>
              <div className='flex gap-3'>
                {PLATFORMS.map((p) => (
                  <button
                    key={p}
                    onClick={() => togglePlatform(p)}
                    className={cn(
                      'flex-1 py-2.5 rounded-lg border text-sm font-medium capitalize transition-all',
                      form.defaultPlatforms.includes(p)
                        ? 'bg-violet-600 border-violet-500 text-white'
                        : 'bg-gray-900 border-gray-700 text-gray-400 hover:border-gray-500'
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
              className='w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors py-3 rounded-lg font-semibold'
            >
              Continue
            </button>
          </div>
        )}

        {step === 2 && (
          <div className='space-y-6'>
            <div>
              <h1 className='text-2xl font-bold mb-1'>AI preferences</h1>
              <p className='text-gray-400'>How should the AI write for <strong>{form.workspaceName}</strong>?</p>
            </div>

            <div>
              <label className='block text-sm font-medium text-gray-300 mb-2'>Brand tone</label>
              <div className='grid grid-cols-3 gap-2'>
                {TONES.map((t) => (
                  <button
                    key={t}
                    onClick={() => setForm((f) => ({ ...f, aiTone: t }))}
                    className={cn(
                      'py-2 rounded-lg border text-sm capitalize transition-all',
                      form.aiTone === t
                        ? 'bg-violet-600 border-violet-500 text-white'
                        : 'bg-gray-900 border-gray-700 text-gray-400 hover:border-gray-500'
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
                {CAPTION_STYLES.map((s) => (
                  <button
                    key={s}
                    onClick={() => setForm((f) => ({ ...f, defaultCaptionStyle: s }))}
                    className={cn(
                      'flex-1 py-2 rounded-lg border text-sm capitalize transition-all',
                      form.defaultCaptionStyle === s
                        ? 'bg-violet-600 border-violet-500 text-white'
                        : 'bg-gray-900 border-gray-700 text-gray-400 hover:border-gray-500'
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
                className='flex-1 bg-gray-800 hover:bg-gray-700 transition-colors py-3 rounded-lg font-medium'
              >
                Back
              </button>
              <button
                onClick={handleComplete}
                disabled={loading}
                className='flex-1 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 transition-colors py-3 rounded-lg font-semibold'
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
