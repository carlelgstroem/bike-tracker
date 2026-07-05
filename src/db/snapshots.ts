import { db } from './index.js';
import { localDate } from '../util/time.js';
import { setMaxHeartRate } from './meta.js';
import type { DailySummary } from '../whoop/summary.js';
import type { Cycle, Recovery, Sleep } from '../whoop/client.js';

/**
 * Persistence for daily snapshots, workouts, and derived baselines.
 * Writes are idempotent upserts so re-fetching the same day just refreshes it.
 */

export interface DailyRow {
  day: string;
  cycle_id: number | null;
  cycle_start: string | null;
  recovery_score: number | null;
  hrv_rmssd_milli: number | null;
  resting_heart_rate: number | null;
  strain: number | null;
  sleep_id: string | null;
  sleep_performance: number | null;
  sleep_needed_milli: number | null;
  sleep_actual_milli: number | null;
  updated_at: number;
}

const upsertDaily = db.prepare(`
  INSERT INTO daily_snapshot (
    day, cycle_id, cycle_start, recovery_score, hrv_rmssd_milli, resting_heart_rate,
    strain, sleep_id, sleep_performance, sleep_needed_milli, sleep_actual_milli, updated_at
  ) VALUES (
    @day, @cycle_id, @cycle_start, @recovery_score, @hrv_rmssd_milli, @resting_heart_rate,
    @strain, @sleep_id, @sleep_performance, @sleep_needed_milli, @sleep_actual_milli, @updated_at
  )
  ON CONFLICT(day) DO UPDATE SET
    cycle_id           = excluded.cycle_id,
    cycle_start        = excluded.cycle_start,
    -- Keep a previously-scored value if a later fetch comes back unscored (NULL).
    recovery_score     = COALESCE(excluded.recovery_score, daily_snapshot.recovery_score),
    hrv_rmssd_milli    = COALESCE(excluded.hrv_rmssd_milli, daily_snapshot.hrv_rmssd_milli),
    resting_heart_rate = COALESCE(excluded.resting_heart_rate, daily_snapshot.resting_heart_rate),
    strain             = COALESCE(excluded.strain, daily_snapshot.strain),
    sleep_id           = COALESCE(excluded.sleep_id, daily_snapshot.sleep_id),
    sleep_performance  = COALESCE(excluded.sleep_performance, daily_snapshot.sleep_performance),
    sleep_needed_milli = COALESCE(excluded.sleep_needed_milli, daily_snapshot.sleep_needed_milli),
    sleep_actual_milli = COALESCE(excluded.sleep_actual_milli, daily_snapshot.sleep_actual_milli),
    updated_at         = excluded.updated_at
`);

const upsertWorkout = db.prepare(`
  INSERT INTO workouts (
    id, start, end, sport_id, strain, average_heart_rate, max_heart_rate, kilojoule, updated_at
  ) VALUES (
    @id, @start, @end, @sport_id, @strain, @average_heart_rate, @max_heart_rate, @kilojoule, @updated_at
  )
  ON CONFLICT(id) DO UPDATE SET
    start              = excluded.start,
    end                = excluded.end,
    sport_id           = excluded.sport_id,
    strain             = excluded.strain,
    average_heart_rate = excluded.average_heart_rate,
    max_heart_rate     = excluded.max_heart_rate,
    kilojoule          = excluded.kilojoule,
    updated_at         = excluded.updated_at
`);

/** Map one cycle (+ its recovery/sleep) to daily_snapshot upsert params. */
function dailyParams(cycle: Cycle, recovery: Recovery | null, sleep: Sleep | null, now: number) {
  const rScore = recovery?.score;
  const sScore = sleep?.score;
  const sleepActual = sScore
    ? sScore.stage_summary.total_in_bed_time_milli - sScore.stage_summary.total_awake_time_milli
    : null;
  const sleepNeeded = sScore
    ? sScore.sleep_needed.baseline_milli +
      sScore.sleep_needed.need_from_sleep_debt_milli +
      sScore.sleep_needed.need_from_recent_strain_milli
    : null;

  return {
    day: localDate(cycle.start),
    cycle_id: cycle.id,
    cycle_start: cycle.start,
    recovery_score: rScore?.recovery_score ?? null,
    hrv_rmssd_milli: rScore?.hrv_rmssd_milli ?? null,
    resting_heart_rate: rScore?.resting_heart_rate ?? null,
    strain: cycle.score?.strain ?? null,
    sleep_id: sleep?.id ?? null,
    sleep_performance: sScore?.sleep_performance_percentage ?? null,
    sleep_needed_milli: sleepNeeded,
    sleep_actual_milli: sleepActual,
    updated_at: now,
  };
}

