import { db } from './index.js';

/** Tiny typed accessor over the app_meta key/value table. */

const getStmt = db.prepare<[string], { value: string }>(
  'SELECT value FROM app_meta WHERE key = ?',
);
const setStmt = db.prepare(
  `INSERT INTO app_meta (key, value) VALUES (?, ?)
   ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
);

const LAST_FETCH_KEY = 'last_fetch_at';
const MAX_HR_KEY = 'max_heart_rate';

/** Epoch ms of the last successful WHOOP fetch, or null if never. */
export function getLastFetchAt(): number | null {
  const row = getStmt.get(LAST_FETCH_KEY);
  return row ? Number(row.value) : null;
}

export function setLastFetchAt(epochMs: number): void {
  setStmt.run(LAST_FETCH_KEY, String(epochMs));
}

/** User's max heart rate (from WHOOP body measurement), or null if unknown. */
export function getMaxHeartRate(): number | null {
  const row = getStmt.get(MAX_HR_KEY);
  return row ? Number(row.value) : null;
}

export function setMaxHeartRate(bpm: number): void {
  setStmt.run(MAX_HR_KEY, String(bpm));
}
