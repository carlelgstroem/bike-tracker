import { config } from '../config/index.js';

/**
 * Timezone-aware helpers. All "which day / which hour" decisions use the
 * configured timezone (America/New_York by default) rather than the host's
 * local time, so behaviour is identical on the Mac and later on syscall-z.
 */

/** Local calendar date (YYYY-MM-DD) for an instant, in the configured tz. */
export function localDate(instant: Date | string, tz: string = config.weather.timezone): string {
  const d = typeof instant === 'string' ? new Date(instant) : instant;
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d);
}

/** Local hour (0–23) for an instant, in the configured tz. */
export function localHour(instant: Date = new Date(), tz: string = config.weather.timezone): number {
  const s = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    hour12: false,
  }).format(instant);
  // Intl can emit "24" at midnight in some engines; normalise to 0.
  const h = Number.parseInt(s, 10);
  return h === 24 ? 0 : h;
}
