/**
 * CreatorOS knowledge base — the SINGLE source of truth for what the product can do
 * and how to use it well. It powers two things:
 *   • buildCapabilityMap() — a compact, always-on summary injected into the agent's
 *     system prompt so it can discover + route capabilities with zero extra latency.
 *   • lookupHelp() — deep, on-demand detail returned by the `get_system_help` tool.
 *
 * SCOPE RULE: end-user / creator capabilities ONLY. Never document internal or
 * super-admin surfaces here (there is a guardrail test enforcing this).
 */

/**
 * The canonical set of topic ids. Kept as a literal tuple so it can back a Zod
 * enum on the get_system_help tool (the model must pick a real id, not guess a
 * string). HELP_TOPICS is typed against this, so the two can never drift.
 */
export const HELP_TOPIC_IDS = [
  'overview',
  'drafts',
  'text-mode',
  'chat-models',
  'image-generation',
  'references',
  'video-generation',
  'long-video',
  'ltx-extend',
  'continue-video',
  'combine-clips',
  'characters',
  'brand-context',
  'costs',
  'publishing',
  'generations',
  'troubleshooting',
] as const;

export type HelpTopicId = (typeof HELP_TOPIC_IDS)[number];

export type HelpTopic = {
  id: HelpTopicId;
  title: string;
  keywords: string[];
  summary: string; // one line → feeds the always-on capability map
  detail: string;  // full how-to + best practices → returned by get_system_help
};

