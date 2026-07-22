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
  default_image_size: '1024x1024' | '1024x1792' | '1792x1024';
  default_video_duration: number; // seconds: 5 | 10
  default_video_dimensions: '1280x720' | '720x1280';
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
  tone: string;
  suggestedPlatforms: ('instagram' | 'tiktok')[];
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
  error_message: string | null;
  created_at: number;
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
  platform: 'instagram' | 'tiktok';
  status: 'pending' | 'processing' | 'published' | 'failed';
  caption: string | null;
  error_message: string | null;
  created_at: number;
}
