import { useAuth } from '@clerk/clerk-react';
import { useImpersonation } from '../context/ImpersonationContext';

/**
 * Drop-in replacement for Clerk's getToken() that transparently returns
 * the impersonation token when an admin is impersonating a user.
 */
export function useAuthToken() {
  const { getToken } = useAuth();
  const { isImpersonating, impersonationToken } = useImpersonation();

  const getAuthToken = async (): Promise<string | null> => {
    if (isImpersonating && impersonationToken) return impersonationToken;
    return getToken();
  };

  return { getAuthToken };
}
