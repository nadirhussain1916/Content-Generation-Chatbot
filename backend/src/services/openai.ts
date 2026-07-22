import { createOpenAI } from '@ai-sdk/openai';
import { generateText, Output } from 'ai';
import { z } from 'zod';
import { PLANNER_PROMPT, IMAGE_DRAFT_PROMPT, VIDEO_SCRIPT_PROMPT, FOLLOWUP_PROMPT, type WorkspaceBrand } from './prompts';
import type { ImagePostPackage, VideoPostPackage } from '../types';

// ─── Schemas ──────────────────────────────────────────────────────────────────

const QuestionSchema = z.object({
  id: z.string().describe('Unique identifier for this question, e.g. "angle", "audience", "format"'),
  text: z.string().describe('The question label shown above the chips'),
  options: z.array(z.object({ id: z.string(), label: z.string() })).describe('2-5 selectable chips for this question'),
  allowMultiple: z.boolean().describe('True if the user should be able to select more than one option — use for questions like "target audience" or "platforms". False for single-choice decisions like "image vs video".'),
});

const PlannerSchema = z.object({
  mode: z
    .enum(['plan', 'chat'])
    .describe('"plan" = user wants to create content | "chat" = user is just greeting or conversing, not asking for content'),
  reply: z.string().describe('Your response. For "chat" mode: a warm, brief reply. For "plan" mode: short intro before questions, or a summary of what you will create.'),
  ready: z.boolean().describe('plan mode only — true when you have enough info to generate content. Always false when mode is "chat".'),
  mediaType: z.enum(['image', 'video']).nullable().describe('Required when ready is true, null otherwise'),
  questions: z
    .array(QuestionSchema)
    .nullable()
    .describe('plan mode only — chip question groups. Set to null when ready is true or when mode is "chat".'),
});

const VideoSceneSchema = z.object({
  description: z.string(),
  voiceover: z.string(),
  duration: z.string(),
});

const VideoScriptSchema = z.object({
  hook: z.string(),
  body: z.string(),
  callToAction: z.string(),
  estimatedDuration: z.string(),
  voiceoverNotes: z.string(),
  scenes: z.array(VideoSceneSchema),
});

const ImagePostPackageSchema = z.object({
  content: z.string(),
  caption: z.string().max(2200),
  title: z.string().max(150),
  description: z.string().max(2200),
  hashtags: z.array(z.string()).max(30),
  imagePrompt: z.string().describe('Detailed image generation prompt — no text overlays, no aspect ratio mentions'),
  imageSize: z.enum(['1024x1024', '1024x1792', '1792x1024']).describe('1024x1024=square/Instagram feed | 1024x1792=portrait 9:16/Stories/TikTok | 1792x1024=landscape 16:9/YouTube/Twitter'),
  imageStyle: z.string(),
  tone: z.string(),
  suggestedPlatforms: z.array(z.enum(['instagram', 'tiktok'])),
});

const VideoPostPackageSchema = z.object({
  content: z.string(),
  caption: z.string().max(2200),
  title: z.string().max(150),
  description: z.string().max(2200),
  hashtags: z.array(z.string()).max(30),
  script: VideoScriptSchema,
  videoPrompt: z.string().describe('Replicate/Runway visual prompt'),
  tone: z.string(),
  suggestedPlatforms: z.array(z.enum(['instagram', 'tiktok'])),
});

// ─── Types ────────────────────────────────────────────────────────────────────

export type PlannerQuestion = {
  id: string;
  text: string;
  options: { id: string; label: string }[];
  allowMultiple: boolean;
};

export type PlannerResult =
  | { mode: 'chat'; reply: string; ready: false; mediaType: null; questions: null }
  | { mode: 'plan'; reply: string; ready: boolean; mediaType: 'image' | 'video' | null; questions: PlannerQuestion[] | null };

// ─── Message helpers ──────────────────────────────────────────────────────────

function buildHistory(messages: { role: 'user' | 'assistant'; content: string }[]) {
  return messages.map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));
}

// ─── Planning phase ───────────────────────────────────────────────────────────

export async function runPlanner(params: {
  apiKey: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  tone: string;
  captionStyle: string;
  brand?: WorkspaceBrand;
  textModel?: string;
}): Promise<PlannerResult> {
  const openai = createOpenAI({ apiKey: params.apiKey });

  const { output: object } = await generateText({
    model: openai.chat(params.textModel ?? 'gpt-4o'),
    output: Output.object({ schema: PlannerSchema }),
    system: PLANNER_PROMPT(params.tone, params.captionStyle, params.brand),
    messages: buildHistory(params.messages),
  });

  return object! as PlannerResult;
}

// ─── Draft generation ─────────────────────────────────────────────────────────

