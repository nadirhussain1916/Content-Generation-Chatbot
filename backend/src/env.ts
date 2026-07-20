import type { GenerationParams } from './workflows/generation';

// Stable re-export of the Cloudflare bindings type.
// Import from here — never directly from worker-configuration.d.ts (auto-generated).
export type CloudflareBindings = __BaseEnv_Env & {
  MIGRATE_SECRET: string;
  GENERATION_WORKFLOW: Workflow<GenerationParams>;
};

