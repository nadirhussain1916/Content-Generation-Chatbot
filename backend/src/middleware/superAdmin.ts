import type { MiddlewareHandler } from 'hono';
import type { CloudflareBindings } from '../env';
import type { ContextVariables } from '../types';
import { Logger } from '../utils/Logger';

const SUPER_ADMIN_EMAIL = 'zaibchahal@gmail.com';

/**
 * Guards a route to the single hardcoded super-admin email.
 * Must run after authMiddleware (userId must already be set on context).
 * Reads email from the users table (populated by the bootstrap endpoint).
 * Falls back to the Clerk Management API on first login before email is stored.
 */
export const superAdminMiddleware: MiddlewareHandler<{
  Bindings: CloudflareBindings;
  Variables: ContextVariables;
}> = async (c, next) => {
  const userId = c.get('userId');
  if (!userId) {
    return c.json({ success: false, message: 'Unauthorized' }, 401);
  }

  // Primary: read email from DB (stored on bootstrap).
  const row = await c.env.DB
    .prepare('SELECT email FROM users WHERE id = ?')
    .bind(userId)
    .first<{ email: string | null }>();

  let email = row?.email ?? null;

  // Fallback: fetch from Clerk API if not yet stored (first login after migration).
  if (!email) {
    try {
      const res = await fetch(`https://api.clerk.com/v1/users/${userId}`, {
        headers: { Authorization: `Bearer ${c.env.CLERK_SECRET_KEY}` },
      });
      if (res.ok) {
        const data = await res.json() as {
          primary_email_address_id?: string;
          email_addresses?: { id: string; email_address: string }[];
        };
        const primary = data.email_addresses?.find(
          (e) => e.id === data.primary_email_address_id
        );
        email = primary?.email_address ?? null;
      }
    } catch (error) {
      Logger.log('SuperAdmin:ClerkFetchError', { userId }, error);
    }
  }

  if (email !== SUPER_ADMIN_EMAIL) {
    return c.json({ success: false, message: 'Forbidden: super admin only' }, 403);
  }

  await next();
};
