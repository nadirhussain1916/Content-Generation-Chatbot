import type { GenerationParams } from './workflows/generation';
import type { PublishParams } from './workflows/publish';
import type { Sandbox } from '@cloudflare/sandbox';

// Stable re-export of the Cloudflare bindings type.
// Import from here — never directly from worker-configuration.d.ts (auto-generated).
export type CloudflareBindings = __BaseEnv_Env & {
  MIGRATE_SECRET: string;
  SUPER_ADMIN_SECRET: string;
  GENERATION_WORKFLOW: Workflow<GenerationParams>;
  PUBLISH_WORKFLOW: Workflow<PublishParams>;
  ASSETS_PUBLIC_URL: string;
  INSTAGRAM_APP_ID: string;
  INSTAGRAM_APP_SECRET: string;
  // ffmpeg-in-a-container for long-video stitching (see wrangler.jsonc containers).
  Sandbox: DurableObjectNamespace<Sandbox>;
};

