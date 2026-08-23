import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

interface ImpersonatedUser {
  id: string;
  email: string | null;
  name: string | null;
  onboarded: number;
  created_at: number;
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
  // Never persist to localStorage — impersonation tokens must die with the tab.
  const [impersonatedUser, setImpersonatedUser] = useState<ImpersonatedUser | null>(null);
  const [impersonationToken, setImpersonationToken] = useState<string | null>(null);

  const startImpersonation = useCallback((user: ImpersonatedUser, token: string) => {
    setImpersonatedUser(user);
    setImpersonationToken(token);
  }, []);

  const stopImpersonation = useCallback(() => {
    setImpersonatedUser(null);
    setImpersonationToken(null);
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
