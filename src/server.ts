import Fastify from 'fastify';
import { config } from './config/index.js';
import {
  buildAuthorizationUrl,
  exchangeCodeForTokens,
  generateState,
} from './whoop/oauth.js';
import { hasTokens } from './whoop/tokens.js';
import { refreshData, ensureFresh } from './service.js';
import { buildDashboard } from './readiness.js';
import { renderDashboard } from './render.js';
import { backfillHistory } from './backfill.js';
import { basicAuthHook } from './auth.js';

/**
 * Short-lived store of outstanding OAuth `state` values for CSRF protection.
 * In-memory is fine: single user, single process, one-time flow.
 */
const pendingStates = new Map<string, number>();
const STATE_TTL_MS = 10 * 60 * 1000;

function rememberState(state: string): void {
  pendingStates.set(state, Date.now());
}

function consumeState(state: string): boolean {
  const created = pendingStates.get(state);
  if (created === undefined) return false;
  pendingStates.delete(state);
  return Date.now() - created < STATE_TTL_MS;
}

export function buildServer() {
  // trustProxy so req.protocol reflects x-forwarded-proto behind Railway's TLS edge.
  const app = Fastify({ logger: true, trustProxy: true });

  // Auth gate (no-op unless AUTH_PASSWORD is set). Runs before every route.
  app.addHook('onRequest', basicAuthHook);

  app.get('/health', async () => ({ ok: true, authorised: hasTokens() }));

  // Dashboard. Refresh in the background if data is stale (>30 min); never block
  // the page render on a slow WHOOP call. `?day=YYYY-MM-DD` views a past day.
  app.get<{ Querystring: { day?: string } }>('/', async (req, reply) => {
    ensureFresh().catch((err) => app.log.warn(err, 'page-load refresh failed'));
    const day = /^\d{4}-\d{2}-\d{2}$/.test(req.query.day ?? '') ? req.query.day : undefined;
    const data = await buildDashboard(day);
    return reply.type('text/html; charset=utf-8').send(renderDashboard(data));
  });

  // Same view model as JSON, for debugging / future clients.
  app.get<{ Querystring: { day?: string } }>('/api/dashboard', async (req) => {
    const day = /^\d{4}-\d{2}-\d{2}$/.test(req.query.day ?? '') ? req.query.day : undefined;
    return buildDashboard(day);
  });

  // Manually (re)import history from WHOOP. Idempotent. `?days=30` to tune range.
  app.get<{ Querystring: { days?: string } }>('/api/backfill', async (req, reply) => {
    if (!hasTokens()) return reply.code(400).send({ error: 'Not authorised with WHOOP.' });
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 180);
    const imported = await backfillHistory(days);
    return { imported, days };
  });

  // Kick off the OAuth flow: redirect the browser to WHOOP.
  app.get('/auth/whoop', async (_req, reply) => {
    const state = generateState();
    rememberState(state);
    return reply.redirect(buildAuthorizationUrl(state));
  });

  // OAuth callback: validate state, exchange code, persist tokens.
  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    '/auth/whoop/callback',
    async (req, reply) => {
      const { code, state, error } = req.query;

      if (error) {
        return reply.code(400).send(`WHOOP authorisation failed: ${error}`);
      }
      if (!code || !state) {
        return reply.code(400).send('Missing code or state in callback.');
      }
      if (!consumeState(state)) {
        return reply.code(400).send('Invalid or expired state. Restart at /auth/whoop.');
      }

      try {
        await exchangeCodeForTokens(code);
      } catch (err) {
        req.log.error(err, 'token exchange failed');
        return reply.code(502).send('Token exchange with WHOOP failed. Check server logs.');
      }

      // Fetch, persist, and log today's data right after connecting.
      try {
        await refreshData({ log: true });
      } catch (err) {
        req.log.warn(err, 'post-auth summary fetch failed (tokens are saved)');
      }

      return reply
        .type('text/html')
        .send(
          '<h1>Munin connected to WHOOP ✅</h1>' +
            '<p>Tokens saved. You can close this tab — check the server console for your recovery summary.</p>',
        );
    },
  );

  return app;
}
