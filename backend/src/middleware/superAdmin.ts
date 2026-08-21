import type { MiddlewareHandler } from 'hono';
import type { CloudflareBindings } from '../env';
import type { ContextVariables } from '../types';
import { Logger } from '../utils/Logger';

const SUPER_ADMIN_EMAIL = 'zaibchahal@gmail.com';
const EMAIL_CACHE_TTL = 3600; // 1 hour

async function getClerkUserEmail(userId: string, secretKey: string, kv: KVNamespace): Promise<string | null> {
  const cacheKey = `admin:email:${userId}`;

  const cached = await kv.get(cacheKey);
  if (cached) return cached;

  try {
    const res = await fetch(`https://api.clerk.com/v1/users/${userId}`, {
      headers: { Authorization: `Bearer ${secretKey}` },
    });
    if (!res.ok) {
      Logger.log('SuperAdmin:ClerkFetchFailed', { userId, status: res.status });
      return null;
    }

    const data = await res.json() as {
      primary_email_address_id?: string;
      email_addresses?: { id: string; email_address: string }[];
    };

    const primary = data.email_addresses?.find(
      (e) => e.id === data.primary_email_address_id
    );
    const email = primary?.email_address ?? null;

    if (email) {
      await kv.put(cacheKey, email, { expirationTtl: EMAIL_CACHE_TTL });
    }
    return email;
  } catch (error) {
    Logger.log('SuperAdmin:ClerkFetchError', { userId }, error);
    return null;
  }
}

/**
 * Guards a route to the single hardcoded super-admin email.
 * Must run after authMiddleware (userId must already be set on context).
 * Uses the Clerk Management API to resolve the email — no DB flag required.
 */
export const superAdminMiddleware: MiddlewareHandler<{
  Bindings: CloudflareBindings;
  Variables: ContextVariables;
}> = async (c, next) => {
  const userId = c.get('userId');
  if (!userId) {
    return c.json({ success: false, message: 'Unauthorized' }, 401);
  }

  const email = await getClerkUserEmail(userId, c.env.CLERK_SECRET_KEY, c.env.KV);

  if (email !== SUPER_ADMIN_EMAIL) {
    return c.json({ success: false, message: 'Forbidden: super admin only' }, 403);
  }

  await next();
};
