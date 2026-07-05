import { config, isLoopbackHost } from './config/index.js';
import { migrate } from './db/index.js';
import { buildServer } from './server.js';
import { authEnabled } from './auth.js';
import { hasTokens } from './whoop/tokens.js';
import { refreshData } from './service.js';
import { startScheduler } from './scheduler.js';
import { backfillHistory } from './backfill.js';
import { countDays } from './db/snapshots.js';

/** Import history on first runs so the day-toggle and sparkline have data. */
const BACKFILL_DAYS = 30;
const BACKFILL_UNTIL = 20; // stop auto-backfilling once we have this many days

async function main() {
  // Safety rail: never expose personal health data on a public interface without auth.
  if (!isLoopbackHost() && !authEnabled) {
    throw new Error(
      `Refusing to start: HOST is "${config.server.host}" (public) but AUTH_PASSWORD is not set. ` +
        `Set AUTH_PASSWORD to protect your data, or bind HOST=127.0.0.1 for local-only.`,
    );
  }

  migrate();

  const app = buildServer();
  await app.listen({ host: config.server.host, port: config.server.port });

  const base = config.server.baseUrl;
  if (hasTokens()) {
    // Laptop-sleep resilience: refresh + persist on every boot, don't wait for the scheduler.
    app.log.info('WHOOP tokens present — fetching fresh data on startup.');
    try {
      await refreshData({ log: true });
    } catch (err) {
      app.log.error(err, 'startup summary fetch failed');
    }

    // Backfill recent history until we have enough days for the toggle/sparkline.
    if (countDays() < BACKFILL_UNTIL) {
      try {
        const imported = await backfillHistory(BACKFILL_DAYS);
        app.log.info(`backfilled ${imported} day(s) of history (${countDays()} stored).`);
      } catch (err) {
        app.log.warn(err, 'history backfill failed');
      }
    }
  } else {
    app.log.info(`Not yet connected to WHOOP. Open ${base}/auth/whoop to authorise.`);
  }

  const stopScheduler = startScheduler(app.log);

  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      app.log.info(`received ${sig}, shutting down`);
      stopScheduler();
      app.close().finally(() => process.exit(0));
    });
  }
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
