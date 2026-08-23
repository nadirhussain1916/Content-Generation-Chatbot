import { useNavigate, useParams, Link } from 'react-router-dom';
import AppShell from '../components/AppShell';
import Sidebar from '../components/Sidebar';
import { cn } from '../lib/utils';
import {
  MessageSquare, ImageIcon, VideoIcon, Zap, DollarSign,
  CheckCircle, AlertCircle, ArrowRight, Sparkles,
} from 'lucide-react';

// ─── Data ─────────────────────────────────────────────────────────────────────

const TEXT_MODELS = [
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    badge: 'Default',
    badgeColor: 'bg-brand/10 text-brand border-brand/20',
    price: '~$2.50 / 1M tokens in · $10 / 1M out',
    priceLevel: 2,
    speed: 'Fast',
    tags: ['Script writing', 'Brand questions', 'Planning'],
    description:
      'OpenAI\'s flagship multimodal model. Handles scripts, brand strategy questions, creative planning, and image analysis equally well. The best all-rounder for daily use.',
    bestFor: [
      'Writing video scripts and captions',
      'Answering complex brand questions',
      'Creative brainstorming',
      'Analysing uploaded reference images',
    ],
    watchOut: [
      'More expensive than mini variants — avoid for simple, repetitive tasks',
    ],
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    badge: 'Budget',
    badgeColor: 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20',
    price: '~$0.15 / 1M tokens in · $0.60 / 1M out',
    priceLevel: 1,
    speed: 'Fastest',
    tags: ['Quick replies', 'Simple tasks', 'High volume'],
    description:
      'A smaller, much cheaper version of GPT-4o. Handles straightforward requests well. Good for fast clarifying questions and simple captions, but misses nuance on complex brand or multi-step tasks.',
    bestFor: [
      'Simple caption variations',
      'Quick question-and-answer turns',
      'High-volume, cost-sensitive workflows',
    ],
    watchOut: [
      'Weaker on long scripts — tends to shorten or oversimplify',
      'Less reliable at following detailed brand voice instructions',
    ],
  },
  {
    id: 'gpt-4.1',
    name: 'GPT-4.1',
    badge: 'Most capable',
    badgeColor: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20',
    price: '~$2.00 / 1M tokens in · $8 / 1M out',
    priceLevel: 2,
    speed: 'Fast',
    tags: ['Complex scripts', 'Long-form content', 'Accuracy'],
    description:
      'OpenAI\'s latest generation model. Better instruction-following and longer context than GPT-4o. Produces the highest-quality scripts, especially for 45–60 second videos where word count precision matters.',
    bestFor: [
      'Long video scripts that must hit a word count target',
      'Detailed brand voice matching',
      'Multi-step creative briefs',
    ],
    watchOut: [
      'Similar price to GPT-4o — reserve for output quality that matters',
    ],
  },
  {
    id: 'gpt-4.1-mini',
    name: 'GPT-4.1 Mini',
    badge: 'Balanced',
    badgeColor: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
    price: '~$0.40 / 1M tokens in · $1.60 / 1M out',
    priceLevel: 1,
    speed: 'Fast',
    tags: ['Everyday use', 'Good quality', 'Affordable'],
    description:
      'The sweet spot between GPT-4.1 capability and mini-level pricing. Follows instructions well and produces solid scripts at roughly the cost of GPT-4o Mini.',
    bestFor: [
      'Everyday script generation where GPT-4o feels like overkill',
      'Workspace setups that run many threads a day',
    ],
    watchOut: [
      'Not as strong as GPT-4.1 on very precise brand voice',
    ],
  },
];

