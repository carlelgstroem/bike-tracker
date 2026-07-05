import { randomBytes } from 'node:crypto';
import { config } from '../config/index.js';
import { getStoredTokens, saveTokens, type StoredTokens } from './tokens.js';

/**
 * WHOOP OAuth 2.0 authorization-code flow with single-use refresh-token
 * rotation.
 *
 * WHOOP invalidates both the old access token and the old refresh token the
 * moment a refresh succeeds, and the NEW refresh token from the response is the
 * only valid one going forward. We therefore persist the rotated pair
 * atomically, and serialise refreshes (see `getValidAccessToken`) so two
 * concurrent callers can never burn the single-use token on each other.
 */

interface WhoopTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds
  scope?: string;
  token_type: string;
}

/** Refresh a bit before the real expiry to avoid mid-request 401s. */
const EXPIRY_SKEW_MS = 60_000;

/** Build the authorization URL the browser is redirected to. `state` is CSRF protection. */
export function buildAuthorizationUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.whoop.clientId,
    redirect_uri: config.whoop.redirectUri,
    scope: config.whoop.scopes.join(' '),
    state,
  });
  return `${config.whoop.authUrl}?${params.toString()}`;
}

/** WHOOP requires an opaque state of at least 8 characters. */
export function generateState(): string {
  return randomBytes(16).toString('hex');
}

function toStored(res: WhoopTokenResponse): StoredTokens {
  return {
    accessToken: res.access_token,
    refreshToken: res.refresh_token,
    expiresAt: Date.now() + res.expires_in * 1000,
    scope: res.scope ?? null,
  };
}

async function postToken(body: URLSearchParams): Promise<WhoopTokenResponse> {
  const res = await fetch(config.whoop.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`WHOOP token request failed (${res.status}): ${text}`);
  }
  return JSON.parse(text) as WhoopTokenResponse;
}

/** Exchange the authorization code from the callback for the initial token set. */
export async function exchangeCodeForTokens(code: string): Promise<StoredTokens> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: config.whoop.clientId,
    client_secret: config.whoop.clientSecret,
    redirect_uri: config.whoop.redirectUri,
  });
  const tokens = toStored(await postToken(body));
  saveTokens(tokens);
  return tokens;
}

/**
 * Perform a single refresh and persist the rotated pair. Do NOT call directly
 * from request handlers — go through `getValidAccessToken`, which serialises.
 */
async function refreshTokens(refreshToken: string): Promise<StoredTokens> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: config.whoop.clientId,
    client_secret: config.whoop.clientSecret,
    // WHOOP wants `offline` echoed back to keep issuing refresh tokens.
    scope: 'offline',
  });
  const tokens = toStored(await postToken(body));
  // Persist immediately so a crash right after this leaves us with the valid pair.
  saveTokens(tokens);
  return tokens;
}

/**
 * In-process lock. Node is single-threaded, but async refreshes can interleave;
 * a shared promise guarantees at most one in-flight refresh, so we never spend
 * the single-use refresh token twice.
 */
let refreshInFlight: Promise<StoredTokens> | null = null;

/**
 * Return a valid access token, refreshing (once, serialised) if the stored one
 * is expired or about to expire. Throws if the app has never been authorised.
 */
export async function getValidAccessToken(): Promise<string> {
  const stored = getStoredTokens();
  if (!stored) {
    throw new Error('Not authorised with WHOOP yet. Visit /auth/whoop to connect.');
  }

  if (Date.now() < stored.expiresAt - EXPIRY_SKEW_MS) {
    return stored.accessToken;
  }

  if (!refreshInFlight) {
    refreshInFlight = refreshTokens(stored.refreshToken).finally(() => {
      refreshInFlight = null;
    });
  }
  const refreshed = await refreshInFlight;
  return refreshed.accessToken;
}