export const HELP_TOPICS: HelpTopic[] = [
  {
    id: 'overview',
    title: 'What CreatorOS does',
    keywords: ['overview', 'what', 'help', 'start', 'getting started', 'how', 'capabilities', 'features', 'workflow'],
    summary: 'Chat with the AI to create publish-ready image & video posts for Instagram and TikTok.',
    detail:
      'CreatorOS is an AI content studio. The core loop: (1) describe what you want in chat; (2) the AI asks a couple of ' +
      'quick questions only if needed, then produces a complete, publish-ready DRAFT (image or video prompt + script, plus ' +
      'caption, title, description and hashtags); (3) refine it by chatting; (4) generate the media; (5) review it in the ' +
      'Generations gallery; (6) publish to Instagram or TikTok. You can also just ask for TEXT (a script, hook, outline, or ' +
      'brainstorm) without building a draft. Everything is organized per workspace, and each chat thread keeps its own ' +
      'context, references and draft.',
  },
  {
    id: 'drafts',
    title: 'Creating & refining drafts',
    keywords: ['draft', 'create', 'make', 'post', 'refine', 'edit', 'change', 'update', 'caption', 'hashtags', 'regenerate'],
    summary: 'Ask for a post and the AI builds a full draft; keep chatting to refine any part of it.',
    detail:
      'Ask for an image or video post and the AI creates a draft: the media prompt/script plus content copy, an ' +
      'Instagram-ready caption, a TikTok title & description, and 10–30 hashtags. If key details are missing it asks a ' +
      'short round of chip questions first (max 2 rounds). To refine, just say what to change ("make the caption punchier", ' +
      '"swap the setting to a beach", "add more hashtags") — it updates only that and keeps the rest identical. You can ' +
      'edit the model, size/aspect, and duration on the draft before generating. Best practice: state the goal, audience ' +
      'and vibe up front to skip the questions; refine in small, specific steps.',
  },
  {
    id: 'text-mode',
    title: 'Getting text only (scripts, hooks, ideas)',
    keywords: ['text', 'script', 'outline', 'brainstorm', 'ideas', 'hook', 'caption only', 'just write', 'no draft'],
    summary: 'Ask for content as plain text (script, hooks, outline, brainstorm) without building a draft.',
    detail:
      'You don\'t have to generate media. Ask for the content AS TEXT — "just the script", "write it out", "give me 5 hook ' +
      'options", "an outline", "brainstorm angles" — and the AI replies directly with the full text, no draft or questions. ' +
      'When you like it, say "use this / make it a draft / generate" and it turns that exact text into a draft. Best ' +
      'practice: brainstorm in text first for big or unclear ideas, then convert the winner into a draft.',
  },
  {
    id: 'chat-models',
    title: 'Choosing the chat / writing model',
    keywords: ['chat model', 'text model', 'gpt', 'gpt-4o', 'gpt-4.1', 'mini', 'writing model', 'brain'],
    summary: 'Pick the AI model that powers chat & drafting: GPT-4o (default), 4o mini, GPT-4.1, 4.1 mini.',
    detail:
      'The chat/writing model (the "brain" that plans and writes your drafts) is selectable: GPT-4o (balanced — default), ' +
      'GPT-4o mini (fast & affordable), GPT-4.1 (most capable), GPT-4.1 mini (latest & fast). This only affects the ' +
      'quality/speed of the writing and planning — it is SEPARATE from the image/video generation model. Best practice: ' +
      'default GPT-4o for most work; step up to GPT-4.1 for complex briefs, or a mini model for quick iteration.',
  },
  {
    id: 'image-generation',
    title: 'Image generation',
    keywords: ['image', 'photo', 'picture', 'size', 'aspect', 'square', 'portrait', 'landscape', 'gpt-image'],
    summary: 'Generate images in square, portrait, or landscape sizing for feed, Stories, or YouTube.',
    detail:
      'Images are generated with GPT Image 2 from a detailed prompt the AI writes for you. Sizes: 1024x1024 (square 1:1 — ' +
      'Instagram feed), 1024x1792 (portrait 9:16 — Stories/TikTok/Reels), 1792x1024 (landscape 16:9 — YouTube/Twitter). ' +
      'You can attach up to 4 reference images to guide the result (see the "references" topic for edit vs inspire). Best ' +
      'practice: specify subject, setting, lighting and style and let the AI expand it. Text baked into an image is ' +
      'unreliable — keep words in the caption, not the picture.',
  },
  {
    id: 'references',
    title: 'Reference images (edit vs inspire)',
    keywords: ['reference', 'attach', 'upload', 'edit', 'inspire', 'style', 'product', 'logo', 'image to video', 'i2v', 'start frame'],
    summary: 'Attach images to steer a generation — "edit" reproduces them, "inspire" borrows their style.',
    detail:
      'Attach reference images to a chat message to steer a generation. Two modes: "edit" feeds the reference in as pixels ' +
      'to faithfully reproduce or composite it (use for products, logos, a specific person/scene that must be preserved); ' +
      '"inspire" uses it only as described style/mood/palette guidance. Capacity: image drafts accept up to 4 references; ' +
      'video models accept 1 (used as the START FRAME for image-to-video). Note: Wan 2.7 T2V is text-only and ignores ' +
      'references. Best practice: use "edit" when the exact object matters, "inspire" for a vibe.',
  },
  {
    id: 'video-generation',
    title: 'Video generation & models',
    keywords: ['video', 'clip', 'model', 'duration', 'length', 'seconds', 'veo', 'ltx', 'seedance', 'wan', 'aspect', '4k', 'audio'],
    summary: 'Generate short video clips (portrait or landscape) with a choice of AI models.',
    detail:
      'The AI writes a director-ready video prompt and script, then generates a clip. Every model supports both 9:16 ' +
      '(Reels/Shorts/TikTok) and 16:9 (YouTube). Models (approx cost per second, valid lengths):\n' +
      '• LTX 2.3 Fast — portrait, audio, 6–20s, ~$0.06/s. DEFAULT: cheap and flexible.\n' +
      '• LTX 2.3 Pro — portrait, audio, higher quality, 6–10s, ~$0.08/s. Also supports native "extend" to ~70s (see ltx-extend).\n' +
      '• Seedance 2.0 — portrait, audio, up to 4K, 5–15s, ~$0.18/s. Best fidelity/resolution.\n' +
      '• Seedance 2.0 Fast — same as above but faster/cheaper, ~$0.10/s.\n' +
      '• Wan 2.7 T2V — text-only (ignores references), audio, 2–15s, ~$0.09/s.\n' +
      '• Wan 2.7 I2V — image-to-video, REQUIRES a start image, audio, 2–15s, ~$0.09/s.\n' +
      '• Google Veo 2 — premium, portrait & landscape, 5–8s, ~$0.50/s.\n' +
      'Best practice: stay on LTX Fast unless you need 4K (Seedance), a specific look (Veo), or image-to-video (Wan I2V / ' +
      'any non-T2V model with a start frame). Requested durations snap to the nearest value the model allows.',
  },
  {
    id: 'long-video',
    title: 'Long videos (beyond one clip)',
    keywords: ['long', 'longer', 'minute', '2 minute', 'stitch', 'concat', 'chain', 'chunks', 'montage', 'seamless', 'fast cuts'],
    summary: 'Make videos longer than one clip by generating multiple chunks and stitching them.',
    detail:
      'Ask for a length longer than one clip ("make it 45s", "a 2-minute video") and the AI plans multiple chunks that are ' +
      'stitched together. Two modes: "Fast cuts" (concat, default) renders chunks in PARALLEL — quick, but with hard cuts ' +
      'between them (great for montages/b-roll, works with every model); "Seamless" (chain) feeds each chunk\'s last frame ' +
      'into the next (image-to-video) — smoother but slower, for image-to-video-capable models (everything except Wan T2V). ' +
      'The mode auto-corrects to what the model supports (text-only → fast cuts; Wan I2V → seamless). Chunk count presets ' +
      'run 2–8 in the UI and up to 20 total. Reachable length ≈ the model\'s max clip × chunks, so a longer-clip model (LTX ' +
      'Fast 20s, Seedance 15s) hits a target in far fewer chunks than an 8s model. Cost ≈ single-clip cost × chunk count. ' +
      'Best practice: prefer fewer, longer chunks; use Fast cuts unless you specifically need seamless motion.',
  },
  {
    id: 'ltx-extend',
    title: 'LTX Pro native extend (up to ~70s)',
    keywords: ['ltx', 'pro', 'extend', 'native', '70s', 'chain', 'reels length', 'long single'],
    summary: 'LTX 2.3 Pro can natively extend one clip to ~70s — smoother than stitching, Pro-only.',
    detail:
      'Separate from the multi-model stitching path, LTX 2.3 Pro has a NATIVE extend: it starts at 10s and adds up to ' +
      '6×10s extensions for ~30s / 40s / 50s / 60s / ~70s total, each continuing from the previous segment. It is smoother ' +
      'than a stitched concat because it stays in one model, but it is LTX Pro only and slower/costlier the longer you go. ' +
      'Best practice: pick native extend when you want one continuous LTX Pro shot up to ~70s; use long-video stitching ' +
      'when you want other models, 4K, or lengths beyond that.',
  },
  {
    id: 'continue-video',
    title: 'Continue / extend an existing video',
    keywords: ['continue', 'extend', 'next part', 'keep going', 'add a part', 'sequel', 'longer version', 'with agent'],
    summary: 'Take a finished video and generate its next part(s), stitched onto the original.',
    detail:
      'Open the Generations gallery, find the video, and choose "Continue". Two ways: "With Agent" opens a fresh chat where ' +
      'the AI plans the continuation as a storyboard (one prompt per new part) seeded from where your clip ends — you just ' +
      'guide the direction; "Manual" lets you enter the next prompt(s) yourself. The system extracts the last frame of the ' +
      'source, generates the new part(s) via image-to-video, and stitches the original + new parts into one longer video. ' +
      'Best practice: use "With Agent" and give a one-line direction ("continue into a night scene") — you do NOT need to ' +
      're-describe the original video; the AI already has its ending frame and original prompt.',
  },
  {
    id: 'combine-clips',
    title: 'Combine existing clips',
    keywords: ['combine', 'merge', 'join', 'stitch clips', 'multiple clips', 'existing clips'],
    summary: 'Merge several clips you already generated into one video, in the order you pick.',
    detail:
      'To join clips you already have, open the Generations gallery, turn on "Combine" (it filters to videos), select at ' +
      'least 2 clips IN THE ORDER you want them, then press Combine. Clips are normalized (resolution, frame rate, audio) ' +
      'so mismatched sources join cleanly. This is a merge only — no new content is generated, and it is cheap. Best ' +
      'practice: pick clips with a similar look; if you want seamless motion between them, generate them with "Seamless" ' +
      '(chain) from the start or use Continue instead.',
  },
  {
    id: 'characters',
    title: 'Locked characters',
    keywords: ['character', 'consistent', 'same person', 'mascot', 'appearance', 'identity', 'include character'],
    summary: 'Keep a consistent on-screen character across generations with a locked name + appearance.',
    detail:
      'A workspace can define a locked character (name + appearance, with reference photos). For each draft you decide ' +
      'whether to feature them via the "include character" choice; when on, the system injects the exact appearance and ' +
      'reference photos so the identity stays consistent across images and videos. When off, the character is ignored. ' +
      'This choice can\'t be flipped on a finished draft — the AI regenerates the draft to change it. Best practice: set ' +
      'the character up once in workspace settings, then tell the AI up front whether a given post should feature them.',
  },
  {
    id: 'brand-context',
    title: 'Brand context & defaults',
    keywords: ['brand', 'voice', 'audience', 'tone', 'settings', 'defaults', 'instructions', 'workspace'],
    summary: 'Set brand voice, audience and defaults so every draft matches your brand automatically.',
    detail:
      'In Workspace Settings → Brand Context you can set brand name, description, voice, target audience, default image ' +
      'size / video dimensions / clip length / target length, and custom agent instructions the AI always follows. Once ' +
      'set, the AI applies them automatically — fewer clarifying questions and on-brand copy every time. Best practice: ' +
      'fill these in early; use custom instructions for hard rules ("always mention the product name", "never use emojis", ' +
      '"always end with a question").',
  },
  {
    id: 'costs',
    title: 'Costs & keeping them down',
    keywords: ['cost', 'price', 'pricing', 'expensive', 'cheap', 'budget', 'per second', 'credits', 'spend'],
    summary: 'Video cost ≈ per-second rate × length × chunks; images are flat. Cheaper models & fewer chunks save money.',
    detail:
      'Approximate video cost = the model\'s per-second rate × clip length, multiplied by the number of chunks for a long ' +
      'video. Per-second rates: LTX Fast ~$0.06, LTX Pro ~$0.08, Wan 2.7 ~$0.09, Seedance Fast ~$0.10, Seedance 2.0 ~$0.18, ' +
      'Veo 2 ~$0.50. Images (GPT Image 2) are a flat per-image cost. To keep spend down: prefer LTX Fast; use "Fast cuts" ' +
      'over "Seamless"; use fewer, longer chunks; and reserve premium models (Veo, Seedance) for hero shots. Combining ' +
      'existing clips is cheap (no new generation), and retrying a failed stitch reuses the parts that already succeeded so ' +
      'you don\'t pay to redo them.',
  },
  {
    id: 'publishing',
    title: 'Publishing to Instagram & TikTok',
    keywords: ['publish', 'post', 'instagram', 'tiktok', 'connect', 'account', 'schedule', 'share'],
    summary: 'Connect Instagram/TikTok and publish a finished asset straight from CreatorOS.',
    detail:
      'Connect your Instagram and/or TikTok account, then publish a finished image or video directly, reusing the caption / ' +
      'title / description and hashtags from the draft. You can check publish status per asset. Best practice: review the ' +
      'generated media, trim hashtags to the most relevant, and confirm the target account is connected before publishing.',
  },
  {
    id: 'generations',
    title: 'Generations gallery & status',
    keywords: ['generations', 'gallery', 'status', 'ready', 'failed', 'progress', 'download', 'history', 'retry'],
    summary: 'See every generation with its status (generating / ready / failed), download, publish, or retry it.',
    detail:
      'The Generations gallery lists everything you have made with live status: generating (with per-part progress for long ' +
      'videos), ready, or failed (with the reason). From here you can preview, download, publish, retry a failed stitch, or ' +
      'start a Continue/Combine. In chat you can also just ask "is my video ready?", "did anything fail?", or "how many ' +
      'parts are done?" and the AI checks for you. Best practice: for long/continued videos, watch the per-part progress so ' +
      'you can spot a failing part early.',
  },
  {
    id: 'troubleshooting',
    title: 'When a generation fails',
    keywords: ['fail', 'failed', 'error', 'stuck', 'not working', 'retry', 'recover', 'broken', 'why'],
    summary: 'See the failure reason in the gallery; retry failed stitches (succeeded parts are reused) or regenerate.',
    detail:
      'A failed generation shows its reason in the Generations gallery, and in chat you can ask "why did it fail?" / "which ' +
      'part failed?" to get the per-part breakdown. Fixes: for a failed long/continued/combined video, use Retry — it ' +
      're-runs only the failed parts and reuses the ones that already succeeded (so you don\'t pay to redo them). For a ' +
      'single clip, regenerate, and if it keeps failing, simplify the prompt, shorten the duration, or switch models. If a ' +
      'video model rejects a start frame, make sure you picked an image-to-video-capable model. Best practice: fix the ' +
      'earliest failing part first, since later parts may depend on it.',
  },
];

