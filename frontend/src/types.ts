export interface TfResponse<T> {
  success: boolean;
  message?: string;
  data?: T;
}

export interface Workspace {
  id: string;
  owner_id: string;
  name: string;
  slug: string;
  avatar_url: string | null;
  ai_tone: 'professional' | 'casual' | 'witty' | 'formal' | 'inspirational';
  default_caption_style: 'short' | 'medium' | 'long';
  default_platforms: string;
  brand_name: string | null;
  brand_description: string | null;
  brand_voice: string | null;
  target_audience: string | null;
  agent_instructions: string | null;
  // Media generation defaults
  default_image_size: string; // e.g. '1024x1024', '1024x1792', '1792x1024', or custom 'WxH'
  default_video_duration: number; // max clip length in seconds
  target_video_length: number; // total finished video target length in seconds
  default_video_dimensions: string; // e.g. '1280x720', '720x1280', or custom 'WxH'
  // Locked character
  character_name: string | null;
  character_appearance: string | null;
  character_reference_ids: string; // JSON array of workspace_upload IDs
  character_voice_id: string | null;
  // Per-platform settings — JSON: Record<string, { enabled: boolean; aspectRatio: '9:16'|'16:9'|'1:1' }>
  platform_settings: string | null;
  created_at: number;
  updated_at: number;
}

export interface Thread {
  id: string;
  workspace_id: string;
  created_by: string;
  title: string | null;
  media_type: 'undecided' | 'image' | 'video';
  status: 'planning' | 'draft' | 'script_ready' | 'media_pending' | 'ready' | 'published';
  active_draft_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface Message {
  id: string;
  thread_id: string;
  role: 'user' | 'assistant';
  type: 'chat' | 'draft' | 'followup';
  content: string;
  post_package: string | null;
  image_references: string | null; // JSON: { uploadId: string; publicUrl: string; name: string }[]
  model: string | null;
  cost_usd: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  created_at: number;
}

export interface PlannerQuestion {
  id: string;
  text: string;
  options: { id: string; label: string }[];
  allowMultiple: boolean;
}

export interface PlannerResult {
  reply: string;
  ready: boolean;
  mediaType: 'image' | 'video' | null;
  questions: PlannerQuestion[] | null;
}

export interface ImagePostPackage {
  content: string;
  caption: string;
  title: string;
  description: string;
  hashtags: string[];
  imagePrompt: string;
  imageSize: '1024x1024' | '1024x1792' | '1792x1024';
  imageStyle: string;
  tone: string;
  suggestedPlatforms: ('instagram' | 'tiktok')[];
  // Generation settings the agent may choose (validated/coerced server-side).
  // Absent = fall back to workspace/global defaults; the UI pre-selects these
  // and the user can still override before generating.
  imageModel?: string; // 'gpt-image-2' (default)
  generationMode?: 'edit' | 'inspire'; // how a draft reference image is used
  // Reference images (injected by backend after AI generation)
  referenceUploadIds?: string[];
  primaryReferenceUploadId?: string | null;
  // Whether the workspace's locked character is applied to this draft.
  // Absent = treat as true (legacy drafts). Controlled from the draft UI.
  includeCharacter?: boolean;
}

export interface VideoPostPackage {
  content: string;
  caption: string;
  title: string;
  description: string;
  hashtags: string[];
  script: {
    hook: string;
    body: string;
    callToAction: string;
    estimatedDuration: string;
    voiceoverNotes: string;
    scenes: { description: string; voiceover: string; duration: string }[];
  };
  videoPrompt: string;
  videoAspectRatio?: '9:16' | '16:9';
  videoDurationSeconds?: number;
  // Video model the agent may choose (validated/coerced server-side). Absent =
  // fall back to the default model; the UI pre-selects it and the user can still
  // override before generating.
  videoModel?: string;
  // Long video (chunk + ffmpeg stitch). chunkCount >= 2 turns on stitching; the UI
  // pre-selects these from the draft and the user can override before generating.
  longVideoTargetSeconds?: number;
  chunkCount?: number;
  stitchMode?: 'concat' | 'chain';
  // Continuation (agent-driven "Continue"): a per-part i2v storyboard and the source
  // asset it extends. When continueFromAssetId is present, the Generate button runs
  // the continue flow ([original, ...parts]) instead of a from-scratch generation.
  partPrompts?: string[];
  continueFromAssetId?: string;
  tone: string;
  suggestedPlatforms: ('instagram' | 'tiktok')[];
  // Reference images (injected by backend after AI generation)
  referenceUploadIds?: string[];
  primaryReferenceUploadId?: string | null;
  // Whether the workspace's locked character is applied to this draft.
  // Absent = treat as true (legacy drafts). Controlled from the draft UI.
  includeCharacter?: boolean;
}

export interface WorkspaceUpload {
  id: string;
  workspace_id: string;
  thread_id: string | null;
  name: string;
  public_url: string;
  mime_type: string | null;
  vision_description: string | null;
  created_at: number;
}

export interface Asset {
  id: string;
  thread_id: string;
  workspace_id: string;
  message_id: string | null;
  type: 'image' | 'video';
  status: 'pending' | 'generating' | 'ready' | 'failed';
  r2_key: string | null;
  public_url: string | null;
  prompt: string | null;
  // Non-null only for single-clip Replicate generations. Combine/stitch/continue
  // videos (made by ffmpeg, no single prediction) leave this null — the UI uses it
  // to decide whether "Recover" (re-import from Replicate) is even possible.
  prediction_id: string | null;
  // How the video was produced. Drives the card badge + which recovery action to show.
  generation_method: GenerationMethod | null;
  error_message: string | null;
  model: string | null;
  cost_usd: number | null;
  created_at: number;
  // Live chunk progress while a multi-part video generates (from the status endpoint).
  progress?: { done: number; total: number; stage?: string } | null;
}

export type GenerationMethod = 'single' | 'generate_stitch' | 'combine' | 'continue';

export type GenerationJobKind = 'chunk' | 'frame' | 'concat';
export type GenerationJobStatus = 'pending' | 'running' | 'succeeded' | 'failed';

/** One sub-job (part) of a multi-part video generation. */
export interface GenerationJob {
  id: string;
  asset_id: string;
  workspace_id: string;
  kind: GenerationJobKind;
  idx: number;
  status: GenerationJobStatus;
  prediction_id: string | null;
  model: string | null;
  prompt: string | null;
  duration_sec: number | null;
  seed_url: string | null;
  output_url: string | null;
  cost_usd: number | null;
  error_message: string | null;
  created_at: number;
  updated_at: number;
}

export interface SocialAccountSafe {
  id: string;
  workspace_id: string;
  platform: 'instagram' | 'tiktok';
  account_id: string;
  username: string | null;
  connected_at: number;
}

export interface PublishRecord {
  id: string;
  workspace_id: string;
  asset_id: string | null;
  platform: 'instagram' | 'tiktok';
  platform_post_id: string | null;
  container_id: string | null;
  status: 'pending' | 'processing' | 'published' | 'failed';
  caption: string | null;
  hashtags: string | null;
  error_message: string | null;
  created_at: number;
}
