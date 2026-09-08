import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';

interface ImpersonatedUser {
  id: string;
  email: string | null;
  name: string | null;
  onboarded: number;
  created_at: number;
}

// Persist to localStorage so impersonation survives a page refresh AND carries
// across tabs/windows (e.g. opening a workspace link in a new tab). This is safe
// because the impersonation token is HMAC-signed with a hard 1-hour server-side
// expiry (see signImpersonationToken / verifyImpersonationToken on the backend),
// so it cannot outlive that TTL regardless of where it is stored.
const STORAGE_KEY = 'tf.impersonation';

interface PersistedImpersonation {
  user: ImpersonatedUser;
  token: string;
}

function readPersisted(): PersistedImpersonation | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedImpersonation;
    if (!parsed?.user || !parsed?.token) return null;
    return parsed;
  } catch {
    return null;
  }
}

interface ImpersonationContextValue {
  isImpersonating: boolean;
  impersonatedUser: ImpersonatedUser | null;
  /** HMAC-signed token to send as Bearer auth when impersonating. */
  impersonationToken: string | null;
  startImpersonation: (user: ImpersonatedUser, token: string) => void;
  stopImpersonation: () => void;
}

const ImpersonationContext = createContext<ImpersonationContextValue | null>(null);

export function ImpersonationProvider({ children }: { children: ReactNode }) {
  // Rehydrate from localStorage so impersonation persists across refresh and new tabs.
  const persisted = readPersisted();
  const [impersonatedUser, setImpersonatedUser] = useState<ImpersonatedUser | null>(persisted?.user ?? null);
  const [impersonationToken, setImpersonationToken] = useState<string | null>(persisted?.token ?? null);

  const startImpersonation = useCallback((user: ImpersonatedUser, token: string) => {
    setImpersonatedUser(user);
    setImpersonationToken(token);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ user, token }));
    } catch {
      // Ignore storage failures (e.g. private mode); in-memory state still works for this tab.
    }
  }, []);

  const stopImpersonation = useCallback(() => {
    setImpersonatedUser(null);
    setImpersonationToken(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore storage failures.
    }
  }, []);

  // Keep tabs in sync: if impersonation is started/stopped in another tab, mirror
  // that change here. The `storage` event only fires in *other* tabs of the origin.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      const next = readPersisted();
      setImpersonatedUser(next?.user ?? null);
      setImpersonationToken(next?.token ?? null);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return (
    <ImpersonationContext.Provider
      value={{
        isImpersonating: !!impersonatedUser,
        impersonatedUser,
        impersonationToken,
        startImpersonation,
        stopImpersonation,
      }}
    >
      {children}
    </ImpersonationContext.Provider>
  );
}

export function useImpersonation() {
  const ctx = useContext(ImpersonationContext);
  if (!ctx) throw new Error('useImpersonation must be used within ImpersonationProvider');
  return ctx;
}