const IMAGE_MODELS = [
  {
    id: 'gpt-image-1',
    name: 'GPT Image 1',
    badge: 'Default · Best quality',
    badgeColor: 'bg-brand/10 text-brand border-brand/20',
    price: '~$0.02–$0.19 per image (size-dependent)',
    priceLevel: 2,
    speed: 'Medium',
    tags: ['Photorealistic', 'Reference support', 'Edits'],
    description:
      'OpenAI\'s newest image model. Supports reference images for in-painting and style matching. Produces the most accurate, controllable results — especially when you attach a reference photo.',
    bestFor: [
      'Hero product shots with a reference image',
      'Consistent brand aesthetic across multiple images',
      'Portrait and lifestyle photography style',
    ],
    watchOut: [
      'Slower than DALL-E 3 — each image takes 10–20s',
      'Costlier at large sizes (1792×1024)',
    ],
  },
  {
    id: 'dall-e-3',
    name: 'DALL-E 3',
    badge: 'Creative',
    badgeColor: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20',
    price: '~$0.04 standard · $0.08 HD per image',
    priceLevel: 1,
    speed: 'Fast',
    tags: ['Illustrations', 'Concepts', 'Inspire mode'],
    description:
      'OpenAI\'s previous-generation image model. Excellent at vivid, stylised, and illustrated content. The "Inspire" mode in this app takes your reference image\'s description and lets DALL-E 3 re-interpret it creatively.',
    bestFor: [
      'Illustrated or artistic content (not photo-realistic)',
      'Concept thumbnails and mood boards',
      'Inspire mode — letting the AI creatively riff on a reference',
    ],
    watchOut: [
      'Cannot use a reference image directly for edits (inspire mode only)',
      'Less precise on product accuracy than GPT Image 1',
    ],
  },
];

