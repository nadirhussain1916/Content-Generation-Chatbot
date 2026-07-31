import { SignIn, SignUp } from '@clerk/clerk-react';
import { useNavigate, Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { api } from '../lib/api';
import type { TfResponse, Workspace } from '../types';
import { Zap, MessageSquare, Target, ClipboardCheck, Type, Image as ImageIcon, Video, Heart, Smartphone } from 'lucide-react';
import { useTheme } from '../lib/theme';
import { GRAIN_TEXTURE } from '../lib/textures';
import TypewriterText from '../components/TypewriterText';

const ASSISTANT_LINES = [
  'Your smart assistant, always thinking.',
  'Enhancing your productivity, every day.',
  'Your personal planning partner.',
  'Content generation expert, on demand.',
  'Turning ideas into finished posts.',
  'Your creative co-pilot, always on.',
  'Thinking ahead, so you don’t have to.',
  'Built to understand you, not just prompts.',
  'Your brand voice, amplified.',
  'One assistant. Every platform.',
];

const darkAppearance = {
  variables: {
    colorBackground: 'transparent',
    colorInputBackground: '#182220',
    colorInputText: '#f2f5f2',
    colorText: '#f2f5f2',
    colorTextSecondary: '#9aa5a1',
    colorPrimary: '#4e9389',
    colorNeutral: '#243330',
    borderRadius: '0.625rem',
    fontFamily: 'inherit',
    fontSize: '0.875rem',
  },
  elements: {
    rootBox: 'w-full',
    card: '!bg-transparent !shadow-none !p-0 !border-none',
    header: '!hidden',
    headerTitle: '!hidden',
    headerSubtitle: '!hidden',
    socialButtonsBlockButton:
      '!bg-[#182220] !border !border-[#243330] !text-[#f2f5f2] hover:!bg-[#1e2b28] hover:!border-[#2d3f3b] !rounded-xl !h-10 !text-sm !font-medium !transition-colors !shadow-none',
    socialButtonsBlockButtonText: '!text-[#f2f5f2] !font-medium',
    dividerLine: '!bg-[#243330]',
    dividerText: '!text-[#9aa5a1] !text-xs',
    formFieldLabel: '!text-[#9aa5a1] !text-sm !font-medium',
    formFieldInput:
      '!bg-[#182220] !border !border-[#243330] !text-[#f2f5f2] !rounded-xl !h-10 !text-sm placeholder:!text-[#6b7570] focus:!border-[#4e9389] !transition-colors !shadow-none',
    formButtonPrimary:
      '!bg-[#4e9389] hover:!bg-[#5fa79c] !text-white !rounded-lg !h-10 !text-sm !font-semibold !transition-colors !shadow-lg !border-none',
    footerAction: '!hidden',
    footer: '!hidden',
    identityPreviewText: '!text-[#9aa5a1]',
    identityPreviewEditButton: '!text-[#5fa79c]',
    formFieldSuccessText: '!text-[#8ed966]',
    formFieldErrorText: '!text-red-400',
    alert: '!bg-red-950/40 !border !border-red-800/50 !rounded-xl',
    alertText: '!text-red-400',
    formResendCodeLink: '!text-[#5fa79c]',
    otpCodeFieldInput: '!bg-[#182220] !border !border-[#243330] !text-[#f2f5f2] !rounded-xl',
    alternativeMethodsBlockButton: '!text-[#5fa79c]',
  },
};

const lightAppearance = {
  variables: {
    colorBackground: 'transparent',
    colorInputBackground: '#ffffff',
    colorInputText: '#111111',
    colorText: '#111111',
    colorTextSecondary: '#777777',
    colorPrimary: '#3a7a72',
    colorNeutral: '#e1e8e4',
    borderRadius: '0.625rem',
    fontFamily: 'inherit',
    fontSize: '0.875rem',
  },
  elements: {
    rootBox: 'w-full',
    card: '!bg-transparent !shadow-none !p-0 !border-none',
    header: '!hidden',
    headerTitle: '!hidden',
    headerSubtitle: '!hidden',
    socialButtonsBlockButton:
      '!bg-white !border !border-[#e1e8e4] !text-[#111111] hover:!bg-[#f1f5f1] hover:!border-[#a0a0a0] !rounded-xl !h-10 !text-sm !font-medium !transition-colors !shadow-none',
    socialButtonsBlockButtonText: '!text-[#111111] !font-medium',
    dividerLine: '!bg-[#e1e8e4]',
    dividerText: '!text-[#777777] !text-xs',
    formFieldLabel: '!text-[#777777] !text-sm !font-medium',
    formFieldInput:
      '!bg-white !border !border-[#e1e8e4] !text-[#111111] !rounded-xl !h-10 !text-sm placeholder:!text-[#a0a0a0] focus:!border-[#3a7a72] !transition-colors !shadow-none',
    formButtonPrimary:
      '!bg-[#3a7a72] hover:!bg-[#2e6259] !text-white !rounded-lg !h-10 !text-sm !font-semibold !transition-colors !shadow-lg !border-none',
    footerAction: '!hidden',
    footer: '!hidden',
    identityPreviewText: '!text-[#777777]',
    identityPreviewEditButton: '!text-[#3a7a72]',
    formFieldSuccessText: '!text-[#75c94a]',
    formFieldErrorText: '!text-red-600',
    alert: '!bg-red-50 !border !border-red-200 !rounded-xl',
    alertText: '!text-red-600',
    formResendCodeLink: '!text-[#3a7a72]',
    otpCodeFieldInput: '!bg-white !border !border-[#e1e8e4] !text-[#111111] !rounded-xl',
    alternativeMethodsBlockButton: '!text-[#3a7a72]',
  },
};

interface LandingPageProps {
  /** When true the page is shown as-is even if the user is already signed in. */
  noRedirect?: boolean;
}

export default function LandingPage({ noRedirect = false }: LandingPageProps) {
  const { isSignedIn, isLoaded, getToken } = useAuth();
  const navigate = useNavigate();
  const { theme } = useTheme();
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  // True while we are resolving where to send a signed-in user.
  const [redirecting, setRedirecting] = useState(false);

  const clerkAppearance = theme === 'dark' ? darkAppearance : lightAppearance;

  useEffect(() => {
    if (noRedirect || !isLoaded || !isSignedIn) return;

    setRedirecting(true);
    (async () => {
      try {
        const token = await getToken();
        const res = await api.get<TfResponse<Workspace[]>>(
          '/api/workspaces',
          token ?? undefined
        );
        const workspaces = res.data ?? [];
        if (workspaces.length > 0) {
          navigate(`/workspaces/${workspaces[0].slug}`, { replace: true });
        } else {
          navigate('/onboarding', { replace: true });
        }
      } catch {
        navigate('/onboarding', { replace: true });
      }
    })();
  }, [isLoaded, isSignedIn, noRedirect]);

  // Blank loading screen — avoids flashing the sign-in form for returning users
  if (redirecting) {
    return (
      <div className='h-screen bg-surface-white flex items-center justify-center'>
        <div className='animate-spin h-8 w-8 rounded-full border-2 border-brand border-t-transparent' />
      </div>
    );
  }

  return (
    <div
      className='h-screen text-text-primary relative overflow-hidden'
      style={{
        background: 'radial-gradient(140% 130% at 0% 100%, var(--color-glass-a) 0%, var(--color-glass-b) 55%, var(--color-glass-c) 100%)',
      }}
    >
      {/* Frosted-glass grain, tiled over the gradient */}
      <div
        className='absolute inset-0 opacity-[0.05] dark:opacity-[0.08] mix-blend-overlay dark:mix-blend-soft-light pointer-events-none'
        style={{ backgroundImage: GRAIN_TEXTURE, backgroundSize: '180px 180px' }}
      />

      <div className='relative h-full flex overflow-hidden'>

      {/* ── Left panel: auth — solid white for maximum readability; the center border is the one constant divider between columns ── */}
      <div className='w-full lg:w-[44%] h-full flex items-center justify-center border-r border-border-soft bg-surface-white overflow-y-auto'>
        <div className='w-full max-w-[360px] px-6 py-16 mx-auto'>

          {/* Logo */}
          <div className='mb-10'>
            <div className='w-9 h-9 rounded-xl bg-brand flex items-center justify-center'>
              <Zap size={17} className='text-on-brand' />
            </div>
          </div>

          {/* Heading */}
          <div className='mb-7'>
            <h1 className='text-heading text-text-primary mb-1'>
              {mode === 'sign-in' ? 'Welcome back' : 'Create your account'}
            </h1>
            <p className='text-message text-text-secondary'>
              {mode === 'sign-in'
                ? 'Sign in to continue building your content engine.'
                : 'Start turning ideas into published content today.'}
            </p>
          </div>

          {/* Clerk inline form — only ONE mounted at a time */}
          {mode === 'sign-in' ? (
            <SignIn
              routing='hash'
              signUpUrl='/#sign-up'
              appearance={clerkAppearance}
            />
          ) : (
            <SignUp
              routing='hash'
              signInUrl='/#sign-in'
              appearance={clerkAppearance}
            />
          )}

          {/* Toggle */}
          <p className='mt-6 text-message text-text-secondary text-center'>
            {mode === 'sign-in' ? (
              <>
                Don't have an account?{' '}
                <button
                  onClick={() => setMode('sign-up')}
                  className='text-text-primary hover:text-brand font-medium underline underline-offset-2 transition-colors'
                >
                  Sign up
                </button>
              </>
            ) : (
              <>
                Already have an account?{' '}
                <button
                  onClick={() => setMode('sign-in')}
                  className='text-text-primary hover:text-brand font-medium underline underline-offset-2 transition-colors'
                >
                  Sign in
                </button>
              </>
            )}
          </p>

          {/* Public links */}
          <div className='mt-8 pt-6 border-t border-border-soft flex items-center justify-center gap-4'>
            <Link
              to='/privacy'
              className='text-meta text-text-muted hover:text-text-secondary transition-colors'
            >
              Privacy Policy
            </Link>
            <span className='text-text-muted text-meta'>·</span>
            <Link
              to='/terms'
              className='text-meta text-text-muted hover:text-text-secondary transition-colors'
            >
              Terms of Service
            </Link>
          </div>
        </div>
      </div>

      {/* ── Right panel: app info — sits on the shared page-wide glass gradient ── */}
      <div className='hidden lg:flex flex-1 h-full items-center justify-center overflow-hidden relative'>
        <div className='relative z-10 w-full max-w-5xl px-8 xl:px-10'>
          {/* Headline */}
          <h2 className='text-4xl xl:text-5xl font-semibold leading-[1.15] tracking-tight mb-5 text-text-primary max-w-xl'>
            Your personal AI assistant,
            <br />
            built around <span className='text-brand font-bold'>you</span>.
          </h2>

          <div className='min-h-[3.5rem] mb-10 max-w-xl'>
            <TypewriterText
              lines={ASSISTANT_LINES}
              className='text-lg xl:text-xl text-brand font-medium leading-relaxed'
            />
          </div>

          {/* Process steps — static, self-explanatory cards, strung together by an
              always-on animated wire (no hover interaction). */}
          <div className='relative pt-8'>
            <svg
              className='absolute left-0 right-0 top-0 w-full h-16 pointer-events-none'
              viewBox='0 0 1000 100'
              preserveAspectRatio='none'
              fill='none'
              aria-hidden='true'
            >
              <defs>
                <linearGradient id='stepWireGradient' x1='0' y1='0' x2='1' y2='0'>
                  <stop offset='0%' stopColor='var(--color-brand)' stopOpacity='0' />
                  <stop offset='50%' stopColor='var(--color-brand)' stopOpacity='0.35' />
                  <stop offset='100%' stopColor='var(--color-brand)' stopOpacity='0' />
                </linearGradient>
              </defs>
              <line x1='90' y1='55' x2='910' y2='55' stroke='url(#stepWireGradient)' strokeWidth='1.5' />
              <circle cx='90' cy='55' r='3' fill='var(--color-brand)' fillOpacity='0.45' className='animate-pulse' />
              <circle cx='500' cy='55' r='3' fill='var(--color-brand)' fillOpacity='0.45' className='animate-pulse' style={{ animationDelay: '0.6s' }} />
              <circle cx='910' cy='55' r='3' fill='var(--color-brand)' fillOpacity='0.45' className='animate-pulse' style={{ animationDelay: '1.2s' }} />
            </svg>

            <div className='relative grid grid-cols-1 sm:grid-cols-3 gap-6 items-stretch'>

            {/* 1 — Strategize & Plan: a mini flow of idea → goal → plan */}
            <div className='relative bg-surface-white rounded-3xl p-7 text-left border border-border-soft/70 shadow-[0_10px_30px_rgba(0,0,0,0.06)]'>
              <div className='flex items-center gap-2.5 h-11 mb-5'>
                <div className='w-11 h-11 rounded-full bg-brand/10 flex items-center justify-center flex-shrink-0'>
                  <MessageSquare size={18} strokeWidth={1.8} className='text-brand' />
                </div>
                <div className='w-6 h-[2px] bg-brand/30 rounded-full flex-shrink-0' />
                <div className='w-11 h-11 rounded-full bg-brand/10 flex items-center justify-center flex-shrink-0'>
                  <Target size={18} strokeWidth={1.8} className='text-brand' />
                </div>
                <div className='w-6 h-[2px] bg-brand/30 rounded-full flex-shrink-0' />
                <div className='w-11 h-11 rounded-full bg-brand/10 flex items-center justify-center flex-shrink-0'>
                  <ClipboardCheck size={18} strokeWidth={1.8} className='text-brand' />
                </div>
              </div>
              <p className='text-heading text-text-primary mb-1.5'>Strategize &amp; Plan</p>
              <p className='text-message text-text-secondary leading-relaxed'>
                Chat with AI to shape your idea into a clear content strategy.
              </p>
              <p className='text-meta text-brand font-medium leading-relaxed mt-2.5'>
                Answer a few quick questions — AI turns your idea into a full plan in seconds.
              </p>
            </div>

            {/* 2 — Generate Content: a fanned hand of Text / Image / Video tiles */}
            <div className='relative bg-surface-white rounded-3xl p-7 text-left border border-border-soft/70 shadow-[0_10px_30px_rgba(0,0,0,0.06)]'>
              <div className='relative h-11 w-24 mb-5'>
                <div className='absolute left-0 top-1 w-11 h-11 rounded-xl bg-brand/10 border border-brand/15 flex items-center justify-center rotate-[-8deg]'>
                  <Type size={16} strokeWidth={1.8} className='text-brand' />
                </div>
                <div className='absolute left-6 top-0 w-11 h-11 rounded-xl bg-brand/15 border border-brand/20 flex items-center justify-center z-10'>
                  <ImageIcon size={16} strokeWidth={1.8} className='text-brand' />
                </div>
                <div className='absolute left-12 top-1 w-11 h-11 rounded-xl bg-brand/10 border border-brand/15 flex items-center justify-center rotate-[8deg]'>
                  <Video size={16} strokeWidth={1.8} className='text-brand' />
                </div>
              </div>
              <p className='text-heading text-text-primary mb-1.5'>Generate Content</p>
              <p className='text-message text-text-secondary leading-relaxed'>
                Produce captions, on-brand images, and full video scripts.
              </p>
              <p className='text-meta text-brand font-medium leading-relaxed mt-2.5'>
                One prompt, three formats — text, image, and video, all matched to your brand.
              </p>
            </div>

            {/* 3 — Integrate & Publish: content landing on a phone, ready to be loved */}
            <div className='relative bg-surface-white rounded-3xl p-7 text-left border border-border-soft/70 shadow-[0_10px_30px_rgba(0,0,0,0.06)]'>
              <div className='relative h-11 mb-5'>
                <div className='w-11 h-11 rounded-2xl bg-brand/10 border border-brand/15 flex items-center justify-center'>
                  <Smartphone size={18} strokeWidth={1.8} className='text-brand' />
                </div>
                <Heart size={12} strokeWidth={0} className='absolute -top-1 left-8 text-brand fill-brand' />
              </div>
              <p className='text-heading text-text-primary mb-1.5'>Integrate &amp; Publish</p>
              <p className='text-message text-text-secondary leading-relaxed'>
                Connect Instagram and TikTok, publish with a single click.
              </p>
              <p className='text-meta text-brand font-medium leading-relaxed mt-2.5'>
                No more app-switching — your content goes live right where your people are waiting.
              </p>
            </div>

            </div>
          </div>
        </div>
      </div>

      </div>
    </div>
  );
}
