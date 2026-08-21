import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@clerk/clerk-react';
import { useAuthToken } from '../hooks/useAuthToken';
import { api } from '../lib/api';
import type { TfResponse } from '../types';

interface BootstrapData {
  onboarded: boolean;
  workspaceSlug: string | null;
}

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isLoaded } = useAuth();
  const { getAuthToken } = useAuthToken();
  const navigate = useNavigate();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!isLoaded) return;
    (async () => {
      const token = await getAuthToken();
      const res = await api.post<TfResponse<BootstrapData>>('/api/onboarding/bootstrap', {}, token ?? undefined);
      if (res.success && res.data) {
        // Redirect to onboarding only when the user has NO workspace yet.
        // Having a workspace is the true "onboarded" signal — the DB flag
        // can lag if a previous session was interrupted.
        if (!res.data.workspaceSlug && !res.data.onboarded) {
          navigate('/onboarding', { replace: true });
          return;
        }
      }
      setChecked(true);
    })();
  }, [isLoaded]);

  if (!checked) {
    return (
      <div className='flex h-screen items-center justify-center bg-surface'>
        <div className='animate-spin h-8 w-8 rounded-full border-2 border-ink border-t-transparent' />
      </div>
    );
  }

  return <>{children}</>;
}
