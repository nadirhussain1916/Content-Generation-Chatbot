/**
 * Read-only, agent-safe views over generation state.
 *
 * These back the agent's DB tools (list_generations / get_generation_status). Two
 * hard rules keep them safe to expose to the LLM:
 *   1. SCOPING is enforced here from a caller-supplied workspaceId/threadId — never
 *      from anything the model provides. by-id lookups re-check workspace ownership.
 *   2. FIELD HYGIENE — we map DB rows to compact, safe shapes and NEVER leak internal
 *      or sensitive fields (r2_key, prediction_id, raw stitch_params, tokens, cost).
 */
import {
  getAsset,
  getAssetsByThread,
  getAssetsByWorkspace,
  getGenerationJobsByAsset,
} from '../db/queries';
import type { Asset, GenerationJob, GenerationJobKind } from '../types';

// ─── Safe, model-facing shapes ────────────────────────────────────────────────

export type AgentGenerationSummary = {
  id: string;
  type: 'image' | 'video';
  status: Asset['status'];
  model: string | null;
  createdAt: string;       // human-relative, e.g. "2 hours ago"
  promptSnippet: string;
  publicUrl?: string;      // only when ready
  errorMessage?: string;   // only when failed
};

export type AgentGenerationDetail = AgentGenerationSummary & {
  method: Asset['generation_method'];
  parts: { label: string; status: GenerationJob['status']; errorMessage?: string }[];
};

export type ListGenerationsOptions = {
  status?: 'ready' | 'generating' | 'failed' | 'all';
  type?: 'image' | 'video';
  scope?: 'thread' | 'workspace';
  limit?: number;
};

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;
const WORKSPACE_WINDOW = 100; // rows fetched before filtering/slicing
const SNIPPET_LEN = 140;

// ─── Mappers / helpers ────────────────────────────────────────────────────────

function relativeTime(unixSeconds: number): string {
  const s = Math.max(0, Math.floor((Date.now() - unixSeconds * 1000) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

function snippet(prompt: string | null): string {
  if (!prompt) return '';
  const t = prompt.trim();
  return t.length <= SNIPPET_LEN ? t : `${t.slice(0, SNIPPET_LEN).trimEnd()}…`;
}

function partLabel(kind: GenerationJobKind, idx: number): string {
  if (kind === 'chunk') return `Part ${idx + 1}`;
  if (kind === 'frame') return `Seed frame ${idx + 1}`;
  return 'Stitch'; // concat
}

function matchesStatus(status: Asset['status'], filter: Exclude<ListGenerationsOptions['status'], 'all' | undefined>): boolean {
  if (filter === 'generating') return status === 'pending' || status === 'generating';
  return status === filter; // 'ready' | 'failed'
}

/** Map a full Asset row to the safe summary shape (drops all internal/sensitive fields). */
function toSummary(a: Asset): AgentGenerationSummary {
  return {
    id: a.id,
    type: a.type,
    status: a.status,
    model: a.model,
    createdAt: relativeTime(a.created_at),
    promptSnippet: snippet(a.prompt),
    ...(a.status === 'ready' && a.public_url ? { publicUrl: a.public_url } : {}),
    ...(a.error_message ? { errorMessage: a.error_message } : {}),
  };
}

// ─── Public queries ───────────────────────────────────────────────────────────

/**
 * Recent generations for the CURRENT workspace (optionally just the current thread).
 * `ctx` is bound by the caller; scope/type/status/limit come from the (validated) tool input.
 */
export async function listGenerationsForAgent(
  db: D1Database,
  ctx: { workspaceId: string; threadId?: string },
  opts: ListGenerationsOptions = {},
): Promise<AgentGenerationSummary[]> {
  const limit = Math.min(Math.max(Math.round(opts.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT);
  const scope = opts.scope ?? (ctx.threadId ? 'thread' : 'workspace');

  const query =
    scope === 'thread' && ctx.threadId
      ? await getAssetsByThread(db, ctx.threadId)
      : await getAssetsByWorkspace(db, ctx.workspaceId, WORKSPACE_WINDOW);

  // Defense in depth: never return a row outside the current workspace, even if a
  // thread lookup somehow returned foreign rows.
  let rows = query.results.filter((a) => a.workspace_id === ctx.workspaceId);
  if (opts.type) rows = rows.filter((a) => a.type === opts.type);
  const statusFilter = opts.status;
  if (statusFilter && statusFilter !== 'all') rows = rows.filter((a) => matchesStatus(a.status, statusFilter));

  return rows.slice(0, limit).map(toSummary);
}

/**
 * Detailed status of a single generation, including its per-part breakdown.
 * Returns null if the id doesn't exist OR belongs to another workspace (scope enforce).
 */
export async function getGenerationStatusForAgent(
  db: D1Database,
  ctx: { workspaceId: string },
  assetId: string,
): Promise<AgentGenerationDetail | null> {
  const asset = await getAsset(db, assetId);
  if (!asset || asset.workspace_id !== ctx.workspaceId) return null;

  const jobs = (await getGenerationJobsByAsset(db, assetId)).results;
  const parts = jobs.map((j) => ({
    label: partLabel(j.kind, j.idx),
    status: j.status,
    ...(j.error_message ? { errorMessage: j.error_message } : {}),
  }));

  return { ...toSummary(asset), method: asset.generation_method, parts };
}
