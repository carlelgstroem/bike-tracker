import 'dotenv/config';

/**
 * Centralised, validated configuration. Everything comes from the environment
 * (via .env locally) so the service can be containerised and moved to
 * syscall-z later with no code changes.
 */

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        `Copy .env.example to .env and fill it in.`,
    );
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${name} must be a number, got "${raw}".`);
  }
  return parsed;
}

const baseUrl = optional('BASE_URL', 'http://localhost:3000').replace(/\/$/, '');

export const config = {
  server: {
    host: optional('HOST', '127.0.0.1'),
    port: num('PORT', 3000),
    baseUrl,
  },
  whoop: {
    clientId: required('WHOOP_CLIENT_ID'),
    clientSecret: required('WHOOP_CLIENT_SECRET'),
    // Redirect URI is derived from BASE_URL so there is a single source of truth.
    redirectUri: `${baseUrl}/auth/whoop/callback`,
    authUrl: 'https://api.prod.whoop.com/oauth/oauth2/auth',
    tokenUrl: 'https://api.prod.whoop.com/oauth/oauth2/token',
    apiBase: 'https://api.prod.whoop.com/developer/v2',
    // `offline` is required to receive a refresh token.
    scopes: [
      'read:recovery',
      'read:sleep',
      'read:cycles',
      'read:workout',
      'read:profile',
      'read:body_measurement',
      'offline',
    ],
  },
  weather: {
    latitude: num('LATITUDE', 38.9072),
    longitude: num('LONGITUDE', -77.0369),
    timezone: optional('TIMEZONE', 'America/New_York'),
  },
  db: {
    path: optional('DATABASE_PATH', './data/munin.db'),
  },
  auth: {
    // HTTP Basic gate. Enabled whenever AUTH_PASSWORD is set. Required before the
    // app will bind a public (non-loopback) host — see index.ts.
    user: optional('AUTH_USER', 'munin'),
    password: process.env.AUTH_PASSWORD ?? '',
  },
} as const;

/** True when the server is bound only to the loopback interface. */
export function isLoopbackHost(): boolean {
  return ['127.0.0.1', '::1', 'localhost'].includes(config.server.host);
}

export type Config = typeof config;
