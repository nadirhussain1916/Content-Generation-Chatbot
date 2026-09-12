import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { adminApi, type MockReplicateConfig, type MockReplicateWorkspaceOverride } from '../lib/api';
import AppShell from '../components/AppShell';
import AdminSidebar from '../components/AdminSidebar';
import {
  FlaskConical,
  Loader2,
  Save,
  Trash2,
  Plus,
  CheckCircle2,
  AlertTriangle,
  Globe,
  Building2,
  ChevronDown,
  ChevronUp,
  ShieldCheck,
  HardDrive,
} from 'lucide-react';
import { cn } from '../lib/utils';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseUrls(raw: string): string[] {
  return raw
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

function serializeUrls(urls: string[]): string {
  return urls.join('\n');
}

// ─── Scope editor card ────────────────────────────────────────────────────────
// Shared between the global default and each workspace override.

interface ScopeCardProps {
  label: string;
  sublabel?: string;
  scope: string; // 'global' or workspace id
  initial: MockReplicateConfig;
  getToken: () => Promise<string | null>;
  onSave: (cfg: { scope: string; enabled: boolean; videoUrls: string[] }) => Promise<void>;
  onDelete?: () => Promise<void>;
  defaultOpen?: boolean;
}

function ScopeCard({ label, sublabel, scope, initial, getToken, onSave, onDelete, defaultOpen = false }: ScopeCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [urlsText, setUrlsText] = useState<string>(serializeUrls(initial.videoUrls));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [loadingR2, setLoadingR2] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setFeedback(null);
    try {
      await onSave({ scope, enabled, videoUrls: parseUrls(urlsText) });
      setFeedback({ ok: true, msg: 'Saved.' });
    } catch (err) {
      setFeedback({ ok: false, msg: err instanceof Error ? err.message : 'Save failed.' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete) return;
    if (!window.confirm(`Remove workspace override for "${label}"? It will fall back to the global default.`)) return;
    setDeleting(true);
    setFeedback(null);
    try {
      await onDelete();
    } catch (err) {
      setFeedback({ ok: false, msg: err instanceof Error ? err.message : 'Delete failed.' });
      setDeleting(false);
    }
  };

  const handleLoadFromR2 = async () => {
    setLoadingR2(true);
    setFeedback(null);
    try {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      const res = await adminApi.getMockReplicateR2Videos(token, scope);
      if (!res.success || !res.data) throw new Error(res.message ?? 'Failed to load R2 videos');
      const { urls } = res.data;
      if (urls.length === 0) {
        setFeedback({ ok: false, msg: 'No ready videos found in R2 for this scope.' });
        return;
      }
      // Replace the textarea with the fetched URLs (keeps any FAIL sentinels the user typed)
      const existing = parseUrls(urlsText).filter((u) => /^FAIL/i.test(u));
      setUrlsText(serializeUrls([...urls, ...existing]));
      setFeedback({ ok: true, msg: `Loaded ${urls.length} video${urls.length !== 1 ? 's' : ''} from R2.` });
    } catch (err) {
      setFeedback({ ok: false, msg: err instanceof Error ? err.message : 'Load failed.' });
    } finally {
      setLoadingR2(false);
    }
  };

  return (
    <div className='rounded-2xl border border-border-soft bg-surface-card overflow-hidden'>
      {/* Header */}
      <button
        onClick={() => setOpen((o) => !o)}
        className='w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface/40 transition-colors text-left'
      >
        <div className='flex items-center gap-2.5 min-w-0'>
          <span
            className={cn(
              'w-2 h-2 rounded-full flex-shrink-0',
              enabled ? 'bg-amber-400' : 'bg-text-muted/30',
            )}
          />
          <span className='text-message font-medium text-text-primary truncate'>{label}</span>
          {sublabel && <span className='text-meta text-text-muted font-mono truncate'>{sublabel}</span>}
          <span
            className={cn(
              'ml-1 px-1.5 py-0.5 rounded-md text-meta font-semibold flex-shrink-0',
              enabled ? 'bg-amber-400/15 text-amber-500' : 'bg-surface text-text-muted',
            )}
          >
            {enabled ? 'MOCK ON' : 'off'}
          </span>
        </div>
        <div className='flex items-center gap-2 flex-shrink-0'>
          {onDelete && (
            <button
              onClick={(e) => { e.stopPropagation(); handleDelete(); }}
              disabled={deleting}
              className='p-1.5 rounded-lg text-text-muted hover:text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-50'
              title='Remove workspace override'
            >
              {deleting ? <Loader2 size={14} className='animate-spin' /> : <Trash2 size={14} />}
            </button>
          )}
          {open ? <ChevronUp size={16} className='text-text-muted' /> : <ChevronDown size={16} className='text-text-muted' />}
        </div>
      </button>

      {/* Body */}
      {open && (
        <div className='border-t border-border-soft px-4 py-4 space-y-4'>
          {/* Toggle */}
          <div className='flex items-center justify-between'>
            <div>
              <p className='text-message font-medium text-text-primary'>Enable mock</p>
              <p className='text-meta text-text-muted mt-0.5'>
                All Replicate calls for this scope return mock videos from the pool below.
              </p>
            </div>
            <button
              onClick={() => setEnabled((e) => !e)}
              className={cn(
                'relative inline-flex w-11 h-6 rounded-full transition-colors focus:outline-none',
                enabled ? 'bg-amber-400' : 'bg-border-soft',
              )}
              role='switch'
              aria-checked={enabled}
            >
              <span
                className={cn(
                  'inline-block w-5 h-5 rounded-full bg-white shadow translate-y-0.5 transition-transform',
                  enabled ? 'translate-x-5' : 'translate-x-0.5',
                )}
              />
            </button>
          </div>

          {/* Video URL pool */}
          <div>
            <div className='flex items-center justify-between mb-1'>
              <label className='text-meta text-text-muted'>
                Video URL pool <span className='text-text-muted/60'>(one per line)</span>
              </label>
              <button
                onClick={handleLoadFromR2}
                disabled={loadingR2}
                className='flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface border border-border-soft text-meta text-text-secondary hover:text-text-primary hover:bg-surface/60 transition-colors disabled:opacity-50'
                title='Fetch ready R2 videos for this scope and fill the pool'
              >
                {loadingR2
                  ? <Loader2 size={13} className='animate-spin' />
                  : <HardDrive size={13} />}
                {loadingR2 ? 'Loading…' : 'Load from R2'}
              </button>
            </div>
            <textarea
              value={urlsText}
              onChange={(e) => setUrlsText(e.target.value)}
              rows={5}
              spellCheck={false}
              placeholder={[
                'https://your-r2-bucket.example.com/workspace/thread/asset.mp4',
                '# Empty = auto-pick from existing ready videos',
                '# FAIL           → forces a failed prediction',
                '# FAIL: <reason> → failed with custom message',
              ].join('\n')}
              className='w-full font-mono text-meta text-text-primary bg-surface border border-border-soft rounded-xl px-3 py-2 placeholder:text-text-muted/50 focus:outline-none focus:border-brand/50 transition-colors resize-y'
            />
            <p className='mt-1 text-meta text-text-muted/70'>
              Round-robin across the pool so chain/stitch flows get distinct clips.
              Use <code className='font-mono text-brand'>FAIL</code> or{' '}
              <code className='font-mono text-brand'>FAIL: reason</code> to force a failed prediction.
            </p>
          </div>

          {/* Save button + feedback */}
          <div className='flex items-center gap-3'>
            <button
              onClick={handleSave}
              disabled={saving}
              className='flex items-center gap-2 px-4 py-2 rounded-xl bg-ink text-on-ink text-message font-semibold disabled:opacity-60 transition-opacity'
            >
              {saving ? <Loader2 size={16} className='animate-spin' /> : <Save size={16} />}
              {saving ? 'Saving…' : 'Save'}
            </button>
            {feedback && (
              <span className={cn('text-message flex items-center gap-1.5', feedback.ok ? 'text-green-500' : 'text-red-500')}>
                {feedback.ok ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
                {feedback.msg}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Validation tester ────────────────────────────────────────────────────────
// Tests a payload against our local validation schema without calling Replicate.
// Use this to verify a request is correct BEFORE it costs a credit.

const SUPPORTED_MODELS = [
  'lightricks/ltx-2.3-fast',
  'lightricks/ltx-2.3-pro',
  'bytedance/seedance-2.0',
  'bytedance/seedance-2.0-fast',
  'wan-video/wan-2.7-t2v',
  'wan-video/wan-2.7-i2v',
  'google/veo-2',
] as const;

const EXAMPLE_INPUTS: Record<string, string> = {
  'lightricks/ltx-2.3-fast': JSON.stringify({ prompt: 'A cat walking on a rooftop at sunset', aspect_ratio: '9:16', duration: 6 }, null, 2),
  'lightricks/ltx-2.3-pro': JSON.stringify({ task: 'text_to_video', prompt: 'Timelapse of clouds over a mountain', aspect_ratio: '16:9', duration: 6 }, null, 2),
  'bytedance/seedance-2.0': JSON.stringify({ prompt: 'A surfer riding a wave', aspect_ratio: '16:9', duration: 5 }, null, 2),
  'bytedance/seedance-2.0-fast': JSON.stringify({ prompt: 'A surfer riding a wave', aspect_ratio: '16:9', duration: 5 }, null, 2),
  'wan-video/wan-2.7-t2v': JSON.stringify({ prompt: 'Cherry blossoms falling in a park', aspect_ratio: '9:16', duration: 5 }, null, 2),
  'wan-video/wan-2.7-i2v': JSON.stringify({ prompt: 'The character waves hello', first_frame: 'https://example.com/frame.jpg', aspect_ratio: '9:16', duration: 5 }, null, 2),
  'google/veo-2': JSON.stringify({ prompt: 'A dog chasing a frisbee in slow motion', aspect_ratio: '16:9', duration: 5 }, null, 2),
};

interface ValidationResult {
  valid: boolean;
  error?: {
    detail: string;
    status: number;
    title: string;
    invalid_fields: Array<{ type: string; field: string; description: string }>;
  };
}

function ValidationTester() {
  const { getToken } = useAuth();
  const [modelSlug, setModelSlug] = useState<string>(SUPPORTED_MODELS[0]);
  const [inputText, setInputText] = useState<string>(EXAMPLE_INPUTS[SUPPORTED_MODELS[0]]);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  const handleModelChange = (slug: string) => {
    setModelSlug(slug);
    setInputText(EXAMPLE_INPUTS[slug] ?? '{}');
    setResult(null);
    setParseError(null);
  };

  const validate = async () => {
    setParseError(null);
    setResult(null);

    let input: Record<string, unknown>;
    try {
      input = JSON.parse(inputText) as Record<string, unknown>;
    } catch {
      setParseError('Invalid JSON — fix the input and try again.');
      return;
    }

    setRunning(true);
    try {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      const res = await adminApi.validateReplicateInput(token, { modelSlug, input });
      if (!res.success) throw new Error(res.message ?? 'Validation endpoint failed');
      setResult(res.data as ValidationResult);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Request failed.');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className='rounded-2xl border border-border-soft bg-surface-card p-4 space-y-4'>
      {/* Model selector */}
      <div>
        <label className='text-meta text-text-muted block mb-1'>Model</label>
        <select
          value={modelSlug}
          onChange={(e) => handleModelChange(e.target.value)}
          className='w-full font-mono text-message text-text-primary bg-surface border border-border-soft rounded-xl px-3 py-2 focus:outline-none focus:border-brand/50 transition-colors'
        >
          {SUPPORTED_MODELS.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>

      {/* Input JSON */}
      <div>
        <label className='text-meta text-text-muted block mb-1'>
          Input <span className='text-text-muted/60'>(JSON — the object you'd send as Replicate's <code className='font-mono text-brand'>input</code> field)</span>
        </label>
        <textarea
          value={inputText}
          onChange={(e) => { setInputText(e.target.value); setResult(null); setParseError(null); }}
          rows={10}
          spellCheck={false}
          className='w-full font-mono text-meta text-text-primary bg-surface border border-border-soft rounded-xl px-3 py-2 placeholder:text-text-muted focus:outline-none focus:border-brand/50 transition-colors resize-y'
        />
      </div>

      {/* Run */}
      <div className='flex items-center gap-3 flex-wrap'>
        <button
          onClick={validate}
          disabled={running}
          className='flex items-center gap-2 px-4 py-2 rounded-xl bg-ink text-on-ink text-message font-semibold disabled:opacity-60 transition-opacity'
        >
          {running ? <Loader2 size={16} className='animate-spin' /> : <ShieldCheck size={16} />}
          {running ? 'Validating…' : 'Validate (no API call)'}
        </button>
        <p className='text-meta text-text-muted'>No request is sent to Replicate. Zero cost.</p>
      </div>

      {/* Parse error */}
      {parseError && (
        <div className='flex items-start gap-2 text-red-500 text-message'>
          <AlertTriangle size={15} className='mt-0.5 flex-shrink-0' /> {parseError}
        </div>
      )}

      {/* Result */}
      {result && (
        <div className={cn(
          'rounded-xl border p-4 space-y-3',
          result.valid
            ? 'border-green-500/30 bg-green-500/5'
            : 'border-red-500/30 bg-red-500/5',
        )}>
          <div className={cn('flex items-center gap-2 font-semibold text-message', result.valid ? 'text-green-500' : 'text-red-500')}>
            {result.valid
              ? <><CheckCircle2 size={16} /> Valid — this input would be accepted by Replicate</>
              : <><AlertTriangle size={16} /> Invalid — Replicate would return 422</>}
          </div>

          {!result.valid && result.error && (
            <div className='space-y-2'>
              <p className='text-meta text-text-muted font-mono'>{result.error.title}</p>
              <ul className='space-y-1'>
                {result.error.invalid_fields.map((f, i) => (
                  <li key={i} className='text-meta text-red-400 font-mono flex gap-2'>
                    <span className='text-red-500/60'>[{f.type}]</span>
                    <span className='text-brand'>{f.field}</span>
                    <span>—</span>
                    <span>{f.description}</span>
                  </li>
                ))}
              </ul>
              <details className='text-meta'>
                <summary className='cursor-pointer text-text-muted hover:text-text-primary'>Raw 422 body</summary>
                <pre className='mt-2 p-3 rounded-lg bg-surface font-mono text-text-secondary text-xs whitespace-pre-wrap break-all'>
                  {JSON.stringify(result.error, null, 2)}
                </pre>
              </details>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Add override form ────────────────────────────────────────────────────────

interface AddOverrideFormProps {
  onAdd: (scope: string) => void;
}

function AddOverrideForm({ onAdd }: AddOverrideFormProps) {
  const [value, setValue] = useState('');
  return (
    <div className='flex items-center gap-2'>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder='Workspace ID'
        spellCheck={false}
        className='flex-1 font-mono text-message text-text-primary bg-surface border border-border-soft rounded-xl px-3 py-2 placeholder:text-text-muted focus:outline-none focus:border-brand/50 transition-colors'
      />
      <button
        onClick={() => {
          const id = value.trim();
          if (!id) return;
          onAdd(id);
          setValue('');
        }}
        className='flex items-center gap-1.5 px-3 py-2 rounded-xl bg-surface-card border border-border-soft text-message text-text-primary hover:bg-surface/60 transition-colors'
      >
        <Plus size={15} /> Add override
      </button>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminMockPage() {
  const { getToken } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [globalCfg, setGlobalCfg] = useState<MockReplicateConfig>({ enabled: false, videoUrls: [] });
  const [overrides, setOverrides] = useState<MockReplicateWorkspaceOverride[]>([]);
  // Workspace overrides pending save (added via "Add override" but not yet fetched)
  const [pendingOverrides, setPendingOverrides] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      const res = await adminApi.getMockReplicate(token);
      if (!res.success || !res.data) throw new Error(res.message ?? 'Failed to load config');
      setGlobalCfg(res.data.global);
      setOverrides(res.data.overrides);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed.');
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => { load(); }, [load]);

  const save = async (cfg: { scope: string; enabled: boolean; videoUrls: string[] }) => {
    const token = await getToken();
    if (!token) throw new Error('Not authenticated');
    const res = await adminApi.updateMockReplicate(token, cfg);
    if (!res.success) throw new Error(res.message ?? 'Save failed');
    // Refresh overrides after saving a workspace scope
    if (cfg.scope !== 'global') await load();
  };

  const deleteOverride = async (workspaceId: string) => {
    const token = await getToken();
    if (!token) throw new Error('Not authenticated');
    const res = await adminApi.deleteMockReplicateOverride(token, workspaceId);
    if (!res.success) throw new Error(res.message ?? 'Delete failed');
    setOverrides((prev) => prev.filter((o) => o.workspaceId !== workspaceId));
    setPendingOverrides((prev) => prev.filter((id) => id !== workspaceId));
  };

  const addPendingOverride = (workspaceId: string) => {
    if (
      overrides.some((o) => o.workspaceId === workspaceId) ||
      pendingOverrides.includes(workspaceId)
    ) return;
    setPendingOverrides((prev) => [...prev, workspaceId]);
  };

  return (
    <AppShell>
      <AdminSidebar />

      <main className='flex-1 overflow-y-auto bg-surface-chat/25 backdrop-blur-xl'>
        <div className='max-w-3xl mx-auto px-6 py-8 space-y-6'>
          {/* Header */}
          <div>
            <h1 className='text-heading text-text-primary flex items-center gap-2'>
              <FlaskConical size={20} className='text-brand' /> Mock Replicate
            </h1>
            <p className='text-meta text-text-secondary mt-0.5'>
              Short-circuit Replicate calls and return R2-hosted videos for end-to-end testing.
              Supports per-workspace overrides with a global default fallback.
            </p>
          </div>

          {loading && (
            <div className='flex items-center gap-2 text-text-muted text-message'>
              <Loader2 size={16} className='animate-spin' /> Loading config…
            </div>
          )}

          {error && (
            <div className='rounded-2xl border border-red-500/30 bg-red-500/5 p-4'>
              <div className='flex items-center gap-2 text-red-500 font-semibold text-message'>
                <AlertTriangle size={16} /> Error
              </div>
              <p className='mt-1 text-meta text-text-secondary'>{error}</p>
            </div>
          )}

          {/* Validation tester — always visible (no mock toggle required) */}
          <section className='space-y-2'>
            <div className='flex items-center gap-2 text-message font-semibold text-text-primary'>
              <ShieldCheck size={16} className='text-text-muted' /> Pre-flight validation
            </div>
            <p className='text-meta text-text-muted -mt-1'>
              Test whether a Replicate input payload is valid without making an API call.
              The same check runs automatically before every real generation — catching mistakes
              before they cost a credit.
            </p>
            <ValidationTester />
          </section>

          {!loading && !error && (
            <>
              {/* Global default */}
              <section className='space-y-2'>
                <div className='flex items-center gap-2 text-message font-semibold text-text-primary'>
                  <Globe size={16} className='text-text-muted' /> Global default
                </div>
                <ScopeCard
                  label='Global'
                  sublabel='applies when no workspace override exists'
                  scope='global'
                  initial={globalCfg}
                  getToken={getToken}
                  onSave={async (cfg) => {
                    await save(cfg);
                    setGlobalCfg({ enabled: cfg.enabled, videoUrls: cfg.videoUrls });
                  }}
                  defaultOpen
                />
              </section>

              {/* Per-workspace overrides */}
              <section className='space-y-2'>
                <div className='flex items-center gap-2 text-message font-semibold text-text-primary'>
                  <Building2 size={16} className='text-text-muted' /> Workspace overrides
                  <span className='text-meta text-text-muted font-normal'>
                    — each workspace can enable/disable independently
                  </span>
                </div>

                {overrides.length === 0 && pendingOverrides.length === 0 && (
                  <p className='text-meta text-text-muted'>
                    No workspace overrides. All workspaces use the global default.
                  </p>
                )}

                {overrides.map((o) => (
                  <ScopeCard
                    key={o.workspaceId}
                    label={o.name !== o.workspaceId ? o.name : o.workspaceId}
                    sublabel={o.name !== o.workspaceId ? o.slug : undefined}
                    scope={o.workspaceId}
                    initial={o}
                    getToken={getToken}
                    onSave={save}
                    onDelete={() => deleteOverride(o.workspaceId)}
                  />
                ))}

                {pendingOverrides.map((id) => (
                  <ScopeCard
                    key={id}
                    label={id}
                    scope={id}
                    initial={{ enabled: false, videoUrls: [] }}
                    getToken={getToken}
                    onSave={save}
                    onDelete={() => deleteOverride(id)}
                    defaultOpen
                  />
                ))}

                <AddOverrideForm onAdd={addPendingOverride} />
              </section>
            </>
          )}
        </div>
      </main>
    </AppShell>
  );
}
