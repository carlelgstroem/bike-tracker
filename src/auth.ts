import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config/index.js';

/**
 * Cookie-session auth: a real in-page login form (no browser Basic-auth popup).
 *
 * Single user, so "logged in" just means "proved knowledge of AUTH_PASSWORD".
 * We set an HMAC-signed, HttpOnly cookie; the secret is the password itself, so
 * changing the password invalidates existing sessions. Enabled only when
 * AUTH_PASSWORD is set (index.ts refuses to bind a public host without it).
 */

export const authEnabled = config.auth.password !== '';

const COOKIE = 'munin_session';
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SECRET = config.auth.password;

/** Constant-time compare via fixed-length hashes (avoids length leaks). */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

function sign(value: string): string {
  return createHmac('sha256', SECRET).update(value).digest('base64url');
}

function makeToken(): string {
  const exp = String(Date.now() + TTL_MS);
  return `${exp}.${sign(exp)}`;
}

function tokenValid(token: string | undefined): boolean {
  if (!token) return false;
  const dot = token.lastIndexOf('.');
  if (dot < 0) return false;
  const exp = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!safeEqual(sig, sign(exp))) return false;
  return Number(exp) > Date.now();
}

function readCookie(req: FastifyRequest, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return undefined;
}

export function isAuthed(req: FastifyRequest): boolean {
  if (!authEnabled) return true;
  return tokenValid(readCookie(req, COOKIE));
}

export function verifyPassword(password: string): boolean {
  return authEnabled && safeEqual(password, config.auth.password);
}

export function setSession(req: FastifyRequest, reply: FastifyReply): void {
  const secure = req.protocol === 'https';
  reply.header(
    'Set-Cookie',
    `${COOKIE}=${makeToken()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(
      TTL_MS / 1000,
    )}${secure ? '; Secure' : ''}`,
  );
}

export function clearSession(_req: FastifyRequest, reply: FastifyReply): void {
  reply.header('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

/** Only allow same-origin relative paths as a post-login redirect (no open redirect). */
export function sanitizeNext(next: unknown): string {
  if (typeof next === 'string' && next.startsWith('/') && !next.startsWith('//')) return next;
  return '/';
}

/**
 * onRequest gate. Unauthed HTML GETs are redirected to /login; everything else
 * gets 401. /login, /logout and /health are always open.
 */
export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!authEnabled) return;
  const path = req.url.split('?')[0] ?? '';
  if (path === '/health' || path === '/login' || path === '/logout') return;
  // PWA assets are non-sensitive and may be fetched by the OS without a cookie.
  if (path === '/manifest.webmanifest' || path.startsWith('/icon-')) return;
  if (isAuthed(req)) return;

  const wantsHtml = (req.headers.accept ?? '').includes('text/html');
  if (req.method === 'GET' && wantsHtml) {
    return reply.redirect(`/login?next=${encodeURIComponent(req.url)}`);
  }
  return reply.code(401).send({ error: 'Authentication required. Visit /login.' });
}
