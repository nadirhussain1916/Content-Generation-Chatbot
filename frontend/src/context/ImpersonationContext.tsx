import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

interface ImpersonatedUser {
  id: string;
  email: string | null;
  name: string | null;
  onboarded: number;
  created_at: number;
}

// Persist to sessionStorage (not localStorage) so impersonation survives a page
// refresh but still dies when the tab is closed — the token must not outlive the tab.
const STORAGE_KEY = 'tf.impersonation';

interface PersistedImpersonation {
  user: ImpersonatedUser;
  token: string;
}

function readPersisted(): PersistedImpersonation | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
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
  // Rehydrate from sessionStorage so impersonation persists across refresh (but not tab close).
  const persisted = readPersisted();
  const [impersonatedUser, setImpersonatedUser] = useState<ImpersonatedUser | null>(persisted?.user ?? null);
  const [impersonationToken, setImpersonationToken] = useState<string | null>(persisted?.token ?? null);

  const startImpersonation = useCallback((user: ImpersonatedUser, token: string) => {
    setImpersonatedUser(user);
    setImpersonationToken(token);
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ user, token }));
    } catch {
      // Ignore storage failures (e.g. private mode); in-memory state still works for this tab.
    }
  }, []);

  const stopImpersonation = useCallback(() => {
    setImpersonatedUser(null);
    setImpersonationToken(null);
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore storage failures.
    }
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