export async function generateImageDraft(params: {
  apiKey: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  tone: string;
  captionStyle: string;
  brand?: WorkspaceBrand;
  textModel?: string;
}): Promise<ImagePostPackage> {
  const openai = createOpenAI({ apiKey: params.apiKey });

  const { output: object } = await generateText({
    model: openai.chat(params.textModel ?? 'gpt-4o'),
    output: Output.object({ schema: ImagePostPackageSchema }),
    system: IMAGE_DRAFT_PROMPT(params.tone, params.captionStyle, params.brand),
    messages: buildHistory(params.messages),
  });

  return object! as ImagePostPackage;
}

export async function generateVideoScript(params: {
  apiKey: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  tone: string;
  captionStyle: string;
  brand?: WorkspaceBrand;
  textModel?: string;
}): Promise<VideoPostPackage> {
  const openai = createOpenAI({ apiKey: params.apiKey });

  const { output: object } = await generateText({
    model: openai.chat(params.textModel ?? 'gpt-4o'),
    output: Output.object({ schema: VideoPostPackageSchema }),
    system: VIDEO_SCRIPT_PROMPT(params.tone, params.captionStyle, params.brand),
    messages: buildHistory(params.messages),
  });

  return object! as VideoPostPackage;
}

// ─── Followup / refinement ────────────────────────────────────────────────────

const FollowupMode = z.enum(['refined', 'needs_context', 'chat']).describe(
  '"refined" = update the post package | "needs_context" = topic too vague, ask questions | "chat" = user is just chatting, no content needed'
);

const ImageFollowupSchema = z.object({
  mode: FollowupMode,
  reply: z.string().describe('Message to the user'),
  questions: z.array(QuestionSchema).nullable().describe('Chip questions — required when mode is needs_context, null otherwise'),
  package: ImagePostPackageSchema.nullable().describe('Updated image post package — required when mode is refined, null otherwise'),
});

const VideoFollowupSchema = z.object({
  mode: FollowupMode,
  reply: z.string().describe('Message to the user'),
  questions: z.array(QuestionSchema).nullable().describe('Chip questions — required when mode is needs_context, null otherwise'),
  package: VideoPostPackageSchema.nullable().describe('Updated video post package — required when mode is refined, null otherwise'),
});

export type FollowupResult =
  | { mode: 'refined'; reply: string; package: ImagePostPackage | VideoPostPackage }
  | { mode: 'needs_context'; reply: string; questions: PlannerQuestion[] }
  | { mode: 'chat'; reply: string };

export async function runFollowup(params: {
  apiKey: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  mediaType: 'image' | 'video';
  tone: string;
  captionStyle: string;
  brand?: WorkspaceBrand;
  textModel?: string;
}): Promise<FollowupResult> {
  const openai = createOpenAI({ apiKey: params.apiKey });
  const model = openai.chat(params.textModel ?? 'gpt-4o');

  if (params.mediaType === 'image') {
    const { output } = await generateText({
      model,
      output: Output.object({ schema: ImageFollowupSchema }),
      system: FOLLOWUP_PROMPT(params.tone, params.brand),
      messages: buildHistory(params.messages),
    });
    const result = output!;
    if (result.mode === 'chat') return { mode: 'chat', reply: result.reply };
    if (result.mode === 'needs_context') return { mode: 'needs_context', reply: result.reply, questions: result.questions ?? [] };
    return { mode: 'refined', reply: result.reply, package: result.package! as ImagePostPackage };
  } else {
    const { output } = await generateText({
      model,
      output: Output.object({ schema: VideoFollowupSchema }),
      system: FOLLOWUP_PROMPT(params.tone, params.brand),
      messages: buildHistory(params.messages),
    });
    const result = output!;
    if (result.mode === 'chat') return { mode: 'chat', reply: result.reply };
    if (result.mode === 'needs_context') return { mode: 'needs_context', reply: result.reply, questions: result.questions ?? [] };
    return { mode: 'refined', reply: result.reply, package: result.package! as VideoPostPackage };
  }
}

// ─── Image generation (DALL-E 3) ─────────────────────────────────────────────

export async function generateDalleImage(params: {
  apiKey: string;
  prompt: string;
  size?: '1024x1024' | '1024x1792' | '1792x1024';
  imageModel?: string; // 'gpt-image-1' (default) | 'dall-e-3'
}): Promise<string> {
  const model = params.imageModel ?? 'gpt-image-1';
  // dall-e-3 uses 'standard'/'hd'; gpt-image-1 uses 'auto'
  const quality = model === 'dall-e-3' ? 'standard' : 'auto';

  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      prompt: params.prompt,
      n: 1,
      size: params.size ?? '1024x1024',
      quality,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`gpt-image-1 error: ${err}`);
  }

  const data = (await response.json()) as { data: { url?: string; b64_json?: string }[] };
  const item = data.data[0];
  if (!item) throw new Error('gpt-image-1 returned no image data');

  // gpt-image-1 returns b64_json by default; url is available too but may be omitted
  if (item.url) return item.url;

  // Convert base64 to a data URL the caller can use directly
  if (item.b64_json) return `data:image/png;base64,${item.b64_json}`;

  throw new Error('gpt-image-1 returned neither url nor b64_json');
}
