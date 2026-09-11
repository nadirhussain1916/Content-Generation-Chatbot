import { createOpenAI } from '@ai-sdk/openai';
import { NonRetryableError } from 'cloudflare:workflows';
import { generateText, streamText, tool, stepCountIs } from 'ai';
import { z } from 'zod';
import { AGENT_SYSTEM_PROMPT, type WorkspaceBrand } from './prompts';
import type { ImagePostPackage, VideoPostPackage } from '../types';
import { IMAGE_MODELS, GENERATION_MODES, VIDEO_MODELS, STITCH_MODES, STITCH_MAX_CHUNKS } from './generationConfig';
import { Logger } from '../utils/Logger';

// ─── Schemas ──────────────────────────────────────────────────────────────────

const QuestionSchema = z.object({
  id: z.string().describe('Unique identifier for this question, e.g. "angle", "audience", "format"'),
  text: z.string().describe('The question label shown above the chips'),
  options: z.array(z.object({ id: z.string(), label: z.string() })).describe('2-5 selectable chips for this question'),
  allowMultiple: z.boolean().describe('True if the user should be able to select more than one option'),
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
  includeCharacter: z.boolean().describe(
    "Whether the workspace's locked character appears in this image. " +
    'Decide BEFORE writing imagePrompt and author the prompt to match: if true, build the scene ' +
    'around the locked character (do NOT describe a different/competing person); if false, write it normally. ' +
    'Set false when the workspace has no locked character.'
  ),
  imageModel: z.enum(IMAGE_MODELS).optional().describe(
    'Image generation model. Default (and currently the only option) is "gpt-image-2". Always set this to "gpt-image-2".'
  ),
  generationMode: z.enum(GENERATION_MODES).optional().describe(
    'How reference images attached to this draft are used. ONLY meaningful when a reference image is present. ' +
    '"edit" = feed the reference in as pixels to faithfully reproduce/composite it (use for products, logos, a specific ' +
    'person/scene that must be preserved). "inspire" = use the reference only as stylistic guidance described in words ' +
    '(use for mood/style/palette inspiration). Omit when there is no reference image. Default is "inspire".'
  ),
});

