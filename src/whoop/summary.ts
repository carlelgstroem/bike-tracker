import {
  getLatestCycle,
  getRecoveryForCycle,
  getLatestSleep,
  getWorkoutsSince,
  getBodyMeasurement,
  type Cycle,
  type Recovery,
  type Sleep,
  type Workout,
  type BodyMeasurement,
} from './client.js';

/**
 * Today's readiness inputs, pulled together from the individual endpoints.
 * Phase 2+ will persist this; Phase 1 just logs it to prove the pipeline works.
 */
export interface DailySummary {
  fetchedAt: string;
  cycle: Cycle | null;
  recovery: Recovery | null;
  sleep: Sleep | null;
  recentWorkouts: Workout[];
  bodyMeasurement: BodyMeasurement | null;
}

export async function fetchDailySummary(): Promise<DailySummary> {
  const cycle = await getLatestCycle();
  const recovery = cycle ? await getRecoveryForCycle(cycle.id) : null;
  const sleep = await getLatestSleep();

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recentWorkouts = await getWorkoutsSince(sevenDaysAgo);

  // Body measurement (max HR) rarely changes; tolerate failure.
  let bodyMeasurement: BodyMeasurement | null = null;
  try {
    bodyMeasurement = await getBodyMeasurement();
  } catch {
    bodyMeasurement = null;
  }

  return {
    fetchedAt: new Date().toISOString(),
    cycle,
    recovery,
    sleep,
    recentWorkouts,
    bodyMeasurement,
  };
}

/** Human-readable one-shot log used in Phase 1 for manual verification. */
export function logSummary(summary: DailySummary): void {
  const r = summary.recovery?.score;
  const s = summary.sleep?.score;
  const c = summary.cycle?.score;

  console.log('\n===== WHOOP daily summary =====');
  console.log(`fetched at:       ${summary.fetchedAt}`);
  if (r) {
    console.log(`recovery:         ${r.recovery_score}%  ${r.user_calibrating ? '(calibrating)' : ''}`);
    console.log(`HRV (rmssd):      ${r.hrv_rmssd_milli.toFixed(1)} ms`);
    console.log(`resting HR:       ${r.resting_heart_rate} bpm`);
  } else {
    console.log('recovery:         not scored yet');
  }
  if (s) {
    const need = s.sleep_needed;
    const neededMs =
      need.baseline_milli + need.need_from_sleep_debt_milli + need.need_from_recent_strain_milli;
    const asleepMs =
      s.stage_summary.total_in_bed_time_milli - s.stage_summary.total_awake_time_milli;
    console.log(`sleep perf:       ${s.sleep_performance_percentage}%`);
    console.log(`slept / need:     ${(asleepMs / 3.6e6).toFixed(1)}h / ${(neededMs / 3.6e6).toFixed(1)}h`);
  } else {
    console.log('sleep:            not scored yet');
  }
  if (c) {
    console.log(`yesterday strain: ${c.strain.toFixed(1)}`);
  }
  console.log(`recent workouts:  ${summary.recentWorkouts.length} in last 7 days`);
  console.log('================================\n');
}
