// ─── API Response Shapes ────────────────────────────────────────────────────

export interface TfResponse<T> {
  success: boolean;
  message?: string;
  data?: T;
}

export interface TfPaginatedResponse<T> extends TfResponse<T> {
  pagination: {
    page: number;
    limit: number;
    total: number;
  };
}

// ─── Domain Types ────────────────────────────────────────────────────────────

export interface User {
  id: string;
  onboarded: number;
  created_at: number;
  updated_at: number;
}

export interface Workspace {
  id: string;
  owner_id: string;
  name: string;
  slug: string;
  avatar_url: string | null;
  ai_tone: 'professional' | 'casual' | 'witty' | 'formal' | 'inspirational';
  default_caption_style: 'short' | 'medium' | 'long';
  default_platforms: string; // JSON array: ["instagram","tiktok"]
  // Brand context & agent settings
  brand_name: string | null;
  brand_description: string | null;
  brand_voice: string | null;
  target_audience: string | null;
  agent_instructions: string | null;
  // Media generation defaults
  default_image_size: string; // e.g. '1024x1024', '1024x1792', '1792x1024', or custom 'WxH'
  default_video_duration: number; // seconds
  default_video_dimensions: string; // e.g. '1280x720', '720x1280', or custom 'WxH'
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
  post_package: string | null; // JSON: ImagePostPackage | VideoPostPackage
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
  prediction_id: string | null;
  error_message: string | null;
  created_at: number;
}

export interface SocialAccount {
  id: string;
  workspace_id: string;
  platform: 'instagram' | 'tiktok';
  access_token: string;
  refresh_token: string | null;
  account_id: string;
  username: string | null;
  token_expires_at: number | null;
  refresh_token_expires_at: number | null;
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
  hashtags: string | null; // JSON array
  error_message: string | null;
  created_at: number;
}

// ─── PostPackage Types ────────────────────────────────────────────────────────

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
}

export interface VideoScene {
  description: string;
  voiceover: string;
  duration: string;
}

export interface VideoScript {
  hook: string;
  body: string;
  callToAction: string;
  estimatedDuration: string;
  voiceoverNotes: string;
  scenes: VideoScene[];
}

export interface VideoPostPackage {
  content: string;
  caption: string;
  title: string;
  description: string;
  hashtags: string[];
  script: VideoScript;
  videoPrompt: string;
  tone: string;
  suggestedPlatforms: ('instagram' | 'tiktok')[];
}

export type PostPackage = ImagePostPackage | VideoPostPackage;

// ─── Hono Context Variables ───────────────────────────────────────────────────

export type ContextVariables = {
  userId: string;
  workspace: Workspace;
};
