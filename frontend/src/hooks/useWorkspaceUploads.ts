import { useState, useEffect, useCallback } from 'react';
import type { TfResponse, WorkspaceUpload } from '../types';

const BASE = import.meta.env.VITE_API_BASE_URL ?? '';

export function useWorkspaceUploads(
  slug: string | undefined,
  getToken: () => Promise<string | null>
) {
  const [uploads, setUploads] = useState<WorkspaceUpload[]>([]);
  const [uploading, setUploading] = useState(false);

  const fetchUploads = useCallback(async () => {
    if (!slug) return;
    try {
      const token = await getToken();
      const res = await fetch(`${BASE}/api/workspaces/${slug}/uploads`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json() as TfResponse<WorkspaceUpload[]>;
      if (data.success && data.data) {
        setUploads(data.data);
      }
    } catch {
      // silently fail — uploads are non-critical
    }
  }, [slug, getToken]);

  useEffect(() => {
    fetchUploads();
  }, [fetchUploads]);

  const uploadFile = useCallback(async (file: File, threadId?: string): Promise<WorkspaceUpload> => {
    if (!slug) throw new Error('No workspace slug');
    setUploading(true);
    try {
      const token = await getToken();
      const formData = new FormData();
      formData.append('file', file);
      if (threadId) formData.append('threadId', threadId);

      // Use raw fetch — NOT api.post() — to avoid overriding Content-Type for multipart
      const res = await fetch(`${BASE}/api/workspaces/${slug}/uploads`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      const data = await res.json() as TfResponse<WorkspaceUpload>;
      if (!data.success || !data.data) {
        throw new Error(data.message ?? 'Upload failed');
      }
      setUploads((prev) => [data.data!, ...prev]);
      return data.data;
    } finally {
      setUploading(false);
    }
  }, [slug, getToken]);

  const deleteUpload = useCallback(async (id: string): Promise<void> => {
    if (!slug) return;
    try {
      const token = await getToken();
      await fetch(`${BASE}/api/workspaces/${slug}/uploads/${id}`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      setUploads((prev) => prev.filter((u) => u.id !== id));
    } catch {
      // silently fail
    }
  }, [slug, getToken]);

  return { uploads, uploading, uploadFile, deleteUpload, refetch: fetchUploads };
}
