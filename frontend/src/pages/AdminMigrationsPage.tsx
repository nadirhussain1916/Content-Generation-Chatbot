import { useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { adminApi } from '../lib/api';
import AppShell from '../components/AppShell';
import AdminSidebar from '../components/AdminSidebar';
import { Database, Loader2, Play, CheckCircle2, AlertTriangle } from 'lucide-react';

export default function AdminMigrationsPage() {
  const { getToken } = useAuth();

  const [running, setRunning] = useState(false);
  const [messages, setMessages] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!window.confirm('Run all pending database migrations against production?')) return;
    setRunning(true);
    setMessages(null);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      const res = await adminApi.runMigrations(token);
      if (res.success && res.data) setMessages(res.data.messages);
      else setError(res.message ?? 'Migration failed.');
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
              <Database size={20} className='text-brand' /> Migrations
            </h1>
            <p className='text-meta text-text-secondary mt-0.5'>
              Runs all pending D1 schema migrations. Migrations are idempotent — running again when everything is
              already applied is a safe no-op.
            </p>
          </div>

          <div className='rounded-2xl border border-border-soft bg-surface-card p-4 space-y-4'>
            <button
              onClick={run}
              disabled={running}
              className='flex items-center gap-2 px-4 py-2 rounded-xl bg-ink text-on-ink text-message font-semibold disabled:opacity-60 transition-opacity'
            >
              {running ? <Loader2 size={16} className='animate-spin' /> : <Play size={16} />}
              {running ? 'Running…' : 'Run migrations'}
            </button>

            {running && <p className='text-meta text-text-muted'>Applying migrations…</p>}
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
          {messages && (
            <div className='rounded-2xl border border-border-soft bg-surface-card p-4 space-y-2'>
              <div className='flex items-center gap-1.5 text-green-500 font-semibold text-message'>
                <CheckCircle2 size={16} /> Done · {messages.length} step{messages.length === 1 ? '' : 's'}
              </div>
              <ul className='space-y-1'>
                {messages.map((m, i) => (
                  <li key={i} className='text-meta text-text-secondary font-mono break-words'>
                    {m}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </main>
    </AppShell>
  );
}