const VIDEO_MODELS = [
  {
    id: 'lightricks/ltx-2.3-fast',
    name: 'LTX 2.3 Fast',
    badge: 'Default',
    badgeColor: 'bg-brand/10 text-brand border-brand/20',
    price: '~$0.06 / sec',
    priceLevel: 1,
    speed: 'Fastest',
    maxDuration: 'Up to 20s',
    aspectRatios: ['9:16', '16:9'],
    supportsChain: false,
    supportsReference: true,
    tags: ['Daily drafts', 'Portrait', 'Audio'],
    description:
      'The everyday workhorse. Fast generation at the lowest cost per second in the lineup. Portrait-optimised for Reels and TikTok. Generates audio alongside the video. Single clip per generation (up to 20 s).',
    bestFor: [
      'Testing a prompt before committing to a higher-cost model',
      'Quick social clips where turnaround matters more than polish',
      'First pass before switching to LTX Pro for the final output',
    ],
    watchOut: [
      'Single clip only — cannot extend to 45s+ without switching to LTX Pro',
      'Not the sharpest quality at fine detail',
    ],
  },
  {
    id: 'lightricks/ltx-2.3-pro',
    name: 'LTX 2.3 Pro',
    badge: 'Multi-clip · Recommended',
    badgeColor: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20',
    price: '~$0.08 / sec',
    priceLevel: 2,
    speed: 'Medium',
    maxDuration: '~130s (extend chain)',
    aspectRatios: ['9:16', '16:9'],
    supportsChain: true,
    supportsReference: true,
    tags: ['Full-length videos', 'Extend chain', 'High quality'],
    description:
      'The only model that supports the extend chain — it generates an initial 10s clip then keeps extending it up to 6 times for a single seamless video up to ~130s. Each extend "continues" the scene with strong temporal consistency. Best visual quality in the LTX family.',
    bestFor: [
      '45–60 second brand demo videos (select ~45s in the Length picker)',
      'Scenes that need consistent motion across multiple seconds',
      'Final exports after drafting with LTX Fast',
    ],
    watchOut: [
      'Slower — a ~45s video takes 8–12 minutes end-to-end',
      'Initial clip is always 10s; extend adds 7–20s per step',
    ],
  },
  {
    id: 'bytedance/seedance-2.0',
    name: 'Seedance 2.0',
    badge: '4K quality',
    badgeColor: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
    price: '~$0.18 / sec',
    priceLevel: 3,
    speed: 'Medium',
    maxDuration: 'Up to 15s',
    aspectRatios: ['9:16', '16:9'],
    supportsChain: false,
    supportsReference: true,
    tags: ['4K', 'Cinematic', 'Product close-ups'],
    description:
      'ByteDance\'s flagship video model. The highest-resolution option — produces crisp 4K output that stands out on large screens or when zooming in on product details. Single clip (up to 15s).',
    bestFor: [
      'Hero product shots that need pixel-perfect sharpness',
      'Luxury or premium brand aesthetics',
      'Clips where quality is the only consideration, cost aside',
    ],
    watchOut: [
      '3× the cost of LTX Fast per second — expensive for long or iterative work',
      'Single clip only (15s max)',
    ],
  },
  {
    id: 'bytedance/seedance-2.0-fast',
    name: 'Seedance 2.0 Fast',
    badge: 'Best value',
    badgeColor: 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20',
    price: '~$0.10 / sec',
    priceLevel: 2,
    speed: 'Fast',
    maxDuration: 'Up to 15s',
    aspectRatios: ['9:16', '16:9'],
    supportsChain: false,
    supportsReference: true,
    tags: ['Balanced quality', 'Social clips', 'Affordable'],
    description:
      'A faster, cheaper version of Seedance 2.0. Comparable visual quality to full Seedance for most social content, at roughly half the price. The best single-clip model that isn\'t LTX.',
    bestFor: [
      'Single clips that need to look polished without the Seedance 2.0 price tag',
      'Non-default model to verify (Task 5 in the spec)',
      'Everyday social content at Seedance quality levels',
    ],
    watchOut: [
      'Not 4K — slight quality drop vs full Seedance on very large screens',
    ],
  },
  {
    id: 'wan-video/wan-2.7-t2v',
    name: 'Wan 2.7 T2V',
    badge: 'Text only',
    badgeColor: 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20',
    price: '~$0.09 / sec',
    priceLevel: 1,
    speed: 'Fast',
    maxDuration: 'Up to 15s',
    aspectRatios: ['9:16', '16:9'],
    supportsChain: false,
    supportsReference: false,
    tags: ['Abstract', 'Ambient', 'Environment shots'],
    description:
      'Text-to-video — no reference image input. Strong at environmental, abstract, and ambient footage where you\'re describing a scene rather than a specific person or product.',
    bestFor: [
      'Background scenes, transitions, mood footage',
      'Abstract or nature content without a fixed subject',
      'Situations where you have no reference image',
    ],
    watchOut: [
      'Cannot use reference images at all — any attached reference is ignored',
      'Weaker at consistent human subjects compared to LTX models',
    ],
  },
  {
    id: 'wan-video/wan-2.7-i2v',
    name: 'Wan 2.7 I2V',
    badge: 'Image to video',
    badgeColor: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20',
    price: '~$0.09 / sec',
    priceLevel: 1,
    speed: 'Fast',
    maxDuration: 'Up to 15s',
    aspectRatios: ['9:16', '16:9'],
    supportsChain: false,
    supportsReference: true,
    tags: ['Animate stills', 'Product photos', 'Portraits'],
    description:
      'Image-to-video — takes your reference image as the starting frame and animates it. Great for bringing a product photo or character illustration to life. The opening frame will closely match your reference.',
    bestFor: [
      'Animating an existing product photo or brand image',
      'Creating motion from a still character illustration',
      'Intros where the first frame matters',
    ],
    watchOut: [
      'The reference image strongly locks the opening frame — prompt controls what happens after',
      'Not ideal for scenes with no starting image in mind',
    ],
  },
  {
    id: 'google/veo-2',
    name: 'Google Veo 2',
    badge: 'Avoid as default',
    badgeColor: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20',
    price: '~$0.50 / sec',
    priceLevel: 3,
    speed: 'Fast',
    maxDuration: 'Up to 8s',
    aspectRatios: ['9:16', '16:9'],
    supportsChain: false,
    supportsReference: true,
    tags: ['High quality', 'Expensive', 'Short clips'],
    description:
      'Google DeepMind\'s video model. Produces strong results but at the highest cost in the lineup — roughly 8× LTX Fast per second. Limited to 8s clips. Not the default; use only when other models fall short.',
    bestFor: [
      'High-stakes clips where you\'ve already tried cheaper models and they didn\'t cut it',
      'Short punchy 5–8s clips for a premium campaign',
    ],
    watchOut: [
      '$0.50/sec adds up fast — a single 8s clip costs $4',
      'Capped at 8s — cannot produce anything longer',
      'Not worth the premium for everyday social content',
    ],
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function PriceDots({ level }: { level: number }) {
  return (
    <div className='flex items-center gap-0.5'>
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className={cn(
            'w-2 h-2 rounded-full',
            i <= level ? 'bg-text-primary' : 'bg-border-soft'
          )}
        />
      ))}
    </div>
  );
}