const VideoPostPackageSchema = z.object({
  content: z.string(),
  caption: z.string().max(2200),
  title: z.string().max(150),
  description: z.string().max(2200),
  hashtags: z.array(z.string()).max(30),
  script: VideoScriptSchema,
  videoPrompt: z.string().describe('Replicate/Runway visual prompt'),
  videoAspectRatio: z.enum(['9:16', '16:9']).describe('9:16=portrait (Reels/Shorts/TikTok) | 16:9=landscape (YouTube). Match the workspace default video dimensions unless the user requests otherwise.'),
  videoDurationSeconds: z.number().int().describe('Per-clip generation length in seconds. Set to the workspace default clip length unless the user requests a different length. Must be valid for the chosen videoModel (the backend snaps it to the nearest allowed value otherwise).'),
  tone: z.string(),
  suggestedPlatforms: z.array(z.enum(['instagram', 'tiktok'])),
  includeCharacter: z.boolean().describe(
    "Whether the workspace's locked character appears in this video. " +
    'Decide BEFORE writing videoPrompt and author the prompt to match: if true, build the scenes ' +
    'around the locked character (do NOT describe a different/competing person); if false, write it normally. ' +
    'Set false when the workspace has no locked character.'
  ),
  videoModel: z.enum(VIDEO_MODELS).optional().describe(
    'Replicate video model. Default "lightricks/ltx-2.3-fast" (portrait, audio, up to 20s, cheap — good general choice). ' +
    'Options: "lightricks/ltx-2.3-pro" (higher quality, up to 10s), "bytedance/seedance-2.0" / "bytedance/seedance-2.0-fast" ' +
    '(4K, up to 15s), "wan-video/wan-2.7-t2v" (text-only), "wan-video/wan-2.7-i2v" (image-to-video — REQUIRES a reference image), ' +
    '"google/veo-2" (fast, portrait & landscape, premium). Only pick "wan-video/wan-2.7-i2v" when a reference image is attached. ' +
    'Pick "wan-video/wan-2.7-t2v" only when there is no reference image to preserve.'
  ),
  // ── Long video (chunk + ffmpeg stitch) — see LONG VIDEO CAPABILITIES in the system prompt ──
  longVideoTargetSeconds: z.number().int().optional().describe(
    'Only when the user wants a video LONGER than one model clip. The total desired length in seconds. ' +
    'Per-model max clip length: LTX Fast 20s, Seedance/Wan 15s, LTX Pro 10s, Veo 8s. For long targets prefer a ' +
    'longer-clip model (LTX Fast / Seedance) to minimise chunks and cost. Omit for normal single-clip videos.'
  ),
  chunkCount: z.number().int().min(1).max(STITCH_MAX_CHUNKS).optional().describe(
    'Number of chunks to generate and stitch. 1 (or omit) = a normal single clip. For a long video set this to ' +
    'ceil(longVideoTargetSeconds / model max clip length), capped at ' + STITCH_MAX_CHUNKS + '. Also set ' +
    'videoDurationSeconds to that model\'s max clip length so the chunks add up to the target.'
  ),
  stitchMode: z.enum(STITCH_MODES).optional().describe(
    '"concat" = fast, chunks render in parallel, but there are hard cuts between them (works with EVERY model). ' +
    '"chain" = seamless — each chunk\'s last frame seeds the next (image-to-video), only for i2v-capable models ' +
    '(everything except "wan-video/wan-2.7-t2v") and slower. Default "concat"; use "chain" when the user wants smooth continuity. ' +
    'Only meaningful when chunkCount >= 2.'
  ),
  partPrompts: z.array(z.string()).max(STITCH_MAX_CHUNKS).optional().describe(
    'CONTINUATION MODE ONLY (see CONTINUATION MODE in the system prompt). A storyboard of image-to-video ' +
    'prompts, ONE PER PART, describing how the existing video is extended step by step (part 1 continues ' +
    'directly from where the source ends, part 2 continues from part 1, etc.). Each part is generated as ' +
    'i2v seeded by the previous part\'s last frame, so write each prompt as the ACTION for that segment. ' +
    'The number of parts = partPrompts.length; also set chunkCount to that same number. Omit outside continuation mode.'
  ),
});

// ─── Public types ─────────────────────────────────────────────────────────────

export type PlannerQuestion = {
  id: string;
  text: string;
  options: { id: string; label: string }[];
  allowMultiple: boolean;
};

export type AgentUsage = { inputTokens: number; outputTokens: number };

export type AgentResult =
  | { action: 'chat'; reply: string; usage: AgentUsage }
  | { action: 'questions'; reply: string; questions: PlannerQuestion[]; usage: AgentUsage }
  | { action: 'image_draft'; reply: string; package: ImagePostPackage; usage: AgentUsage }
  | { action: 'video_script'; reply: string; package: VideoPostPackage; usage: AgentUsage };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildHistory(messages: { role: 'user' | 'assistant'; content: string }[]) {
  return messages.map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));
}

// ─── Unified Agent ────────────────────────────────────────────────────────────

/**
 * Single agentic generateText call that covers all conversation phases:
 * image analysis, clarifying questions, draft generation, refinement, and chat.
 *
 * The model decides autonomously which terminal tool to call based on context.
 * analyze_image may be called 0-N times before the terminal tool.
 */
export type RunAgentParams = {
  apiKey: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  tone: string;
  captionStyle: string;
  brand?: WorkspaceBrand;
  textModel?: string;
  threadStatus: string;
  imageReferences?: { uploadId: string; publicUrl: string; name: string }[];
  persistedImageContext?: string;
  // Set when this thread is an agent-driven "continue" of an existing video. Grounds
  // the agent in what the source looks like so it plans a per-part continuation storyboard.
  continuation?: { originalPrompt: string; frameDescription: string };
  getVisionDescription: (uploadId: string) => Promise<string | null>;
  saveVisionDescription: (uploadId: string, description: string) => Promise<void>;
  /** Resolve any upload ID the agent finds in the conversation (e.g. POST_PACKAGE.referenceUploadIds) */
  resolveUpload: (uploadId: string) => Promise<{ publicUrl: string; name: string } | null>;
};

