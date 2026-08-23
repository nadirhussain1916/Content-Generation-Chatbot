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
};
