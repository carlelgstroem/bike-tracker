import { db } from '../db/index.js';

/**
 * Persistent store for the single WHOOP OAuth token set (single-user app,
 * so there is exactly one row, id = 1).
 */

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  /** epoch ms when the access token expires */
  expiresAt: number;
  scope: string | null;
}

interface TokenRow {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scope: string | null;
}

const selectStmt = db.prepare<[], TokenRow>(
  'SELECT access_token, refresh_token, expires_at, scope FROM oauth_tokens WHERE id = 1',
);

const upsertStmt = db.prepare(`
  INSERT INTO oauth_tokens (id, access_token, refresh_token, expires_at, scope, updated_at)
  VALUES (1, @accessToken, @refreshToken, @expiresAt, @scope, @updatedAt)
  ON CONFLICT(id) DO UPDATE SET
    access_token  = excluded.access_token,
    refresh_token = excluded.refresh_token,
    expires_at    = excluded.expires_at,
    scope         = excluded.scope,
    updated_at    = excluded.updated_at
`);

export function getStoredTokens(): StoredTokens | null {
  const row = selectStmt.get();
  if (!row) return null;
  return {
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    expiresAt: row.expires_at,
    scope: row.scope,
  };
}

export function saveTokens(tokens: StoredTokens): void {
  upsertStmt.run({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt,
    scope: tokens.scope,
    updatedAt: Date.now(),
  });
}

export function hasTokens(): boolean {
  return getStoredTokens() !== null;
}
