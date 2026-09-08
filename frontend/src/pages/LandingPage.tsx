import { SignIn, SignUp } from '@clerk/clerk-react';
import { useNavigate, Link } from 'react-router-dom';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { api } from '../lib/api';
import type { TfResponse, Workspace } from '../types';
import { MessageSquare, Target, ClipboardCheck, Type, Image as ImageIcon, Video, Heart, Smartphone, WifiOff } from 'lucide-react';
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
    colorInputBackground: '#16323F',
    colorInputText: '#F5F8FB',
    colorText: '#F5F8FB',
    colorTextSecondary: '#8CA0AE',
    colorPrimary: '#2FA7A0',
    colorNeutral: '#35505E',
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
      '!bg-[#16323F] !border !border-[#35505E] !text-[#F5F8FB] hover:!bg-[#1E3A47] hover:!border-[#4A6675] !rounded-xl !h-10 !text-sm !font-medium !transition-colors !shadow-none',
    socialButtonsBlockButtonText: '!text-[#F5F8FB] !font-medium',
    dividerLine: '!bg-[#35505E]',
    dividerText: '!text-[#8CA0AE] !text-xs',
    formFieldLabel: '!text-[#8CA0AE] !text-sm !font-medium',
    formFieldInput:
      '!bg-[#16323F] !border !border-[#35505E] !text-[#F5F8FB] !rounded-xl !h-10 !text-sm placeholder:!text-[#6E8494] focus:!border-[#2FA7A0] !transition-colors !shadow-none',
    formButtonPrimary:
      '!bg-[#2FA7A0] hover:!bg-[#47D1C0] !text-white !rounded-lg !h-10 !text-sm !font-semibold !transition-colors !shadow-lg !border-none',
    footerAction: '!hidden',
    footer: '!hidden',
    identityPreviewText: '!text-[#8CA0AE]',
    identityPreviewEditButton: '!text-[#47D1C0]',
    formFieldSuccessText: '!text-[#8ed966]',
    formFieldErrorText: '!text-red-400',
    alert: '!bg-red-950/40 !border !border-red-800/50 !rounded-xl',
    alertText: '!text-red-400',
    formResendCodeLink: '!text-[#47D1C0]',
    otpCodeFieldInput: '!bg-[#16323F] !border !border-[#35505E] !text-[#F5F8FB] !rounded-xl',
    alternativeMethodsBlockButton: '!text-[#47D1C0]',
  },
};

const lightAppearance = {
  variables: {
    colorBackground: 'transparent',
    colorInputBackground: '#ffffff',
    colorInputText: '#0F253B',
    colorText: '#0F253B',
    colorTextSecondary: '#5F6E82',
    colorPrimary: '#0F766E',
    colorNeutral: '#DCE4EC',
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
      '!bg-white !border !border-[#DCE4EC] !text-[#0F253B] hover:!bg-[#E8EEF3] hover:!border-[#9AA6B4] !rounded-xl !h-10 !text-sm !font-medium !transition-colors !shadow-none',
    socialButtonsBlockButtonText: '!text-[#0F253B] !font-medium',
    dividerLine: '!bg-[#DCE4EC]',
    dividerText: '!text-[#5F6E82] !text-xs',
    formFieldLabel: '!text-[#5F6E82] !text-sm !font-medium',
    formFieldInput:
      '!bg-white !border !border-[#DCE4EC] !text-[#0F253B] !rounded-xl !h-10 !text-sm placeholder:!text-[#9AA6B4] focus:!border-[#0F766E] !transition-colors !shadow-none',
    formButtonPrimary:
      '!bg-[#0F766E] hover:!bg-[#0B5A53] !text-white !rounded-lg !h-10 !text-sm !font-semibold !transition-colors !shadow-lg !border-none',
    footerAction: '!hidden',
    footer: '!hidden',
    identityPreviewText: '!text-[#5F6E82]',
    identityPreviewEditButton: '!text-[#0F766E]',
    formFieldSuccessText: '!text-[#75c94a]',
    formFieldErrorText: '!text-red-600',
    alert: '!bg-red-50 !border !border-red-200 !rounded-xl',
    alertText: '!text-red-600',
    formResendCodeLink: '!text-[#0F766E]',
    otpCodeFieldInput: '!bg-white !border !border-[#DCE4EC] !text-[#0F253B] !rounded-xl',
    alternativeMethodsBlockButton: '!text-[#0F766E]',
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
  // Set when we can't reach / get a valid response from the API. We must NOT
  // fall through to onboarding in this case, otherwise a returning user with
  // existing workspaces would be shown the "set up your first workspace" flow
  // just because the backend was momentarily unreachable.
  const [connectionError, setConnectionError] = useState(false);

  const clerkAppearance = theme === 'dark' ? darkAppearance : lightAppearance;

  const resolveDestination = useCallback(async () => {
    setConnectionError(false);
    setRedirecting(true);
    try {
      const token = await getToken();
      const res = await api.get<TfResponse<Workspace[]>>(
        '/api/workspaces',
        token ?? undefined
      );
      // A reachable backend always returns a well-formed TfResponse. If the
      // request "succeeded" at the fetch level but the payload is malformed or
      // reports failure, treat it as a connection error rather than assuming
      // the user has no workspaces.
      if (!res || res.success !== true || !Array.isArray(res.data)) {
        setConnectionError(true);
        setRedirecting(false);
        return;
      }
      const workspaces = res.data;
      if (workspaces.length > 0) {
        navigate(`/workspaces/${workspaces[0].slug}`, { replace: true });
      } else {
        navigate('/onboarding', { replace: true });
      }
    } catch {
      // Network error / backend down / non-JSON response — surface it instead
      // of silently sending the user into onboarding.
      setConnectionError(true);
      setRedirecting(false);
    }
  }, [getToken, navigate]);

  useEffect(() => {
    if (noRedirect || !isLoaded || !isSignedIn) return;
    void resolveDestination();
  }, [isLoaded, isSignedIn, noRedirect, resolveDestination]);

  // Connection error — show a clear "can't reach the server" screen with a
  // retry, rather than the onboarding flow.
  if (connectionError) {
    return (
      <div className='h-screen bg-surface-white flex items-center justify-center p-6'>
        <div className='w-full max-w-sm text-center'>
          <div className='mx-auto mb-5 w-12 h-12 rounded-2xl bg-red-500/10 flex items-center justify-center'>
            <WifiOff size={22} className='text-red-500' />
          </div>
          <h1 className='text-heading text-text-primary mb-1.5'>Can't reach the server</h1>
          <p className='text-message text-text-secondary mb-6'>
            We couldn't load your workspaces. Check your connection and try again.
          </p>
          <button
            onClick={() => void resolveDestination()}
            className='w-full bg-brand hover:bg-brand-hover transition-colors py-3 rounded-lg font-semibold text-message text-on-brand'
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

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
            <img src='/favicon.png' alt='Logic Enablers' className='w-10 h-10 rounded-xl' />
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
