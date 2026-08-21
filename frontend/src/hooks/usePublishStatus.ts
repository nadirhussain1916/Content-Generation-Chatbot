import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuthToken } from './useAuthToken';
import { api } from '../lib/api';
import type { TfResponse, PublishRecord } from '../types';

export type PlatformStatus = 'idle' | 'publishing' | 'processing' | 'done' | 'failed';

const POLL_INTERVAL_MS = 4000;
const POLL_MAX_ATTEMPTS = 30; // 30 × 4s = 2 min max

export function usePublishStatus(slug: string | undefined, assetId: string | undefined) {
  const { getAuthToken: getToken } = useAuthToken();
  const [status, setStatus] = useState<Record<string, PlatformStatus>>({});
  const pollTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const poll = useCallback(async (platform: string, recordId: string, attempt = 0) => {
    if (attempt >= POLL_MAX_ATTEMPTS) {
      setStatus((s) => ({ ...s, [platform]: 'failed' }));
      return;
    }
    const token = await getToken();
    const res = await api.get<TfResponse<PublishRecord>>(
      `/api/workspaces/${slug}/publish/status/${recordId}`,
      token ?? undefined
    );
    if (res.success && res.data) {
      if (res.data.status === 'published') {
        setStatus((s) => ({ ...s, [platform]: 'done' }));
        return;
      }
      if (res.data.status === 'failed') {
        setStatus((s) => ({ ...s, [platform]: 'failed' }));
        return;
      }
    }
    pollTimers.current[platform] = setTimeout(
      () => poll(platform, recordId, attempt + 1),
      POLL_INTERVAL_MS
    );
  }, [slug, getToken]);

  // Load existing records for this asset on mount
  useEffect(() => {
    if (!slug || !assetId) return;
    let cancelled = false;

    (async () => {
      const token = await getToken();
      const res = await api.get<TfResponse<PublishRecord[]>>(
        `/api/workspaces/${slug}/publish/history`,
        token ?? undefined
      );
      if (cancelled || !res.success || !res.data) return;

      const latest: Record<string, PublishRecord> = {};
      for (const r of res.data) {
        if (r.asset_id !== assetId) continue;
        if (!latest[r.platform] || r.created_at > latest[r.platform].created_at) {
          latest[r.platform] = r;
        }
      }

      const restored: Record<string, PlatformStatus> = {};
      for (const [platform, record] of Object.entries(latest)) {
        if (record.status === 'published') restored[platform] = 'done';
        else if (record.status === 'failed') restored[platform] = 'failed';
        else restored[platform] = 'processing';
      }
      if (!cancelled) setStatus(restored);

      // Resume polling for any still-processing record
      for (const [platform, record] of Object.entries(latest)) {
        if ((record.status === 'processing' || record.status === 'pending') && !cancelled) {
          poll(platform, record.id);
        }
      }
    })();

    return () => {
      cancelled = true;
      for (const t of Object.values(pollTimers.current)) clearTimeout(t);
    };
  }, [slug, assetId, getToken, poll]);

  async function publish(
    platform: 'instagram' | 'tiktok',
    body: Record<string, unknown>
  ): Promise<void> {
    if (!slug) return;
    setStatus((s) => ({ ...s, [platform]: 'publishing' }));
    try {
      const token = await getToken();
      const res = await api.post<TfResponse<PublishRecord>>(
        `/api/workspaces/${slug}/publish/${platform}`,
        body,
        token ?? undefined
      );
      if (res.success && res.data) {
        if (res.data.status === 'published') {
          setStatus((s) => ({ ...s, [platform]: 'done' }));
        } else if (res.data.status === 'processing') {
          setStatus((s) => ({ ...s, [platform]: 'processing' }));
          poll(platform, res.data.id);
        } else {
          setStatus((s) => ({ ...s, [platform]: 'failed' }));
        }
      } else {
        setStatus((s) => ({ ...s, [platform]: 'failed' }));
      }
    } catch {
      setStatus((s) => ({ ...s, [platform]: 'failed' }));
    }
  }

  return { status, publish };
}
