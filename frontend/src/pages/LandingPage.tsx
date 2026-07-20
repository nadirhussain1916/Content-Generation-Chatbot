import { SignInButton, SignUpButton, SignedIn, SignedOut, UserButton } from '@clerk/clerk-react';
import { useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { Zap, Image, Video, Share2, MessageSquare, Sparkles } from 'lucide-react';

export default function LandingPage() {
  const { isSignedIn, isLoaded } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (isLoaded && isSignedIn) {
      navigate('/onboarding');
    }
  }, [isLoaded, isSignedIn]);

  return (
    <div className='min-h-screen bg-gray-950 text-white'>
      {/* Nav */}
      <nav className='flex items-center justify-between px-6 py-4 border-b border-gray-800'>
        <div className='flex items-center gap-2'>
          <div className='w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center'>
            <Zap size={16} className='text-white' />
          </div>
          <span className='font-semibold text-lg'>CreatorOS</span>
        </div>
        <div className='flex items-center gap-3'>
          <SignedOut>
            <SignInButton mode='modal'>
              <button className='text-sm text-gray-400 hover:text-white transition-colors px-3 py-1.5'>
                Sign in
              </button>
            </SignInButton>
            <SignUpButton mode='modal'>
              <button className='text-sm bg-violet-600 hover:bg-violet-500 transition-colors px-4 py-1.5 rounded-lg font-medium'>
                Get started free
              </button>
            </SignUpButton>
          </SignedOut>
          <SignedIn>
            <UserButton />
          </SignedIn>
        </div>
      </nav>

      {/* Hero */}
      <div className='max-w-4xl mx-auto px-6 pt-24 pb-20 text-center'>
        <div className='inline-flex items-center gap-2 bg-violet-900/30 border border-violet-700/50 text-violet-400 text-sm px-3 py-1 rounded-full mb-6'>
          <Sparkles size={12} />
          AI-powered content creation
        </div>
        <h1 className='text-5xl sm:text-6xl font-bold tracking-tight mb-6 bg-gradient-to-br from-white to-gray-400 bg-clip-text text-transparent'>
          Chat your way to
          <br />
          viral content
        </h1>
        <p className='text-xl text-gray-400 mb-10 max-w-2xl mx-auto leading-relaxed'>
          Describe your idea in a chat. CreatorOS generates captions, images, and video scripts — 
          then publishes directly to Instagram and TikTok in one click.
        </p>
        <SignUpButton mode='modal'>
          <button className='inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-500 transition-colors px-8 py-3.5 rounded-xl font-semibold text-lg'>
            Start creating for free
            <Zap size={18} />
          </button>
        </SignUpButton>
      </div>

      {/* Features */}
      <div className='max-w-5xl mx-auto px-6 pb-24'>
        <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4'>
          {[
            { icon: MessageSquare, title: 'Chat-based workflow', desc: 'Just talk to the AI. Describe your idea, refine it through conversation.' },
            { icon: Image, title: 'AI image generation', desc: 'DALL-E 3 creates stunning visuals from your approved content automatically.' },
            { icon: Video, title: 'Video scripts', desc: 'Get full scripts, scene breakdowns, and voiceover notes for Reels & TikToks.' },
            { icon: Share2, title: 'One-click publishing', desc: 'Publish directly to Instagram and TikTok from the same interface.' },
            { icon: Sparkles, title: 'Smart tone matching', desc: 'Set your brand voice once — AI adapts every piece of content to match.' },
            { icon: Zap, title: 'Multiple workspaces', desc: 'Manage different brands or clients each with their own social accounts.' },
          ].map(({ icon: Icon, title, desc }) => (
            <div key={title} className='bg-gray-900/50 border border-gray-800 rounded-xl p-5'>
              <div className='w-9 h-9 rounded-lg bg-violet-900/50 flex items-center justify-center mb-3'>
                <Icon size={16} className='text-violet-400' />
              </div>
              <h3 className='font-semibold mb-1'>{title}</h3>
              <p className='text-sm text-gray-400 leading-relaxed'>{desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
