import { getCyclesSince, getSleepsSince, getRecoveryForCycle } from './whoop/client.js';
import { persistDailyEntries, type BackfillEntry } from './db/snapshots.js';

/**
 * One-time (idempotent) import of recent history so the day-toggle and
 * sparkline have data immediately, instead of waiting weeks for the daily
 * poller to accumulate it.
 *
 * Cost: 1 cycles page + 1 sleeps page + one recovery call per cycle
 * (~30 calls for 30 days). Fine as an occasional operation.
 */
export async function backfillHistory(days = 30): Promise<number> {
  const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [cycles, sleeps] = await Promise.all([
    getCyclesSince(start),
    getSleepsSince(start),
  ]);
  const sleepById = new Map(sleeps.map((s) => [s.id, s]));

  const entries: BackfillEntry[] = [];
  for (const cycle of cycles) {
    const recovery = await getRecoveryForCycle(cycle.id);
    // Recovery references the sleep it was scored from.
    const sleep = recovery?.sleep_id ? sleepById.get(recovery.sleep_id) ?? null : null;
    entries.push({ cycle, recovery, sleep });
  }

  persistDailyEntries(entries);
  return entries.length;
}