/** A single live progress event describing what the agent is currently doing. */
export type AgentProgressEvent = { type: 'tool'; tool: string };

function logAgentStart(params: RunAgentParams) {
  const imageReferences = params.imageReferences ?? [];
  // Log the last user message so logs can be correlated to the user's input
  const lastUserMsg = [...params.messages].reverse().find((m) => m.role === 'user');
  Logger.log('AgentStart', {
    model: params.textModel ?? 'gpt-4o',
    threadStatus: params.threadStatus,
    attachedImageCount: imageReferences.length,
    hasPersistedContext: !!params.persistedImageContext,
    userMessage: lastUserMsg?.content?.slice(0, 200) ?? '',
  });
}

/**
 * Build the shared generateText/streamText configuration (system prompt, history,
 * tools). Used by both the buffered (runAgent) and streaming (runAgentStreaming) paths.
 */
function buildAgentGenerationConfig(params: RunAgentParams) {
  const openai = createOpenAI({ apiKey: params.apiKey });
  const imageReferences = params.imageReferences ?? [];

  return {
    model: openai.chat(params.textModel ?? 'gpt-4o'),
    // Allow steps for: current-message refs + draft refs (unknown count) + reasoning + terminal tool
    stopWhen: stepCountIs(Math.max(imageReferences.length + 8, 12)),
    system: AGENT_SYSTEM_PROMPT({
      tone: params.tone,
      captionStyle: params.captionStyle,
      brand: params.brand,
      threadStatus: params.threadStatus,
      imageReferences: imageReferences.map((r) => ({ uploadId: r.uploadId, name: r.name })),
      persistedImageContext: params.persistedImageContext,
      continuation: params.continuation,
    }),
    messages: buildHistory(params.messages),
    tools: {
      analyze_image: tool({
        description:
          'Get a detailed visual description of any reference image. ' +
          'Call for every image listed in REFERENCE IMAGES and for every uploadId ' +
          'seen in POST_PACKAGE.referenceUploadIds or POST_PACKAGE.primaryReferenceUploadId ' +
          'before making any content decision.',
        inputSchema: z.object({
          uploadId: z.string().describe('The uploadId of the image to analyze'),
        }),
        execute: async ({ uploadId }) => {
          // 1. Serve from cache first — works for any uploadId, not just current attachments
          const cached = await params.getVisionDescription(uploadId);
          if (cached) {
            Logger.log('AnalyzeImageCacheHit', { uploadId });
            return cached;
          }

          // 2. Find publicUrl: current-message attachment first, then DB lookup
          const ref = imageReferences.find((r) => r.uploadId === uploadId);
          let publicUrl = ref?.publicUrl;

          if (!publicUrl) {
            Logger.log('AnalyzeImageResolveFromDB', { uploadId });
            const resolved = await params.resolveUpload(uploadId);
            publicUrl = resolved?.publicUrl;
          }

          if (!publicUrl) {
            Logger.log('AnalyzeImageNotFound', { uploadId });
            return `Image ${uploadId} not found or has no public URL.`;
          }

          // 3. Live vision call — always gpt-4o
          Logger.log('AnalyzeImageLiveVision', { uploadId, source: ref ? 'attached' : 'draft-ref' });
          try {
            const description = await analyzeImageForDescription({
              apiKey: params.apiKey,
              imageUrl: publicUrl,
            });
            await params.saveVisionDescription(uploadId, description);
            Logger.log('AnalyzeImageComplete', { uploadId, descriptionLength: description.length });
            return description;
          } catch (err) {
            Logger.log('AnalyzeImageFailed', { uploadId }, err);
            return `Failed to analyze image ${uploadId} — vision API error.`;
          }
        },
      }),

      ask_questions: tool({
        description:
          'Ask the user clarifying questions via chip groups. Use when you need more information ' +
          'before generating content. Maximum 2 rounds across the whole conversation.',
        inputSchema: z.object({
          reply: z.string().describe('Short intro message before the chip questions'),
          questions: z.array(QuestionSchema).describe('2-4 chip question groups'),
        }),
        execute: async (input) => {
          Logger.log('ToolCall:ask_questions', { questionCount: input.questions.length });
          return input;
        },
      }),

      generate_image_draft: tool({
        description: 'Generate a complete, publish-ready image post package.',
        inputSchema: ImagePostPackageSchema.extend({
          reply: z.string().describe('1-2 sentence message to the user about what was created'),
        }),
        execute: async (input) => {
          Logger.log('ToolCall:generate_image_draft', {
            imageSize: input.imageSize,
            imageStyle: input.imageStyle,
            hashtagCount: input.hashtags.length,
            promptLength: input.imagePrompt.length,
          });
          return input;
        },
      }),

      generate_video_script: tool({
        description: 'Generate a complete video script and post package.',
        inputSchema: VideoPostPackageSchema.extend({
          reply: z.string().describe('1-2 sentence message to the user about what was created'),
        }),
        execute: async (input) => {
          Logger.log('ToolCall:generate_video_script', {
            estimatedDuration: input.script.estimatedDuration,
            sceneCount: input.script.scenes.length,
            hashtagCount: input.hashtags.length,
            promptLength: input.videoPrompt.length,
          });
          return input;
        },
      }),

      chat_reply: tool({
        description:
          'Send a plain conversational reply. Use for greetings, brand questions, off-topic ' +
          'messages, or any response that does not produce content.',
        inputSchema: z.object({
          reply: z.string().describe('Your message to the user'),
        }),
        execute: async (input) => {
          Logger.log('ToolCall:chat_reply', { replyLength: input.reply.length });
          return input;
        },
      }),
    },
  };
}

