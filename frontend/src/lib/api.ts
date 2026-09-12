const BASE = import.meta.env.VITE_API_BASE_URL ?? '';

async function request<T>(
  path: string,
  options: RequestInit = {},
  token?: string
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  const data = await res.json() as T;
  return data;
}

export const api = {
  get: <T>(path: string, token?: string) => request<T>(path, { method: 'GET' }, token),
  post: <T>(path: string, body: unknown, token?: string) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }, token),
  patch: <T>(path: string, body: unknown, token?: string) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }, token),
  delete: <T>(path: string, token?: string) => request<T>(path, { method: 'DELETE' }, token),
};

// ─── Date range ─────────────────────────────────────────────────────────────

export interface DateRange {
  from?: number; // unix seconds, inclusive
  to?: number;   // unix seconds, exclusive
}

/** Serialises a DateRange to a `?from=&to=` query string (empty when unbounded). */
export function rangeQuery(range?: DateRange): string {
  const params = new URLSearchParams();
  if (range?.from != null) params.set('from', String(range.from));
  if (range?.to != null) params.set('to', String(range.to));
  const s = params.toString();
  return s ? `?${s}` : '';
}

// ─── Admin API ────────────────────────────────────────────────────────────────

export interface AdminStats {
  totalUsers: number;
  totalWorkspaces: number;
  totalThreads: number;
}

export interface AdminUser {
  id: string;
  email: string | null;
  name: string | null;
  onboarded: number;
  created_at: number;
  workspaceCount: number;
  workspaceSlug: string | null;
}

export interface ImpersonateResponse {
  token: string;
  user: { id: string; email: string | null; name: string | null; onboarded: number; created_at: number };
  workspaceSlug: string | null;
}

export interface StitchTestResult {
  op: 'concat' | 'frame';
  outKey: string;
  publicUrl: string;
  mounted: boolean;
  sizeBytes: number;
  ms: number;
  clipCount?: number;
}

export interface StitchTestRequest {
  op: 'concat' | 'frame';
  clipUrls?: string[];
  clipUrl?: string;
  aspectRatio?: '16:9' | '9:16';
}

// ─── Mock Replicate types ─────────────────────────────────────────────────────

export interface MockReplicateConfig {
  enabled: boolean;
  videoUrls: string[];
}

export interface MockReplicateWorkspaceOverride extends MockReplicateConfig {
  workspaceId: string;
  name: string;
  slug: string;
}

export interface MockReplicateResponse {
  global: MockReplicateConfig;
  overrides: MockReplicateWorkspaceOverride[];
}

// ─── Admin API ────────────────────────────────────────────────────────────────

export const adminApi = {
  getStats: (token: string) =>
    request<{ success: boolean; data: AdminStats }>('/api/admin/stats', { method: 'GET' }, token),

  getUsers: (token: string, search?: string) =>
    request<{ success: boolean; data: AdminUser[] }>(
      `/api/admin/users${search ? `?search=${encodeURIComponent(search)}` : ''}`,
      { method: 'GET' },
      token
    ),

  impersonate: (token: string, userId: string) =>
    request<{ success: boolean; data: ImpersonateResponse }>(
      `/api/admin/impersonate/${userId}`,
      { method: 'POST' },
      token
    ),

  getUsage: (token: string, range?: DateRange) =>
    request<{ success: boolean; data: AdminUsageResponse }>(`/api/admin/usage${rangeQuery(range)}`, { method: 'GET' }, token),

  stitchTest: (token: string, req: StitchTestRequest) =>
    request<{ success: boolean; data?: StitchTestResult; message?: string }>(
      '/api/admin/stitch-test',
      { method: 'POST', body: JSON.stringify(req) },
      token,
    ),

  runMigrations: (token: string) =>
    request<{ success: boolean; data?: { messages: string[] }; message?: string }>(
      '/api/admin/migrate',
      { method: 'POST', body: JSON.stringify({}) },
      token,
    ),

  validateReplicateInput: (token: string, req: { modelSlug: string; input: Record<string, unknown> }) =>
    request<{ success: boolean; data?: { valid: boolean; error?: unknown }; message?: string }>(
      '/api/admin/mock-replicate/validate',
      { method: 'POST', body: JSON.stringify(req) },
      token,
    ),

  getMockReplicate: (token: string) =>
    request<{ success: boolean; data?: MockReplicateResponse; message?: string }>(
      '/api/admin/mock-replicate',
      { method: 'GET' },
      token,
    ),

  updateMockReplicate: (token: string, req: { scope: string; enabled: boolean; videoUrls: string[] }) =>
    request<{ success: boolean; message?: string }>(
      '/api/admin/mock-replicate',
      { method: 'PUT', body: JSON.stringify(req) },
      token,
    ),

  deleteMockReplicateOverride: (token: string, workspaceId: string) =>
    request<{ success: boolean; message?: string }>(
      `/api/admin/mock-replicate/${workspaceId}`,
      { method: 'DELETE' },
      token,
    ),
};

// ─── Billing / usage ──────────────────────────────────────────────────────────

export interface ModelUsage {
  model: string | null;
  count: number;
  cost: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface CategoryUsage {
  cost: number;
  count: number;
  inputTokens?: number;
  outputTokens?: number;
  byModel: ModelUsage[];
}

export interface UsageSummary {
  totalCost: number;
  text: CategoryUsage;
  image: CategoryUsage;
  video: CategoryUsage;
}

export interface WorkspaceUsage {
  workspaceId: string;
  name: string;
  slug: string;
  textCost: number;
  imageCost: number;
  videoCost: number;
  totalCost: number;
  messageCount: number;
  imageCount: number;
  videoCount: number;
  inputTokens: number;
  outputTokens: number;
}

export interface AdminUsageUser {
  userId: string;
  email: string | null;
  name: string | null;
  textCost: number;
  imageCost: number;
  videoCost: number;
  totalCost: number;
  messageCount: number;
  imageCount: number;
  videoCount: number;
  inputTokens: number;
  outputTokens: number;
  workspaces: WorkspaceUsage[];
}

export interface AdminUsageResponse {
  totals: {
    totalCost: number;
    textCost: number;
    imageCost: number;
    videoCost: number;
    payingUsers: number;
    messageCount: number;
    imageCount: number;
    videoCount: number;
  };
  users: AdminUsageUser[];
}