function Tag({ label }: { label: string }) {
  return (
    <span className='px-2 py-0.5 rounded-full bg-surface-card border border-border-soft text-meta text-text-secondary'>
      {label}
    </span>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ModelsPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();

  return (
    <AppShell>
      <Sidebar onNewThread={() => navigate(`/workspaces/${slug}`)} />

      <main className='flex-1 overflow-y-auto bg-surface-chat/40 backdrop-blur-xl'>
        <div className='max-w-3xl mx-auto px-6 py-8'>

          {/* Header */}
          <div className='flex items-center gap-3 mb-2'>
            <div className='w-10 h-10 rounded-xl bg-ink flex items-center justify-center'>
              <Sparkles size={18} className='text-on-ink' />
            </div>
            <div>
              <h1 className='text-heading text-text-primary'>AI Models Guide</h1>
              <p className='text-meta text-text-secondary mt-0.5'>What each model does, what it costs, and when to use it.</p>
            </div>
          </div>

          {/* Quick-pick callout */}
          <div className='mt-6 mb-10 grid grid-cols-1 sm:grid-cols-3 gap-3'>
            {[
              { icon: MessageSquare, label: 'Everyday scripts', model: 'GPT-4o', sub: 'Best all-rounder' },
              { icon: ImageIcon,     label: 'Brand images',     model: 'GPT Image 1', sub: 'With a reference photo' },
              { icon: VideoIcon,     label: '45s demo video',   model: 'LTX 2.3 Pro', sub: 'Use ~45s length option' },
            ].map(({ icon: Icon, label, model, sub }) => (
              <div key={label} className='flex items-center gap-3 bg-surface-card rounded-xl p-3.5 border border-border-soft'>
                <div className='w-8 h-8 rounded-lg bg-brand/10 flex items-center justify-center flex-shrink-0'>
                  <Icon size={15} className='text-brand' />
                </div>
                <div className='min-w-0'>
                  <p className='text-meta text-text-muted'>{label}</p>
                  <p className='text-message font-semibold text-text-primary truncate'>{model}</p>
                  <p className='text-meta text-text-secondary'>{sub}</p>
                </div>
              </div>
            ))}
          </div>

          {/* ── Text models ─────────────────────────────────────────────────── */}
          <Section icon={MessageSquare} title='Text models' subtitle='Used for script writing, captions, brand questions, and planning.' color='text-blue-500'>
            {TEXT_MODELS.map((m) => (
              <ModelCard key={m.id} {...m} type='text' />
            ))}
          </Section>

          {/* ── Image models ────────────────────────────────────────────────── */}
          <Section icon={ImageIcon} title='Image models' subtitle='Used to generate still images from your video scripts.' color='text-orange-500'>
            {IMAGE_MODELS.map((m) => (
              <ModelCard key={m.id} {...m} type='image' />
            ))}
          </Section>

          {/* ── Video models ────────────────────────────────────────────────── */}
          <Section icon={VideoIcon} title='Video models' subtitle='Used to generate video clips from your prompts. Select the model in the Generate Video button.' color='text-purple-500'>
            {VIDEO_MODELS.map((m) => (
              <ModelCard key={m.id} {...m} type='video' />
            ))}
          </Section>

          {/* Cost tip */}
          <div className='mt-8 flex items-start gap-3 bg-amber-50 dark:bg-amber-900/15 border border-amber-300/40 dark:border-amber-700/30 rounded-xl px-4 py-3.5'>
            <DollarSign size={15} className='text-amber-500 mt-0.5 flex-shrink-0' />
            <div>
              <p className='text-message font-medium text-text-primary'>Cost tip</p>
              <p className='text-meta text-text-secondary mt-0.5 leading-relaxed'>
                Draft with <strong>LTX 2.3 Fast</strong> and <strong>GPT-4o</strong> while iterating. Switch to <strong>LTX 2.3 Pro</strong> and <strong>GPT-4.1</strong> only for the final output. This cuts generation cost by 60–70% on a typical 45s video workflow.
              </p>
            </div>
          </div>

        </div>
      </main>
    </AppShell>
  );
}

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({
  icon: Icon, title, subtitle, color, children,
}: {
  icon: React.ElementType; title: string; subtitle: string; color: string;
  children: React.ReactNode;
}) {
  return (
    <div className='mb-10'>
      <div className='flex items-center gap-2 mb-1'>
        <Icon size={16} className={color} />
        <h2 className='text-message font-semibold text-text-primary'>{title}</h2>
      </div>
      <p className='text-meta text-text-secondary mb-4'>{subtitle}</p>
      <div className='space-y-3'>{children}</div>
    </div>
  );
}

// ─── Model card ───────────────────────────────────────────────────────────────

type ModelCardProps = {
  name: string;
  badge: string;
  badgeColor: string;
  price: string;
  priceLevel: number;
  speed: string;
  tags: string[];
  description: string;
  bestFor: string[];
  watchOut: string[];
  type: 'text' | 'image' | 'video';
  // video-only
  maxDuration?: string;
  aspectRatios?: string[];
  supportsChain?: boolean;
  supportsReference?: boolean;
};

function ModelCard(props: ModelCardProps) {
  const {
    name, badge, badgeColor, price, priceLevel, speed, tags,
    description, bestFor, watchOut, type,
    maxDuration, aspectRatios, supportsChain, supportsReference,
  } = props;

  return (
    <div className='bg-surface-card border border-border-soft rounded-xl p-4 space-y-3'>
      {/* Header row */}
      <div className='flex items-start justify-between gap-3'>
        <div className='flex items-center gap-2 flex-wrap'>
          <h3 className='text-message font-semibold text-text-primary'>{name}</h3>
          <span className={cn('px-2 py-0.5 rounded-full text-meta font-medium border', badgeColor)}>
            {badge}
          </span>
        </div>
        <div className='flex items-center gap-2 flex-shrink-0'>
          <PriceDots level={priceLevel} />
          <span className='text-meta text-text-muted'>{speed}</span>
        </div>
      </div>

      {/* Tags */}
      <div className='flex flex-wrap gap-1.5'>
        {tags.map((t) => <Tag key={t} label={t} />)}
      </div>

      {/* Price */}
      <p className='text-meta text-text-secondary font-mono'>{price}</p>

      {/* Video specs */}
      {type === 'video' && (
        <div className='flex flex-wrap gap-x-4 gap-y-1 text-meta text-text-secondary'>
          {maxDuration && <span>⏱ {maxDuration}</span>}
          {aspectRatios && <span>📐 {aspectRatios.join(' · ')}</span>}
          {supportsChain !== undefined && (
            <span className={supportsChain ? 'text-brand' : 'text-text-muted'}>
              {supportsChain ? '✓ Extend chain (multi-clip)' : '✗ Single clip only'}
            </span>
          )}
          {supportsReference !== undefined && (
            <span className={supportsReference ? 'text-text-secondary' : 'text-red-500 dark:text-red-400'}>
              {supportsReference ? '✓ Reference image' : '✗ No reference image'}
            </span>
          )}
        </div>
      )}

      {/* Description */}
      <p className='text-message text-text-secondary leading-relaxed'>{description}</p>

      {/* Best for */}
      <div>
        <p className='text-meta font-semibold text-text-muted uppercase tracking-wide mb-1.5'>Best for</p>
        <ul className='space-y-1'>
          {bestFor.map((item) => (
            <li key={item} className='flex items-start gap-2 text-meta text-text-secondary'>
              <CheckCircle size={12} className='text-brand mt-0.5 flex-shrink-0' />
              {item}
            </li>
          ))}
        </ul>
      </div>

      {/* Watch out */}
      {watchOut.length > 0 && (
        <div>
          <p className='text-meta font-semibold text-text-muted uppercase tracking-wide mb-1.5'>Watch out</p>
          <ul className='space-y-1'>
            {watchOut.map((item) => (
              <li key={item} className='flex items-start gap-2 text-meta text-text-secondary'>
                <AlertCircle size={12} className='text-amber-500 mt-0.5 flex-shrink-0' />
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