// ─── Derived capability map (always-on, injected into the system prompt) ───────

/** One compact line per topic. Derived from HELP_TOPICS so it can never drift. */
export function buildCapabilityMap(): string {
  return HELP_TOPICS.map((t) => `• ${t.title}: ${t.summary}`).join('\n');
}

// ─── On-demand lookup (backs the get_system_help tool) ─────────────────────────

function topicIndex(): string {
  return HELP_TOPICS.map((t) => `- ${t.id}: ${t.title}`).join('\n');
}

function formatTopic(t: HelpTopic): string {
  return `## ${t.title}\n${t.detail}`;
}

function scoreTopic(t: HelpTopic, terms: string[]): number {
  const title = t.title.toLowerCase();
  const summary = t.summary.toLowerCase();
  const detail = t.detail.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (t.keywords.some((k) => k === term)) score += 3;
    else if (t.keywords.some((k) => k.includes(term))) score += 2;
    if (title.includes(term)) score += 2;
    if (summary.includes(term) || detail.includes(term)) score += 1;
  }
  return score;
}

/**
 * Deterministic, no-API lookup. Prefers an exact topic id, else ranks topics by
 * keyword/title/summary/detail matches and returns the top one or two topics' detail.
 * On no input or no match, returns the topic index so the agent can pick.
 */
export function lookupHelp(topic?: string, query?: string): string {
  const needle = (topic ?? query ?? '').toLowerCase().trim();
  if (!needle) return `Available help topics:\n${topicIndex()}`;

  const exact = HELP_TOPICS.find((t) => t.id === needle);
  if (exact) return formatTopic(exact);

  const terms = needle.split(/\s+/).filter(Boolean);
  const ranked = HELP_TOPICS
    .map((t) => ({ t, score: scoreTopic(t, terms) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (ranked.length === 0) {
    return `No help topic matched "${needle}". Available topics:\n${topicIndex()}`;
  }
  return ranked.slice(0, 2).map((x) => formatTopic(x.t)).join('\n\n');
}
