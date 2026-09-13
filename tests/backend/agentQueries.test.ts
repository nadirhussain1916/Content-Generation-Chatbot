import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock the DB layer ────────────────────────────────────────────────────────
// agentQueries.ts is a thin, SAFE view over db/queries. We mock those helpers so we
// exercise the scoping + field-hygiene logic without a real D1.

const { getAssetMock, getAssetsByThreadMock, getAssetsByWorkspaceMock, getGenerationJobsByAssetMock } = vi.hoisted(() => ({
  getAssetMock: vi.fn(),
  getAssetsByThreadMock: vi.fn(),
  getAssetsByWorkspaceMock: vi.fn(),
  getGenerationJobsByAssetMock: vi.fn(),
}));

vi.mock('../../backend/src/db/queries', () => ({
  getAsset: getAssetMock,
  getAssetsByThread: getAssetsByThreadMock,
  getAssetsByWorkspace: getAssetsByWorkspaceMock,
  getGenerationJobsByAsset: getGenerationJobsByAssetMock,
}));

import { listGenerationsForAgent, getGenerationStatusForAgent } from '../../backend/src/services/agentQueries';

const WS = 'ws-1';
const OTHER_WS = 'ws-2';
const db = {} as never;

/** A full Asset row (with all the internal/sensitive fields the mapper must strip). */
function asset(o: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'a1', thread_id: 't1', workspace_id: WS, message_id: null,
    type: 'video', status: 'ready',
    r2_key: 'ws/t/a1.mp4', public_url: 'https://cdn.example.com/a1.mp4', prompt: 'a lovely sunset',
    prediction_id: 'pred_secret', error_message: null, model: 'lightricks/ltx-2.3-fast',
    cost_usd: 1.1016, generation_method: 'single', stitch_params: '{"secret":true}',
    created_at: Math.floor(Date.now() / 1000) - 3600, // ~1 hour ago
    ...o,
  };
}
const rows = (...a: unknown[]) => ({ results: a });

beforeEach(() => {
  vi.clearAllMocks();
  getAssetsByThreadMock.mockResolvedValue(rows());
  getAssetsByWorkspaceMock.mockResolvedValue(rows());
  getGenerationJobsByAssetMock.mockResolvedValue(rows());
  getAssetMock.mockResolvedValue(null);
});

// ─── list_generations ─────────────────────────────────────────────────────────

describe('listGenerationsForAgent', () => {
  it('defaults to thread scope when a threadId is present, workspace scope otherwise', async () => {
    getAssetsByThreadMock.mockResolvedValue(rows(asset()));
    await listGenerationsForAgent(db, { workspaceId: WS, threadId: 't1' });
    expect(getAssetsByThreadMock).toHaveBeenCalledWith(db, 't1');
    expect(getAssetsByWorkspaceMock).not.toHaveBeenCalled();

    vi.clearAllMocks();
    getAssetsByWorkspaceMock.mockResolvedValue(rows(asset()));
    await listGenerationsForAgent(db, { workspaceId: WS });
    expect(getAssetsByWorkspaceMock).toHaveBeenCalledWith(db, WS, expect.any(Number));
    expect(getAssetsByThreadMock).not.toHaveBeenCalled();
  });

  it('drops rows belonging to another workspace (defense in depth)', async () => {
    getAssetsByThreadMock.mockResolvedValue(rows(asset({ id: 'mine' }), asset({ id: 'theirs', workspace_id: OTHER_WS })));
    const out = await listGenerationsForAgent(db, { workspaceId: WS, threadId: 't1' });
    expect(out.map((g) => g.id)).toEqual(['mine']);
  });

  it('filters by status (generating includes pending) and type', async () => {
    getAssetsByWorkspaceMock.mockResolvedValue(rows(
      asset({ id: 'r', status: 'ready', type: 'video' }),
      asset({ id: 'g', status: 'generating', type: 'video' }),
      asset({ id: 'p', status: 'pending', type: 'video' }),
      asset({ id: 'f', status: 'failed', type: 'image' }),
    ));
    const gen = await listGenerationsForAgent(db, { workspaceId: WS }, { status: 'generating', scope: 'workspace' });
    expect(gen.map((g) => g.id).sort()).toEqual(['g', 'p']);

    getAssetsByWorkspaceMock.mockResolvedValue(rows(
      asset({ id: 'v', type: 'video' }), asset({ id: 'i', type: 'image' }),
    ));
    const imgs = await listGenerationsForAgent(db, { workspaceId: WS }, { type: 'image', scope: 'workspace' });
    expect(imgs.map((g) => g.id)).toEqual(['i']);
  });

  it('caps the limit at 25 and honors a smaller one', async () => {
    getAssetsByWorkspaceMock.mockResolvedValue(rows(...Array.from({ length: 40 }, (_, i) => asset({ id: `a${i}` }))));
    const capped = await listGenerationsForAgent(db, { workspaceId: WS }, { scope: 'workspace', limit: 1000 });
    expect(capped).toHaveLength(25);
    const three = await listGenerationsForAgent(db, { workspaceId: WS }, { scope: 'workspace', limit: 3 });
    expect(three).toHaveLength(3);
  });

  it('never leaks internal/sensitive fields in the summary', async () => {
    getAssetsByThreadMock.mockResolvedValue(rows(asset()));
    const [g] = await listGenerationsForAgent(db, { workspaceId: WS, threadId: 't1' });
    const serialized = JSON.stringify(g);
    for (const leak of ['r2_key', 'prediction_id', 'pred_secret', 'stitch_params', 'cost_usd', '1.1016']) {
      expect(serialized).not.toContain(leak);
    }
    // ...but keeps the useful, safe fields
    expect(g.publicUrl).toBe('https://cdn.example.com/a1.mp4');
    expect(g.promptSnippet).toBe('a lovely sunset');
    expect(g.createdAt).toMatch(/ago|just now/);
  });

  it('omits publicUrl until the asset is ready', async () => {
    getAssetsByThreadMock.mockResolvedValue(rows(asset({ status: 'generating', public_url: 'https://cdn.example.com/a1.mp4' })));
    const [g] = await listGenerationsForAgent(db, { workspaceId: WS, threadId: 't1' });
    expect(g.publicUrl).toBeUndefined();
  });
});

