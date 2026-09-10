import { useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { adminApi, type StitchTestResult } from '../lib/api';
import AppShell from '../components/AppShell';
import AdminSidebar from '../components/AdminSidebar';
import {
  Film, Image as ImageIcon, Loader2, Play, CheckCircle2, AlertTriangle, ExternalLink, HardDriveDownload,
} from 'lucide-react';
import { cn } from '../lib/utils';

// Two reliable public sample clips (landscape → default 16:9) so the harness is
// one-click. Replace with your own R2/generated clip URLs to test real inputs.
const SAMPLE_CLIPS = [
  'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
  'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
].join('\n');

type Op = 'concat' | 'frame';

function formatBytes(n: number): string {
  if (!n) return '0 B';
  const mb = n / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(2)} MB`;
  return `${(n / 1024).toFixed(1)} KB`;
}

export default function AdminStitchTestPage() {
  const { getToken } = useAuth();

  const [op, setOp] = useState<Op>('concat');
  const [clipsText, setClipsText] = useState<string>(SAMPLE_CLIPS);
  const [frameUrl, setFrameUrl] = useState<string>('');
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16'>('16:9');

  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<StitchTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setResult(null);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');

      const req =
        op === 'concat'
          ? { op, aspectRatio, clipUrls: clipsText.split('\n').map((s) => s.trim()).filter(Boolean) }
          : { op, aspectRatio, clipUrl: frameUrl.trim() };

      const res = await adminApi.stitchTest(token, req);
      if (res.success && res.data) setResult(res.data);
      else setError(res.message ?? 'Stitch test failed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed.');
    } finally {
      setRunning(false);
    }
  }

  return (
    <AppShell>
      <AdminSidebar />

      <main className='flex-1 overflow-y-auto bg-surface-chat/25 backdrop-blur-xl'>
        <div className='max-w-3xl mx-auto px-6 py-8 space-y-5'>
          <div>
            <h1 className='text-heading text-text-primary flex items-center gap-2'>
              <Film size={20} className='text-brand' /> Stitch Test
            </h1>
            <p className='text-meta text-text-secondary mt-0.5'>
              Runs ffmpeg in the container directly on public clip URLs — no model generation, no cost. Verifies the
              live ffmpeg + R2-mount path and reports whether output was written straight to R2.
            </p>
          </div>

          {/* Op toggle */}
          <div className='inline-flex rounded-xl border border-border-soft bg-surface-card p-1'>
            {([
              { id: 'concat', label: 'Concatenate clips', icon: Film },
              { id: 'frame', label: 'Extract last frame', icon: ImageIcon },
            ] as const).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setOp(id)}
                className={cn(
                  'flex items-center gap-2 px-3 py-1.5 rounded-lg text-message font-medium transition-colors',
                  op === id ? 'bg-surface text-text-primary' : 'text-text-secondary hover:text-text-primary',
                )}
              >
                <Icon size={15} /> {label}
              </button>
            ))}
          </div>

          {/* Inputs */}
          <div className='rounded-2xl border border-border-soft bg-surface-card p-4 space-y-4'>
            {op === 'concat' ? (
              <div>
                <label className='text-meta text-text-muted'>Clip URLs (one per line, 2–20)</label>
                <textarea
                  value={clipsText}
                  onChange={(e) => setClipsText(e.target.value)}
                  rows={5}
                  spellCheck={false}
                  placeholder={'https://…/clip-a.mp4\nhttps://…/clip-b.mp4'}
                  className='mt-1 w-full font-mono text-message text-text-primary bg-surface border border-border-soft rounded-xl px-3 py-2 placeholder:text-text-muted focus:outline-none focus:border-brand/50 transition-colors'
                />
              </div>
            ) : (
              <div>
                <label className='text-meta text-text-muted'>Clip URL</label>
                <input
                  value={frameUrl}
                  onChange={(e) => setFrameUrl(e.target.value)}
                  spellCheck={false}
                  placeholder='https://…/clip.mp4'
                  className='mt-1 w-full font-mono text-message text-text-primary bg-surface border border-border-soft rounded-xl px-3 py-2 placeholder:text-text-muted focus:outline-none focus:border-brand/50 transition-colors'
                />
              </div>
            )}

            <div className='flex items-end justify-between gap-3 flex-wrap'>
              <div>
                <label className='text-meta text-text-muted'>Aspect ratio</label>
                <div className='mt-1 inline-flex rounded-xl border border-border-soft bg-surface p-1'>
                  {(['16:9', '9:16'] as const).map((ar) => (
                    <button
                      key={ar}
                      onClick={() => setAspectRatio(ar)}
                      className={cn(
                        'px-3 py-1 rounded-lg text-message font-medium transition-colors',
                        aspectRatio === ar ? 'bg-surface-card text-text-primary' : 'text-text-secondary hover:text-text-primary',
                      )}
                    >
                      {ar}
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={run}
                disabled={running}
                className='flex items-center gap-2 px-4 py-2 rounded-xl bg-ink text-on-ink text-message font-semibold disabled:opacity-60 transition-opacity'
              >
                {running ? <Loader2 size={16} className='animate-spin' /> : <Play size={16} />}
                {running ? 'Running…' : 'Run test'}
              </button>
            </div>

            {running && (
              <p className='text-meta text-text-muted'>
                ffmpeg is downloading + processing the clips in a container. The first run can take ~30–60s while the
                container cold-starts.
              </p>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className='rounded-2xl border border-red-500/30 bg-red-500/5 p-4'>
              <div className='flex items-center gap-2 text-red-500 font-semibold text-message'>
                <AlertTriangle size={16} /> Failed
              </div>
              <pre className='mt-2 text-meta text-text-secondary whitespace-pre-wrap break-words font-mono'>{error}</pre>
            </div>
          )}

          {/* Result */}
          {result && (
            <div className='rounded-2xl border border-border-soft bg-surface-card p-4 space-y-3'>
              <div className='flex items-center gap-2 flex-wrap'>
                <span className='flex items-center gap-1.5 text-green-500 font-semibold text-message'>
                  <CheckCircle2 size={16} /> Success
                </span>
                <span
                  className={cn(
                    'flex items-center gap-1 px-2 py-0.5 rounded-full text-meta font-medium',
                    result.mounted ? 'bg-green-500/10 text-green-500' : 'bg-amber-500/10 text-amber-500',
                  )}
                >
                  <HardDriveDownload size={12} />
                  {result.mounted ? 'Direct-to-R2 mount' : 'Fell back to read-back'}
                </span>
                <span className='text-meta text-text-muted tabular-nums'>{formatBytes(result.sizeBytes)}</span>
                <span className='text-meta text-text-muted tabular-nums'>{(result.ms / 1000).toFixed(1)}s</span>
                {result.clipCount != null && (
                  <span className='text-meta text-text-muted'>{result.clipCount} clips</span>
                )}
              </div>

              <a
                href={result.publicUrl}
                target='_blank'
                rel='noreferrer'
                className='inline-flex items-center gap-1 text-meta text-brand hover:underline break-all font-mono'
              >
                {result.publicUrl} <ExternalLink size={12} className='shrink-0' />
              </a>

              <div className='rounded-xl overflow-hidden border border-border-soft bg-black/40 flex items-center justify-center'>
                {result.op === 'concat' ? (
                  <video src={result.publicUrl} controls className='max-h-[60vh] w-auto' />
                ) : (
                  <img src={result.publicUrl} alt='Extracted frame' className='max-h-[60vh] w-auto' />
                )}
              </div>
            </div>
          )}
        </div>
      </main>
    </AppShell>
  );
}