/** Persist a fetched summary into the snapshot + workouts tables (one transaction). */
export const persistSummary = db.transaction((summary: DailySummary): void => {
  const now = Date.now();
  const { cycle, recovery, sleep } = summary;

  if (cycle) {
    upsertDaily.run(dailyParams(cycle, recovery, sleep, now));
  }

  if (summary.bodyMeasurement?.max_heart_rate) {
    setMaxHeartRate(summary.bodyMeasurement.max_heart_rate);
  }

  for (const w of summary.recentWorkouts) {
    upsertWorkout.run({
      id: w.id,
      start: w.start,
      end: w.end,
      sport_id: w.sport_id,
      strain: w.score?.strain ?? null,
      average_heart_rate: w.score?.average_heart_rate ?? null,
      max_heart_rate: w.score?.max_heart_rate ?? null,
      kilojoule: w.score?.kilojoule ?? null,
      updated_at: now,
    });
  }
});

export interface BackfillEntry {
  cycle: Cycle;
  recovery: Recovery | null;
  sleep: Sleep | null;
}

/** Bulk-persist historical days (one transaction). Idempotent per day. */
export const persistDailyEntries = db.transaction((entries: BackfillEntry[]): void => {
  const now = Date.now();
  for (const e of entries) {
    upsertDaily.run(dailyParams(e.cycle, e.recovery, e.sleep, now));
  }
});

// ---- Queries ----

const selectRecent = db.prepare<[number], DailyRow>(
  'SELECT * FROM daily_snapshot ORDER BY day DESC LIMIT ?',
);

/** Most recent N daily rows, newest first. */
export function getRecentDays(limit: number): DailyRow[] {
  return selectRecent.all(limit);
}

/** The latest daily row (today, or the most recent stored day). */
export function getLatestDay(): DailyRow | null {
  return selectRecent.get(1) ?? null;
}

const selectDay = db.prepare<[string], DailyRow>('SELECT * FROM daily_snapshot WHERE day = ?');
const selectPrevDay = db.prepare<[string], { day: string }>(
  'SELECT day FROM daily_snapshot WHERE day < ? ORDER BY day DESC LIMIT 1',
);
const selectNextDay = db.prepare<[string], { day: string }>(
  'SELECT day FROM daily_snapshot WHERE day > ? ORDER BY day ASC LIMIT 1',
);

export function getDay(day: string): DailyRow | null {
  return selectDay.get(day) ?? null;
}

/** Nearest stored day before `day` (skips gaps), or null. */
export function getPrevDay(day: string): string | null {
  return selectPrevDay.get(day)?.day ?? null;
}

/** Nearest stored day after `day` (skips gaps), or null. */
export function getNextDay(day: string): string | null {
  return selectNextDay.get(day)?.day ?? null;
}

/** Total number of stored days (used to decide whether to backfill). */
export function countDays(): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM daily_snapshot').get() as { n: number }).n;
}

export interface Baselines {
  /** Mean HRV over the window, or null if not enough data. */
  hrv: number | null;
  /** Mean resting HR over the window, or null. */
  restingHeartRate: number | null;
  /** Number of days that contributed. */
  sampleSize: number;
}

const selectBaseline = db.prepare<{ from: string; to: string }, {
  hrv: number | null;
  rhr: number | null;
  n: number;
}>(`
  SELECT AVG(hrv_rmssd_milli) AS hrv,
         AVG(resting_heart_rate) AS rhr,
         COUNT(*) AS n
  FROM daily_snapshot
  WHERE day >= @from AND day < @to
    AND hrv_rmssd_milli IS NOT NULL
`);

/**
 * Rolling baselines over the `windowDays` days ending YESTERDAY (today is
 * excluded so we compare today against its own history, not itself).
 */
export function getBaselines(windowDays = 30, today: string = localDate(new Date())): Baselines {
  const toDate = today; // exclusive upper bound => excludes today
  const from = new Date(`${today}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - windowDays);
  const fromDate = from.toISOString().slice(0, 10);

  const row = selectBaseline.get({ from: fromDate, to: toDate });
  return {
    hrv: row?.hrv ?? null,
    restingHeartRate: row?.rhr ?? null,
    sampleSize: row?.n ?? 0,
  };
}