// ─── get_generation_status ────────────────────────────────────────────────────

describe('getGenerationStatusForAgent', () => {
  it('returns null for a missing asset', async () => {
    getAssetMock.mockResolvedValue(null);
    expect(await getGenerationStatusForAgent(db, { workspaceId: WS }, 'nope')).toBeNull();
    expect(getGenerationJobsByAssetMock).not.toHaveBeenCalled();
  });

  it('returns null for an asset in another workspace (scope enforcement)', async () => {
    getAssetMock.mockResolvedValue(asset({ workspace_id: OTHER_WS }));
    expect(await getGenerationStatusForAgent(db, { workspaceId: WS }, 'a1')).toBeNull();
    expect(getGenerationJobsByAssetMock).not.toHaveBeenCalled();
  });

  it('labels chunk / frame / concat jobs and surfaces part errors', async () => {
    getAssetMock.mockResolvedValue(asset({ status: 'generating', generation_method: 'continue' }));
    getGenerationJobsByAssetMock.mockResolvedValue(rows(
      { kind: 'chunk', idx: 0, status: 'succeeded', error_message: null },
      { kind: 'chunk', idx: 1, status: 'failed', error_message: 'part 2: boom' },
      { kind: 'concat', idx: 0, status: 'pending', error_message: null },
      { kind: 'frame', idx: 0, status: 'succeeded', error_message: null },
    ));
    const d = await getGenerationStatusForAgent(db, { workspaceId: WS }, 'a1');
    expect(d).not.toBeNull();
    expect(d!.method).toBe('continue');
    expect(d!.parts).toEqual([
      { label: 'Part 1', status: 'succeeded' },
      { label: 'Part 2', status: 'failed', errorMessage: 'part 2: boom' },
      { label: 'Stitch', status: 'pending' },
      { label: 'Seed frame 1', status: 'succeeded' },
    ]);
  });

  it('never leaks internal/sensitive fields in the detail', async () => {
    getAssetMock.mockResolvedValue(asset());
    getGenerationJobsByAssetMock.mockResolvedValue(rows({ kind: 'chunk', idx: 0, status: 'succeeded', error_message: null }));
    const d = await getGenerationStatusForAgent(db, { workspaceId: WS }, 'a1');
    const serialized = JSON.stringify(d);
    for (const leak of ['r2_key', 'prediction_id', 'pred_secret', 'stitch_params', 'cost_usd', '1.1016']) {
      expect(serialized).not.toContain(leak);
    }
  });
});
