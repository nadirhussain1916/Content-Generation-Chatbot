import { MiddlewareHandler } from 'hono';
import type { CloudflareBindings } from '../env';

export function kvRateLimiter(options: {
  windowMs?: number;
  limit?: number;
  message?: string;
  statusCode?: number;
}): MiddlewareHandler<{ Bindings: CloudflareBindings }> {
  const windowMs = options.windowMs ?? 60 * 1000;
  const limit = options.limit ?? 10;
  const message = options.message ?? 'Too many requests, please try again later.';
  const statusCode = (options.statusCode ?? 429) as 429;

  return async (c, next) => {
    const identifier =
      c.req.header('cf-connecting-ip') ||
      c.req.header('x-forwarded-for') ||
      'anonymous';

    const now = Date.now();
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const key = `ratelimit:${identifier}:${windowStart}`;

    const kv = c.env.KV;
    const stored = await kv.get(key);
    const count = stored ? parseInt(stored, 10) : 0;

    if (count >= limit) {
      return c.json({ success: false, message, data: null }, statusCode);
    }

    await kv.put(key, String(count + 1), { expirationTtl: Math.ceil(windowMs / 1000) });
    await next();
  };
}
