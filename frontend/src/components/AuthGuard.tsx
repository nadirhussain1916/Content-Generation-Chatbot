import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@clerk/clerk-react';
import { api } from '../lib/api';
import type { TfResponse } from '../types';

interface BootstrapData {
  onboarded: boolean;
  workspaceSlug: string | null;
}

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const { getToken, isLoaded } = useAuth();
  const navigate = useNavigate();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!isLoaded) return;
    (async () => {
      const token = await getToken();
      const res = await api.post<TfResponse<BootstrapData>>('/api/onboarding/bootstrap', {}, token ?? undefined);
      if (res.success && res.data) {
        if (!res.data.onboarded) {
          navigate('/onboarding', { replace: true });
          return;
        }
      }
      setChecked(true);
    })();
  }, [isLoaded]);

  if (!checked) {
    return (
      <div className='flex h-screen items-center justify-center bg-gray-950'>
        <div className='animate-spin h-8 w-8 rounded-full border-2 border-violet-500 border-t-transparent' />
      </div>
    );
  }

  return <>{children}</>;
}
