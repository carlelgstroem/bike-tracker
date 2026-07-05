import { fetchDailySummary, logSummary, type DailySummary } from './whoop/summary.js';
import { persistSummary } from './db/snapshots.js';
import { getLastFetchAt, setLastFetchAt } from './db/meta.js';
import { hasTokens } from './whoop/tokens.js';

/**
 * Orchestration layer: fetch from WHOOP, persist to SQLite, track freshness.
 * Everything that wants current data (scheduler, startup, page loads) goes
 * through here so there is one place that talks to WHOOP + the DB.
 */

/** Default staleness threshold for on-demand refreshes (page loads, startup). */
export const DEFAULT_STALE_MS = 30 * 60 * 1000;

/**
 * Serialise refreshes so a page-load refresh and a scheduler tick can't both
 * hit WHOOP (and race the single-use refresh token) at the same time.
 */
let refreshInFlight: Promise<DailySummary> | null = null;

/** Fetch from WHOOP, persist, and stamp the fetch time. Deduped while in flight. */
export async function refreshData(opts: { log?: boolean } = {}): Promise<DailySummary> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const summary = await fetchDailySummary();
    persistSummary(summary);
    setLastFetchAt(Date.now());
    if (opts.log) logSummary(summary);
    return summary;
  })().finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}

/**
 * Refresh only if the stored data is older than `maxAgeMs`. Returns true if a
 * refresh actually ran. Safe to call on every page load.
 */
export async function ensureFresh(maxAgeMs = DEFAULT_STALE_MS): Promise<boolean> {
  if (!hasTokens()) return false;
  const last = getLastFetchAt();
  if (last !== null && Date.now() - last < maxAgeMs) return false;
  await refreshData();
  return true;
}
