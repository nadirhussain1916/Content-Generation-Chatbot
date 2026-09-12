/**
 * Replicate API wrapper — single choke point for all prediction creates + gets.
 * When the mock is enabled for a workspace, calls are short-circuited to
 * mockReplicate.ts instead of hitting api.replicate.com.
 */

import type { CloudflareBindings } from '../env';
import {
  isMockReplicateEnabled,
  mockCreatePrediction,
  mockGetPrediction,
  validateReplicateInput,
  type ReplicateValidationError,
} from './mockReplicate';

// ─── Shared types ──────────────────────────────────────────────────────────────

export interface ReplicatePredictionResult {
  status: string;
  output?: string | string[];
  error?: string;
  metrics?: {
    predict_time?: number;
    total_time?: number;
    /** Video-specific metric emitted by LTX, Seedance, etc. */
    video_output_duration_seconds?: number;
  };
}

export type CreatePredictionResult =
  | { ok: true; id: string }
  | { ok: false; status: number; errorText: string };

// ─── createPrediction ─────────────────────────────────────────────────────────

/**
 * Create a Replicate prediction for the given model + input.
 *
 * **Pre-flight validation runs on EVERY call** (mock and real) so malformed inputs
 * are caught locally before a credit is spent.  The validation mirrors the exact 422
 * body shape Replicate returns, so downstream error handling is unchanged.
 *
 * When the mock is enabled for `workspaceId`, validated inputs are stored in KV
 * instead of hitting Replicate.  When the mock is off, the real API is called.
 *
 * Returns `{ ok: true, id }` on success, or `{ ok: false, status, errorText }`
 * on any failure — preserving the same semantics callers already use.
 */
export async function createPrediction(
  env: Pick<CloudflareBindings, 'DB' | 'KV' | 'ASSETS_PUBLIC_URL' | 'REPLICATE_API_TOKEN'>,
  workspaceId: string,
  modelSlug: string,
  input: Record<string, unknown>,
): Promise<CreatePredictionResult> {
  // ── Pre-flight: validate locally before spending a Replicate credit ───────────
  // Catches bad field names, missing required fields, out-of-range durations, etc.
  // Returns the exact 422 body Replicate would return, so callers need no changes.
  const validationError = validateReplicateInput(modelSlug, input);
  if (validationError) {
    return {
      ok: false,
      status: 422,
      errorText: JSON.stringify(validationError satisfies ReplicateValidationError),
    };
  }

  const mockEnabled = await isMockReplicateEnabled(env, workspaceId);

  if (mockEnabled) {
    // Input is already validated above — mockCreatePrediction only produces ok:true
    const result = await mockCreatePrediction(env, workspaceId, modelSlug, input);
    return { ok: true, id: result.prediction['id'] as string };
  }

  // Real Replicate call
  const res = await fetch(`https://api.replicate.com/v1/models/${modelSlug}/predictions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.REPLICATE_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input }),
  });

  if (!res.ok) {
    return { ok: false, status: res.status, errorText: await res.text() };
  }

  const data = await res.json() as { id?: string; error?: string };
  if (!data.id) {
    return {
      ok: false,
      status: 502,
      errorText: data.error ?? 'Replicate returned a prediction without an id',
    };
  }

  return { ok: true, id: data.id };
}

// ─── getPrediction ────────────────────────────────────────────────────────────

/**
 * Fetch the current state of a Replicate prediction.
 *
 * When mock is enabled and the id starts with "mock_", reads from KV and returns
 * "succeeded" immediately (or "failed" for FAIL-sentinel pool entries). Falls
 * through to the real Replicate API if the KV entry is missing (edge case: id
 * from a real generation while mock was off).
 */
export async function getPrediction(
  env: Pick<CloudflareBindings, 'DB' | 'KV' | 'REPLICATE_API_TOKEN'>,
  workspaceId: string,
  predictionId: string,
): Promise<ReplicatePredictionResult> {
  const mockEnabled = await isMockReplicateEnabled(env, workspaceId);

  if (mockEnabled) {
    const result = await mockGetPrediction(env.KV, predictionId);
    if (result) {
      return result as unknown as ReplicatePredictionResult;
    }
    // Not found in KV — fall through to real API (e.g. a pre-existing real prediction)
  }

  const r = await fetch(`https://api.replicate.com/v1/predictions/${predictionId}`, {
    headers: { Authorization: `Bearer ${env.REPLICATE_API_TOKEN}` },
  });
  return r.json() as Promise<ReplicatePredictionResult>;
}
