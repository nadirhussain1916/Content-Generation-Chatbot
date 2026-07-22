import { SignIn, SignUp } from '@clerk/clerk-react';
import { useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { Zap, MessageSquare, Image, Video, Share2, Sparkles } from 'lucide-react';

const features = [
  { icon: MessageSquare, text: 'Describe your idea in chat — AI handles the rest.' },
  { icon: Image, text: 'Auto-generate on-brand images with DALL·E 3.' },
  { icon: Video, text: 'Get full video scripts and scene breakdowns.' },
  { icon: Share2, text: 'Publish to Instagram & TikTok in one click.' },
  { icon: Sparkles, text: 'Brand voice training that persists across every thread.' },
];

const clerkAppearance = {
  variables: {
    colorBackground: 'transparent',
    colorInputBackground: '#111827',
    colorInputText: '#ffffff',
    colorText: '#f9fafb',
    colorTextSecondary: '#9ca3af',
    colorPrimary: '#7c3aed',
    colorNeutral: '#374151',
    borderRadius: '0.75rem',
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
      '!bg-gray-900 !border !border-gray-700 !text-white hover:!bg-gray-800 hover:!border-gray-600 !rounded-xl !h-10 !text-sm !font-medium !transition-colors !shadow-none',
    socialButtonsBlockButtonText: '!text-white !font-medium',
    dividerLine: '!bg-gray-800',
    dividerText: '!text-gray-500 !text-xs',
    formFieldLabel: '!text-gray-300 !text-sm !font-medium',
    formFieldInput:
      '!bg-gray-900 !border !border-gray-700 !text-white !rounded-xl !h-10 !text-sm placeholder:!text-gray-600 focus:!border-violet-500 !transition-colors !shadow-none',
    formButtonPrimary:
      '!bg-violet-600 hover:!bg-violet-500 !text-white !rounded-xl !h-10 !text-sm !font-semibold !transition-colors !shadow-lg !border-none',
    footerAction: '!hidden',
    footer: '!hidden',
    identityPreviewText: '!text-gray-300',
    identityPreviewEditButton: '!text-violet-400',
    formFieldSuccessText: '!text-green-400',
    formFieldErrorText: '!text-red-400',
    alert: '!bg-red-950/40 !border !border-red-800/50 !rounded-xl',
    alertText: '!text-red-400',
    formResendCodeLink: '!text-violet-400',
    otpCodeFieldInput: '!bg-gray-900 !border !border-gray-700 !text-white !rounded-xl',
    alternativeMethodsBlockButton: '!text-violet-400',
  },
};

export default function LandingPage() {
  const { isSignedIn, isLoaded } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');

  useEffect(() => {
    if (isLoaded && isSignedIn) navigate('/onboarding');
  }, [isLoaded, isSignedIn]);

  return (
    <div className='h-screen bg-gray-950 text-white flex overflow-hidden'>

      {/* ── Left panel: auth ── */}
      <div className='w-full lg:w-[44%] h-full flex items-center justify-center border-r border-gray-800/60 overflow-y-auto'>
        <div className='w-full max-w-[360px] px-6 py-16 mx-auto'>

          {/* Logo */}
          <div className='flex items-center gap-2.5 mb-10'>
            <div className='w-9 h-9 rounded-xl bg-violet-600 flex items-center justify-center shadow-lg shadow-violet-900/40'>
              <Zap size={17} className='text-white' />
            </div>
            <span className='font-bold text-xl tracking-tight'>CreatorOS</span>
          </div>

          {/* Heading */}
          <div className='mb-7'>
            <h1 className='text-2xl font-semibold text-white mb-1'>
              {mode === 'sign-in' ? 'Welcome back' : 'Create your account'}
            </h1>
            <p className='text-sm text-gray-500'>
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
          <p className='mt-6 text-sm text-gray-500 text-center'>
            {mode === 'sign-in' ? (
              <>
                Don't have an account?{' '}
                <button
                  onClick={() => setMode('sign-up')}
                  className='text-violet-400 hover:text-violet-300 font-medium transition-colors'
                >
                  Sign up
                </button>
              </>
            ) : (
              <>
                Already have an account?{' '}
                <button
                  onClick={() => setMode('sign-in')}
                  className='text-violet-400 hover:text-violet-300 font-medium transition-colors'
                >
                  Sign in
                </button>
              </>
            )}
          </p>
        </div>
      </div>

      {/* ── Right panel: app info ── */}
      <div className='hidden lg:flex flex-1 h-full items-center justify-center overflow-hidden bg-gradient-to-br from-gray-950 via-violet-950/20 to-gray-950 relative'>
        {/* Background glows */}
        <div className='absolute inset-0 pointer-events-none'>
          <div className='absolute top-1/3 left-1/3 w-80 h-80 bg-violet-600/10 rounded-full blur-3xl' />
          <div className='absolute bottom-1/4 right-1/4 w-56 h-56 bg-violet-800/8 rounded-full blur-3xl' />
        </div>

        <div className='relative z-10 w-full max-w-lg px-8 xl:px-10'>
          {/* Badge */}
          <div className='inline-flex items-center gap-2 bg-violet-900/40 border border-violet-700/40 text-violet-300 text-xs px-3 py-1.5 rounded-full mb-8 font-medium'>
            <Sparkles size={11} />
            AI-powered content creation
          </div>

          {/* Headline */}
          <h2 className='text-3xl xl:text-4xl font-bold leading-[1.2] tracking-tight mb-4'>
            Say goodbye to{' '}
            <span className='bg-gradient-to-r from-violet-400 to-violet-200 bg-clip-text text-transparent'>
              manual content.
            </span>
            <br />
            Let{' '}
            <span className='bg-gradient-to-r from-violet-400 to-violet-200 bg-clip-text text-transparent'>
              CreatorOS
            </span>{' '}
            do the heavy lifting.
          </h2>

          <p className='text-gray-400 text-sm leading-relaxed mb-8'>
            Chat with AI to instantly produce captions, images, and video scripts —
            then publish straight to your social accounts.
          </p>

          {/* Feature list */}
          <ul className='space-y-3.5'>
            {features.map(({ icon: Icon, text }) => (
              <li key={text} className='flex items-center gap-3'>
                <div className='w-6 h-6 rounded-md bg-violet-900/60 border border-violet-700/30 flex items-center justify-center flex-shrink-0'>
                  <Icon size={12} className='text-violet-400' />
                </div>
                <span className='text-sm text-gray-300'>{text}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

    </div>
  );
}
