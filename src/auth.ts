import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config/index.js';

/**
 * Minimal HTTP Basic auth gate. Single-user, so a shared username/password from
 * the environment is enough. Enabled only when AUTH_PASSWORD is set; on a
 * loopback-only bind we leave it off for local convenience.
 *
 * Deployed publicly this protects personal health data — index.ts refuses to
 * bind a public host unless AUTH_PASSWORD is configured.
 */

export const authEnabled = config.auth.password !== '';

/** Constant-time compare via fixed-length hashes (avoids length leaks). */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

function credentialsOk(header: string | undefined): boolean {
  if (!header?.startsWith('Basic ')) return false;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const sep = decoded.indexOf(':');
  if (sep === -1) return false;
  const user = decoded.slice(0, sep);
  const pass = decoded.slice(sep + 1);
  // Evaluate both to keep timing independent of which field is wrong.
  const userOk = safeEqual(user, config.auth.user);
  const passOk = safeEqual(pass, config.auth.password);
  return userOk && passOk;
}

/** Fastify preHandler enforcing Basic auth on everything except /health. */
export async function basicAuthHook(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!authEnabled) return;
  if (req.url === '/health') return; // platform health checks

  if (credentialsOk(req.headers.authorization)) return;

  reply
    .header('WWW-Authenticate', 'Basic realm="Munin", charset="UTF-8"')
    .code(401)
    .send('Authentication required.');
}