/**
 * Extract the AgentResult from the FIRST terminal tool call across the completed steps.
 * Scan forward so that if the model incorrectly calls a second terminal tool after seeing
 * the first tool's result, we still use the first decision. (e.g. model calls ask_questions
 * → gets result back → calls chat_reply to "summarize" — we want ask_questions.)
 */
function extractAgentResult(
  steps: Array<{ toolCalls: unknown[] }>,
  text: string,
  usage: AgentUsage,
): AgentResult {
  const terminalTools = new Set(['ask_questions', 'generate_image_draft', 'generate_video_script', 'chat_reply']);

  // AI SDK v6 uses `input` (not `args`) on both StaticToolCall and DynamicToolCall
  type FlatToolCall = { toolName: string; input: Record<string, unknown> };

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    for (const tc of step.toolCalls as unknown as FlatToolCall[]) {
      if (!terminalTools.has(tc.toolName)) continue;
      const { toolName, input } = tc;

      Logger.log('AgentTerminalTool', { toolName, stepIndex: i });

      if (toolName === 'chat_reply') {
        return { action: 'chat', reply: String(input.reply ?? ''), usage };
      }
      if (toolName === 'ask_questions') {
        return {
          action: 'questions',
          reply: String(input.reply ?? ''),
          questions: (input.questions as PlannerQuestion[]) ?? [],
          usage,
        };
      }
      if (toolName === 'generate_image_draft') {
        const { reply, ...pkg } = input;
        return { action: 'image_draft', reply: String(reply ?? ''), package: pkg as unknown as ImagePostPackage, usage };
      }
      if (toolName === 'generate_video_script') {
        const { reply, ...pkg } = input;
        return { action: 'video_script', reply: String(reply ?? ''), package: pkg as unknown as VideoPostPackage, usage };
      }
    }
  }

  // Fallback: no terminal tool found — use raw text output
  Logger.log('AgentFallbackToText', { stepCount: steps.length, textLength: text?.length ?? 0 });
  return {
    action: 'chat',
    reply: text || "I'm here to help! What would you like to create?",
    usage,
  };
}

/**
 * Buffered agent run — returns the final structured result once the whole agentic
 * loop completes. Used by the non-streaming message endpoint.
 */
