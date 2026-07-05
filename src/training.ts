import { getRecentDays, getRecentWorkouts } from './db/snapshots.js';

/**
 * Training-load context. The acute:chronic workload ratio (ACWR) compares the
 * last 7 days of daily strain against the last 28 — a rough "are you ramping
 * too fast" signal. Computed from stored daily cycle strain (we keep 30 days),
 * so it works without per-workout history.
 */

export interface RecentWorkout {
  start: string;
  durationMin: number;
  strain: number | null;
  avgHr: number | null;
}

export interface TrainingLoad {
  /** Mean daily strain over the last 7 days. */
  acute: number | null;
  /** Mean daily strain over the last 28 days. */
  chronic: number | null;
  /** acute / chronic. ~0.8–1.3 is the usual "sweet spot". */
  acwr: number | null;
  /** Sum of daily strain over the last 7 days. */
  weekTotal: number | null;
  recentWorkouts: RecentWorkout[];
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

export function computeTrainingLoad(): TrainingLoad {
  const days = getRecentDays(28);
  const strainOf = (rows: typeof days) =>
    rows.map((r) => r.strain).filter((s): s is number => s !== null);

  const week = strainOf(days.slice(0, 7));
  const acute = mean(week);
  const chronic = mean(strainOf(days));
  const acwr = acute !== null && chronic !== null && chronic > 0 ? acute / chronic : null;
  const weekTotal = week.length ? week.reduce((a, b) => a + b, 0) : null;

  const recentWorkouts: RecentWorkout[] = getRecentWorkouts(6).map((w) => ({
    start: w.start,
    durationMin: Math.max(0, Math.round((Date.parse(w.end) - Date.parse(w.start)) / 60000)),
    strain: w.strain,
    avgHr: w.average_heart_rate,
  }));

  return { acute, chronic, acwr, weekTotal, recentWorkouts };
}
