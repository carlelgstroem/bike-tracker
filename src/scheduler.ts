import type { FastifyBaseLogger } from 'fastify';
import { localHour } from './util/time.js';
import { hasTokens } from './whoop/tokens.js';
import { refreshData } from './service.js';

/**
 * Polling scheduler. Frequent in the morning (when overnight recovery lands),
 * relaxed the rest of the day:
 *   05:00–11:59 (local tz)  -> every 30 min
 *   otherwise               -> every 60 min
 *
 * Implemented as a self-rescheduling timer rather than a fixed cron so that:
 *   - the interval adapts to the current local hour on every tick, and
 *   - if the laptop sleeps, the timer simply fires late on wake and carries on.
 */

const MORNING_INTERVAL_MS = 30 * 60 * 1000;
const DAY_INTERVAL_MS = 60 * 60 * 1000;

function nextIntervalMs(): number {
  const h = localHour();
  return h >= 5 && h < 12 ? MORNING_INTERVAL_MS : DAY_INTERVAL_MS;
}

export function startScheduler(log: FastifyBaseLogger): () => void {
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    if (hasTokens()) {
      try {
        await refreshData();
        log.info('scheduler: WHOOP data refreshed');
      } catch (err) {
        log.error(err, 'scheduler: refresh failed');
      }
    }
    if (!stopped) {
      const wait = nextIntervalMs();
      log.debug(`scheduler: next poll in ${Math.round(wait / 60000)} min`);
      timer = setTimeout(tick, wait);
    }
  };

  // First poll one interval out; startup fetch in index.ts covers "right now".
  timer = setTimeout(tick, nextIntervalMs());
  log.info('scheduler started (morning 30 min / otherwise 60 min)');

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