export async function runAgent(params: RunAgentParams): Promise<AgentResult> {
  logAgentStart(params);

  const result = await generateText(buildAgentGenerationConfig(params)).catch((err: unknown) => {
    Logger.log('AgentGenerateTextFailed', {
      model: params.textModel ?? 'gpt-4o',
      threadStatus: params.threadStatus,
      attachedImageCount: params.imageReferences?.length ?? 0,
    }, err);
    throw err; // re-throw so messages.ts returns a 500
  });

  const usage: AgentUsage = {
    inputTokens: result.usage?.inputTokens ?? 0,
    outputTokens: result.usage?.outputTokens ?? 0,
  };

  Logger.log('AgentComplete', {
    stepCount: result.steps.length,
    totalInputTokens: usage.inputTokens,
    totalOutputTokens: usage.outputTokens,
    finishReason: result.finishReason,
  });

  return extractAgentResult(result.steps as unknown as Array<{ toolCalls: unknown[] }>, result.text ?? '', usage);
}

/**
 * Streaming agent run — emits an AgentProgressEvent each time the model invokes a tool
 * (analyze_image, ask_questions, generate_image_draft, …) so the UI can show live progress,
 * then returns the same final structured AgentResult once the loop completes.
 */
export async function runAgentStreaming(
  params: RunAgentParams & { onEvent: (e: AgentProgressEvent) => void | Promise<void> },
): Promise<AgentResult> {
  logAgentStart(params);

  const result = streamText(buildAgentGenerationConfig(params));

  try {
    for await (const part of result.fullStream) {
      if (part.type === 'tool-call') {
        await params.onEvent({ type: 'tool', tool: part.toolName });
      } else if (part.type === 'error') {
        throw part.error;
      }
    }
  } catch (err) {
    Logger.log('AgentStreamFailed', {
      model: params.textModel ?? 'gpt-4o',
      threadStatus: params.threadStatus,
    }, err);
    throw err; // surfaced to the SSE handler which emits an error event
  }

  const steps = await result.steps;
  const text = await result.text;
  const finalUsage = await result.usage;
  const usage: AgentUsage = {
    inputTokens: finalUsage?.inputTokens ?? 0,
    outputTokens: finalUsage?.outputTokens ?? 0,
  };

  Logger.log('AgentStreamComplete', {
    stepCount: steps.length,
    totalInputTokens: usage.inputTokens,
    totalOutputTokens: usage.outputTokens,
  });

  return extractAgentResult(steps as unknown as Array<{ toolCalls: unknown[] }>, text ?? '', usage);
}

// ─── Image description via GPT-4o vision ─────────────────────────────────────

/**
 * Analyzes an image URL and returns a concise text description.
 * Always uses gpt-4o regardless of the user's textModel choice.
 * Result is cached in workspace_uploads.vision_description by the caller.
 */
export async function analyzeImageForDescription(params: {
  apiKey: string;
  imageUrl: string;
}): Promise<string> {
  const openai = createOpenAI({ apiKey: params.apiKey });
  const { text } = await generateText({
    model: openai.chat('gpt-4o'),
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Describe this image in detail for use as a reference in content creation. Include visual style, colors, composition, key elements, and any text or logos visible. Keep it under 150 words.',
          },
          {
            type: 'image',
            image: new URL(params.imageUrl),
          },
        ],
      },
    ],
  });
  return text;
}

// ─── Image generation (gpt-image-2) ───────────────────────────────────────────

// Build the right error for an OpenAI image API failure. 4xx client errors
// (invalid model, bad params, auth) are permanent — retrying wastes ~15s of
// workflow backoff — so they're thrown as NonRetryableError to fail fast.
// 429 rate limits and 5xx server errors stay retryable.
function imageApiError(model: string, kind: 'generation' | 'edit', status: number, body: string): Error {
  const message = `${model} image ${kind} failed (HTTP ${status}): ${body}`;
  const isPermanent = status >= 400 && status < 500 && status !== 429;
  return isPermanent ? new NonRetryableError(message) : new Error(message);
}

