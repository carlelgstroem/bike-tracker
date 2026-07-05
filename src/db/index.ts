import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { config } from '../config/index.js';

/**
 * Single SQLite connection for the whole process. better-sqlite3 is synchronous,
 * which suits a single-user app and keeps the token-refresh logic simple.
 *
 * The file lives under ./data (git-ignored) so it survives restarts and can be
 * copied to syscall-z later.
 */

const dbPath = resolve(config.db.path);
mkdirSync(dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/**
 * Schema. Phase 1 only needs the token store; later phases add snapshot tables.
 * Kept idempotent so it can run on every boot.
 */
export function migrate(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS oauth_tokens (
      id            INTEGER PRIMARY KEY CHECK (id = 1),
      access_token  TEXT    NOT NULL,
      refresh_token TEXT    NOT NULL,
      expires_at    INTEGER NOT NULL,   -- epoch ms when the access token expires
      scope         TEXT,
      updated_at    INTEGER NOT NULL    -- epoch ms of last write
    );

    -- One row per physiological day (WHOOP cycle), keyed by local calendar date.
    -- Score columns are nullable because WHOOP may not have scored yet.
    CREATE TABLE IF NOT EXISTS daily_snapshot (
      day                TEXT    PRIMARY KEY,  -- YYYY-MM-DD in the configured timezone
      cycle_id           INTEGER,
      cycle_start        TEXT,                 -- ISO 8601 (UTC) of cycle start
      recovery_score     INTEGER,              -- %
      hrv_rmssd_milli    REAL,                 -- ms
      resting_heart_rate INTEGER,              -- bpm
      strain             REAL,                 -- day strain from the cycle
      sleep_id           TEXT,
      sleep_performance  INTEGER,              -- %
      sleep_needed_milli INTEGER,              -- baseline + debt + strain need
      sleep_actual_milli INTEGER,              -- in-bed minus awake
      updated_at         INTEGER NOT NULL      -- epoch ms
    );

    -- Individual workouts, for training-load context. Keyed by WHOOP workout id.
    CREATE TABLE IF NOT EXISTS workouts (
      id                 TEXT    PRIMARY KEY,
      start              TEXT    NOT NULL,      -- ISO 8601 (UTC)
      end                TEXT    NOT NULL,
      sport_id           INTEGER,
      strain             REAL,
      average_heart_rate INTEGER,
      max_heart_rate     INTEGER,
      kilojoule          REAL,
      updated_at         INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_workouts_start ON workouts(start);

    -- Small key/value store for app metadata (e.g. last successful fetch time).
    CREATE TABLE IF NOT EXISTS app_meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

// Run at module load so tables exist before any module prepares statements
// against them (e.g. whoop/tokens.ts prepares at import time).
migrate();
