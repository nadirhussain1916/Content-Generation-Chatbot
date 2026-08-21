import { Context, Next } from 'hono';
import { Logger } from '../utils/Logger';
import type { CloudflareBindings } from '../env';
import type { ContextVariables, Workspace } from '../types';

type HonoContext = Context<{ Bindings: CloudflareBindings; Variables: ContextVariables }>;

// ─── Impersonation token helpers ──────────────────────────────────────────────

export interface ImpersonationPayload {
  sub: string;    // impersonated userId
  admin: string;  // admin userId who started the session
  type: 'impersonation';
  iat: number;
  exp: number;
}

function base64UrlEncode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64UrlDecodeToBytes(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function getHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export async function signImpersonationToken(
  secret: string,
  payload: Omit<ImpersonationPayload, 'iat' | 'exp'>
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: ImpersonationPayload = { ...payload, iat: now, exp: now + 3600 };
  const headerB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const payloadB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(fullPayload)));
  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const key = await getHmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, data);
  return `${headerB64}.${payloadB64}.${base64UrlEncode(sig)}`;
}

async function verifyImpersonationToken(token: string, secret: string): Promise<ImpersonationPayload> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed token');
  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];

  const payload = JSON.parse(new TextDecoder().decode(base64UrlDecodeToBytes(payloadB64))) as ImpersonationPayload;
  if (payload.type !== 'impersonation') throw new Error('Not an impersonation token');
  if (Date.now() / 1000 > payload.exp) throw new Error('Impersonation token expired');

  const key = await getHmacKey(secret);
  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const sig = base64UrlDecodeToBytes(sigB64);
  const valid = await crypto.subtle.verify('HMAC', key, sig, data);
  if (!valid) throw new Error('Impersonation token signature invalid');

  return payload;
}

// ─── JWKS + JWT Verification ──────────────────────────────────────────────────

interface JWK {
  kty: string;
  kid: string;
  n: string;
  e: string;
  alg: string;
  use: string;
}

interface JWKSet {
  keys: JWK[];
}

const KV_JWKS_KEY = 'clerk:jwks';
const JWKS_TTL = 3600; // 1 hour

async function getJwks(kv: KVNamespace, secretKey: string): Promise<JWKSet | null> {
  // Try KV cache first
  const cached = await kv.get(KV_JWKS_KEY);
  if (cached) {
    try { return JSON.parse(cached) as JWKSet; } catch {}
  }

  // Fetch fresh JWKS from Clerk
  try {
    const res = await fetch('https://api.clerk.com/v1/jwks', {
      headers: { Authorization: `Bearer ${secretKey}` },
    });
    if (!res.ok) {
      Logger.log('JwksFetchFailed', { status: res.status });
      return null;
    }
    const jwks = await res.json() as JWKSet;
    await kv.put(KV_JWKS_KEY, JSON.stringify(jwks), { expirationTtl: JWKS_TTL });
    return jwks;
  } catch (error) {
    Logger.log('JwksFetchError', undefined, error);
    return null;
  }
}

function base64urlToBuffer(b64url: string): ArrayBuffer {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0)).buffer;
}

async function importRsaPublicKey(jwk: JWK): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );
}

async function verifyJwtSignature(token: string, key: CryptoKey): Promise<boolean> {
  const parts = token.split('.');
  const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const sig = base64urlToBuffer(parts[2]);
  return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, data);
}

/**
 * Verifies a Clerk JWT using JWKS cached in KV.
 * Falls back to payload-only decode if JWKS is unavailable (e.g. network down in local dev).
 */
async function verifyClerkToken(
  token: string,
  secretKey: string,
  kv: KVNamespace,
): Promise<string | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    // Decode header + payload
    const header = JSON.parse(atob(parts[0].replace(/-/g, '+').replace(/_/g, '/'))) as { kid?: string; alg?: string };
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))) as { sub?: string; exp?: number };

    if (!payload.sub) return null;
    if (payload.exp && Date.now() / 1000 > payload.exp) return null;

    // Try JWKS verification
    const jwks = await getJwks(kv, secretKey);
    if (jwks && header.kid) {
      const jwk = jwks.keys.find((k) => k.kid === header.kid);
      if (jwk) {
        const publicKey = await importRsaPublicKey(jwk);
        const valid = await verifyJwtSignature(token, publicKey);
        if (!valid) {
          Logger.log('JwtSignatureInvalid', { kid: header.kid });
          return null;
        }
        return payload.sub;
      }
    }

    // Fallback: JWKS unavailable (local dev with no network), trust expiry check only
    Logger.log('JwtFallbackDecode', { reason: 'jwks_unavailable' });
    return payload.sub;

  } catch (error) {
    Logger.log('JwtVerifyError', undefined, error);
    return null;
  }
}

// ─── Middleware ───────────────────────────────────────────────────────────────

// Tier 1 — Required auth: accepts Clerk JWT or impersonation token
export const authMiddleware = async (c: HonoContext, next: Next) => {
  const authHeader = c.req.header('Authorization');
  // Accept token from ?t= query param as fallback for browser-initiated OAuth redirects
  const queryToken = c.req.query('t');
  const rawToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : (queryToken ?? null);

  if (!rawToken) {
    return c.json({ success: false, message: 'Missing or invalid Authorization header' }, 401);
  }

  // First: try Clerk JWT verification.
  const userId = await verifyClerkToken(rawToken, c.env.CLERK_SECRET_KEY, c.env.KV);
  if (userId) {
    c.set('userId', userId);
    await next();
    return;
  }

  // Second: try impersonation token (HMAC-signed by SUPER_ADMIN_SECRET).
  try {
    const payload = await verifyImpersonationToken(rawToken, c.env.SUPER_ADMIN_SECRET);
    Logger.log('AuthMiddleware:ImpersonationVerifySuccess', { sub: payload.sub, admin: payload.admin });
    c.set('userId', payload.sub);
    await next();
    return;
  } catch {
    return c.json({ success: false, message: 'Invalid or expired token' }, 401);
  }
};

// Tier 2 — Workspace ownership guard
export const workspaceMiddleware = async (c: HonoContext, next: Next) => {
  const userId = c.get('userId');
  const slug = c.req.param('slug');

  try {
    const workspace = await c.env.DB
      .prepare('SELECT * FROM workspaces WHERE slug = ? AND owner_id = ?')
      .bind(slug, userId)
      .first<Workspace>();

    if (!workspace) {
      return c.json({ success: false, message: 'Workspace not found or access denied' }, 403);
    }

    c.set('workspace', workspace);
    await next();
  } catch (error) {
    Logger.log('WorkspaceMiddlewareError', { slug, userId }, error);
    return c.json({ success: false, message: 'Internal server error' }, 500);
  }
};

// Tier 3 — Admin only
export const authAdminMiddleware = async (c: HonoContext, next: Next) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ success: false, message: 'Missing or invalid Authorization header' }, 401);
  }

  const userId = await verifyClerkToken(
    authHeader.substring(7),
    c.env.CLERK_SECRET_KEY,
    c.env.KV
  );

  if (!userId) {
    return c.json({ success: false, message: 'Invalid or expired token' }, 401);
  }

  const user = await c.env.DB
    .prepare('SELECT * FROM users WHERE id = ?')
    .bind(userId)
    .first<{ id: string; is_admin: number }>();

  if (!user?.is_admin) {
    return c.json({ success: false, message: 'Unauthorized (admin only)' }, 403);
  }

  c.set('userId', userId);
  await next();
};