// Max reference images gpt-image-2 / gpt-image-1 accept on the /edits endpoint.
const OPENAI_EDIT_MAX_IMAGES = 16;

export async function generateDalleImage(params: {
  apiKey: string;
  prompt: string;
  size?: '1024x1024' | '1024x1792' | '1792x1024';
  imageModel?: string; // 'gpt-image-2' (default)
  referenceImageUrls?: string[];       // R2 public URLs fed as pixels to the /edits endpoint
  referenceVisionDescription?: string; // cached vision description for "inspire" (text-only) references
}): Promise<string> {
  const model = params.imageModel ?? 'gpt-image-2';

  // ── Normalise size ────────────────────────────────────────────────────────
  // GPT Image models use 1024x1536 / 1536x1024 — remap the incoming portrait/landscape values.
  const GPT_IMAGE_SIZE_MAP: Record<string, string> = {
    '1024x1792': '1024x1536',
    '1792x1024': '1536x1024',
  };
  const rawSize = params.size ?? '1024x1024';
  const resolvedSize = GPT_IMAGE_SIZE_MAP[rawSize] ?? rawSize;

  // ── Prompt enrichment ──────────────────────────────────────────────────────
  // "Inspire" references are folded in as text (no pixels). This runs for BOTH
  // the edit and generation paths so a scene can be described in words while a
  // character reference is still supplied as pixels below.
  let finalPrompt = params.prompt;
  if (params.referenceVisionDescription) {
    finalPrompt = `Inspired by this reference: ${params.referenceVisionDescription}\n\n${finalPrompt}`;
  }

  // ── Edit mode: /v1/images/edits with one or more reference images ──────────
  // gpt-image-2 auto-applies high fidelity to input images (identity/character
  // preservation) — do NOT send input_fidelity, it errors on this model.
  const refUrls = (params.referenceImageUrls ?? []).slice(0, OPENAI_EDIT_MAX_IMAGES);
  if (refUrls.length > 0) {
    // Fetch all reference image bytes in parallel, preserving order.
    const blobs = await Promise.all(
      refUrls.map(async (url, i) => {
        const imgRes = await fetch(url);
        if (!imgRes.ok) throw new Error(`Failed to fetch reference image ${i + 1}: ${imgRes.statusText}`);
        const buf = await imgRes.arrayBuffer();
        return new Blob([buf], { type: imgRes.headers.get('Content-Type') ?? 'image/png' });
      })
    );

    const formData = new FormData();
    formData.append('model', model);
    for (const blob of blobs) formData.append('image[]', blob, 'reference.png');
    formData.append('prompt', finalPrompt);
    formData.append('n', '1');
    formData.append('size', resolvedSize);

    const response = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { Authorization: `Bearer ${params.apiKey}` },
      body: formData,
    });

    if (!response.ok) {
      const err = await response.text();
      throw imageApiError(model, 'edit', response.status, err);
    }

    const data = (await response.json()) as { data: { url?: string; b64_json?: string }[] };
    const item = data.data[0];
    if (!item) throw new Error(`${model} edit returned no image data`);
    if (item.url) return item.url;
    if (item.b64_json) return `data:image/png;base64,${item.b64_json}`;
    throw new Error(`${model} edit returned neither url nor b64_json`);
  }

  // ── Standard generation (text-to-image, includes any inspire enrichment) ───
  const quality = 'auto';

  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      prompt: finalPrompt,
      n: 1,
      size: resolvedSize,
      quality,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw imageApiError(model, 'generation', response.status, err);
  }

  const data = (await response.json()) as { data: { url?: string; b64_json?: string }[] };
  const item = data.data[0];
  if (!item) throw new Error(`${model} returned no image data`);

  // GPT image models return b64_json by default; url is available too but may be omitted.
  if (item.url) return item.url;

  // Convert base64 to a data URL the caller can use directly
  if (item.b64_json) return `data:image/png;base64,${item.b64_json}`;

  throw new Error(`${model} returned neither url nor b64_json`);
}
