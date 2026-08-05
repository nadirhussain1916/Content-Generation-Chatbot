import { createOpenAI } from '@ai-sdk/openai';
import { generateText, tool, stepCountIs } from 'ai';
import { z } from 'zod';
import { AGENT_SYSTEM_PROMPT, type WorkspaceBrand } from './prompts';
import type { ImagePostPackage, VideoPostPackage } from '../types';

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

// ─── Public types ─────────────────────────────────────────────────────────────

export type PlannerQuestion = {
  id: string;
  text: string;
  options: { id: string; label: string }[];
  allowMultiple: boolean;
};

export type AgentResult =
  | { action: 'chat'; reply: string }
  | { action: 'questions'; reply: string; questions: PlannerQuestion[] }
  | { action: 'image_draft'; reply: string; package: ImagePostPackage }
  | { action: 'video_script'; reply: string; package: VideoPostPackage };

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
export async function runAgent(params: {
  apiKey: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  tone: string;
  captionStyle: string;
  brand?: WorkspaceBrand;
  textModel?: string;
  threadStatus: string;
  imageReferences?: { uploadId: string; publicUrl: string; name: string }[];
  persistedImageContext?: string;
  getVisionDescription: (uploadId: string) => Promise<string | null>;
  saveVisionDescription: (uploadId: string, description: string) => Promise<void>;
}): Promise<AgentResult> {
  const openai = createOpenAI({ apiKey: params.apiKey });
  const imageReferences = params.imageReferences ?? [];

  const result = await generateText({
    model: openai.chat(params.textModel ?? 'gpt-4o'),
    // Allow one step per attached image (for analyze_image) plus 5 for reasoning + terminal tool
    stopWhen: stepCountIs(imageReferences.length + 5),
    system: AGENT_SYSTEM_PROMPT({
      tone: params.tone,
      captionStyle: params.captionStyle,
      brand: params.brand,
      threadStatus: params.threadStatus,
      imageReferences: imageReferences.map((r) => ({ uploadId: r.uploadId, name: r.name })),
      persistedImageContext: params.persistedImageContext,
    }),
    messages: buildHistory(params.messages),
    tools: {
      analyze_image: tool({
        description:
          'Get a detailed visual description of one of the attached reference images. ' +
          'Call for every image listed in REFERENCE IMAGES before making any content decision.',
        inputSchema: z.object({
          uploadId: z.string().describe('The uploadId of the image to analyze'),
        }),
        execute: async ({ uploadId }) => {
          const ref = imageReferences.find((r) => r.uploadId === uploadId);
          if (!ref) return 'Image not found in attached references.';

          // Serve from cache when available
          const cached = await params.getVisionDescription(uploadId);
          if (cached) return cached;

          // Live vision call — always gpt-4o regardless of user model choice
          const description = await analyzeImageForDescription({
            apiKey: params.apiKey,
            imageUrl: ref.publicUrl,
          });
          await params.saveVisionDescription(uploadId, description);
          return description;
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
        execute: async (input) => input,
      }),

      generate_image_draft: tool({
        description: 'Generate a complete, publish-ready image post package.',
        inputSchema: ImagePostPackageSchema.extend({
          reply: z.string().describe('1-2 sentence message to the user about what was created'),
        }),
        execute: async (input) => input,
      }),

      generate_video_script: tool({
        description: 'Generate a complete video script and post package.',
        inputSchema: VideoPostPackageSchema.extend({
          reply: z.string().describe('1-2 sentence message to the user about what was created'),
        }),
        execute: async (input) => input,
      }),

      chat_reply: tool({
        description:
          'Send a plain conversational reply. Use for greetings, brand questions, off-topic ' +
          'messages, or any response that does not produce content.',
        inputSchema: z.object({
          reply: z.string().describe('Your message to the user'),
        }),
        execute: async (input) => input,
      }),
    },
  });

  // ── Extract result from the last terminal tool call ───────────────────────
  const terminalTools = new Set(['ask_questions', 'generate_image_draft', 'generate_video_script', 'chat_reply']);

  // AI SDK v6 uses `input` (not `args`) on both StaticToolCall and DynamicToolCall
  type FlatToolCall = { toolName: string; input: Record<string, unknown> };

  for (let i = result.steps.length - 1; i >= 0; i--) {
    const step = result.steps[i];
    for (const tc of step.toolCalls as unknown as FlatToolCall[]) {
      if (!terminalTools.has(tc.toolName)) continue;
      const { toolName, input } = tc;

      if (toolName === 'chat_reply') {
        return { action: 'chat', reply: String(input.reply ?? '') };
      }
      if (toolName === 'ask_questions') {
        return {
          action: 'questions',
          reply: String(input.reply ?? ''),
          questions: (input.questions as PlannerQuestion[]) ?? [],
        };
      }
      if (toolName === 'generate_image_draft') {
        const { reply, ...pkg } = input;
        return { action: 'image_draft', reply: String(reply ?? ''), package: pkg as unknown as ImagePostPackage };
      }
      if (toolName === 'generate_video_script') {
        const { reply, ...pkg } = input;
        return { action: 'video_script', reply: String(reply ?? ''), package: pkg as unknown as VideoPostPackage };
      }
    }
  }

  // Fallback: use final text output as a chat reply
  return {
    action: 'chat',
    reply: result.text || "I'm here to help! What would you like to create?",
  };
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

// ─── Image generation (DALL-E 3 / gpt-image-1) ───────────────────────────────

export async function generateDalleImage(params: {
  apiKey: string;
  prompt: string;
  size?: '1024x1024' | '1024x1792' | '1792x1024';
  imageModel?: string; // 'gpt-image-1' (default) | 'dall-e-3'
  referenceImageUrl?: string;          // R2 public URL of the reference image
  referenceVisionDescription?: string; // cached vision description (for inspire mode)
  generationMode?: 'edit' | 'inspire'; // edit = /edits endpoint; inspire = enrich prompt
}): Promise<string> {
  const model = params.imageModel ?? 'gpt-image-1';

  // ── Edit mode: use /v1/images/edits (gpt-image-1 only) ───────────────────
  if (params.generationMode === 'edit' && params.referenceImageUrl && model !== 'dall-e-3') {
    // Fetch the reference image bytes from R2
    const imgRes = await fetch(params.referenceImageUrl);
    if (!imgRes.ok) throw new Error(`Failed to fetch reference image: ${imgRes.statusText}`);
    const imgBuffer = await imgRes.arrayBuffer();
    const imgBlob = new Blob([imgBuffer], { type: imgRes.headers.get('Content-Type') ?? 'image/png' });

    const formData = new FormData();
    formData.append('model', model);
    formData.append('image[]', imgBlob, 'reference.png');
    formData.append('prompt', params.prompt);
    formData.append('n', '1');
    formData.append('size', params.size ?? '1024x1024');

    const response = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { Authorization: `Bearer ${params.apiKey}` },
      body: formData,
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`gpt-image-1 edits error: ${err}`);
    }

    const data = (await response.json()) as { data: { url?: string; b64_json?: string }[] };
    const item = data.data[0];
    if (!item) throw new Error('gpt-image-1 edits returned no image data');
    if (item.url) return item.url;
    if (item.b64_json) return `data:image/png;base64,${item.b64_json}`;
    throw new Error('gpt-image-1 edits returned neither url nor b64_json');
  }

  // ── Inspire mode: enrich prompt with vision description ──────────────────
  let finalPrompt = params.prompt;
  if (params.generationMode === 'inspire' && params.referenceVisionDescription) {
    finalPrompt = `Inspired by this reference: ${params.referenceVisionDescription}\n\n${params.prompt}`;
  }

  // ── Standard generation ───────────────────────────────────────────────────
  const quality = model === 'dall-e-3' ? 'standard' : 'auto';

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
