import {
  getLatestDay,
  getRecentDays,
  getBaselines,
  getDay,
  getPrevDay,
  getNextDay,
  type DailyRow,
} from './db/snapshots.js';
import { getMaxHeartRate, getLastFetchAt } from './db/meta.js';
import { computeVerdict, type Verdict } from './verdict.js';
import { fetchWeather, type CurrentWeather, type RideWindow } from './weather.js';
import { computeTrainingLoad, type TrainingLoad } from './training.js';
import { localDate } from './util/time.js';
import { config } from './config/index.js';

/**
 * Assembles the full dashboard view model from stored WHOOP snapshots,
 * rolling baselines, max HR, and a live weather fetch. This is the single
 * source the dashboard route renders from.
 */

export interface MetricCard {
  value: number | null;
  baseline: number | null;
  /** Signed delta vs baseline (bpm for HR, ms for HRV). */
  delta: number | null;
  /** Delta as a percentage of baseline. */
  deltaPct: number | null;
}

export interface DayNav {
  /** The day being viewed (YYYY-MM-DD), or null if no data at all. */
  day: string | null;
  /** Nearest stored day before/after, for prev/next links (null at the ends). */
  prev: string | null;
  next: string | null;
  /** True when viewing the most recent stored day ("today"). */
  isLatest: boolean;
}

export interface DashboardData {
  dateLabel: string; // e.g. "lördag 5 juli 2026"
  nav: DayNav;
  verdict: Verdict;
  recovery: number | null;
  hrv: MetricCard;
  restingHr: MetricCard;
  sleep: {
    performance: number | null;
    actualHours: number | null;
    neededHours: number | null;
    pctOfNeed: number | null;
  };
  weather: {
    current: CurrentWeather;
    bestWindow: RideWindow | null;
  } | null;
  /** Full multi-metric history (oldest → newest), for the interactive chart. */
  history: {
    day: string;
    recovery: number | null;
    hrv: number | null;
    rhr: number | null;
    sleep: number | null;
  }[];
  trainingLoad: TrainingLoad;
  baselineSampleSize: number;
  lastFetch: string | null;
  hasData: boolean;
}

function delta(value: number | null, baseline: number | null): MetricCard {
  if (value === null || baseline === null) {
    return { value, baseline, delta: null, deltaPct: null };
  }
  const d = value - baseline;
  return { value, baseline, delta: d, deltaPct: baseline !== 0 ? (d / baseline) * 100 : null };
}

const DATE_FMT = new Intl.DateTimeFormat('sv-SE', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: config.weather.timezone,
});

/** Format a YYYY-MM-DD day. Anchored at noon so tz formatting never crosses midnight. */
function labelForDay(day: string): string {
  return DATE_FMT.format(new Date(`${day}T12:00:00`));
}

/**
 * Build the dashboard for a specific day (defaults to the latest). Past days
 * are recomputed against their own trailing baseline; weather is only fetched
 * for the latest day (we don't have historical forecasts).
 */
export async function buildDashboard(targetDay?: string): Promise<DashboardData> {
  const latest = getLatestDay();
  const requested = targetDay ? getDay(targetDay) : null;
  const today: DailyRow | null = requested ?? latest;
  const isLatest = !today || !latest || today.day === latest.day;

  const viewedDay = today?.day ?? localDate(new Date());
  const baselines = getBaselines(30, viewedDay);
  const maxHr = getMaxHeartRate();

  // Weather is only meaningful for today. For history, skip it and don't let
  // the verdict get gated on a window we can't know retrospectively.
  let weather: DashboardData['weather'] = null;
  let rideWindowHours = 24;
  if (isLatest) {
    try {
      const w = await fetchWeather();
      weather = { current: w.current, bestWindow: w.bestWindow };
      rideWindowHours = w.bestWindow?.hours ?? 0;
    } catch {
      // No weather → don't punish the verdict; assume rideable so it isn't
      // forced indoors purely because the forecast failed to load.
      weather = null;
      rideWindowHours = 24;
    }
  }

  const hrv = delta(today?.hrv_rmssd_milli ?? null, baselines.hrv);
  const restingHr = delta(today?.resting_heart_rate ?? null, baselines.restingHeartRate);

  const sleepActualH =
    today?.sleep_actual_milli != null ? today.sleep_actual_milli / 3.6e6 : null;
  const sleepNeededH =
    today?.sleep_needed_milli != null ? today.sleep_needed_milli / 3.6e6 : null;
  const pctOfNeed =
    sleepActualH != null && sleepNeededH != null && sleepNeededH > 0
      ? (sleepActualH / sleepNeededH) * 100
      : null;

  const verdict = computeVerdict({
    recovery: today?.recovery_score ?? null,
    hrv: today?.hrv_rmssd_milli ?? null,
    hrvBaseline: baselines.hrv,
    restingHr: today?.resting_heart_rate ?? null,
    rhrBaseline: baselines.restingHeartRate,
    sleepPerformance: today?.sleep_performance ?? null,
    yesterdayStrain: today?.strain ?? null,
    rideWindowHours,
    maxHeartRate: maxHr,
  });

  const history = getRecentDays(90)
    .reverse()
    .map((r) => ({
      day: r.day,
      recovery: r.recovery_score,
      hrv: r.hrv_rmssd_milli,
      rhr: r.resting_heart_rate,
      sleep: r.sleep_performance,
    }));

  return {
    dateLabel: today ? labelForDay(today.day) : labelForDay(viewedDay),
    nav: {
      day: today?.day ?? null,
      prev: today ? getPrevDay(today.day) : null,
      next: today ? getNextDay(today.day) : null,
      isLatest,
    },
    verdict,
    recovery: today?.recovery_score ?? null,
    hrv,
    restingHr,
    sleep: {
      performance: today?.sleep_performance ?? null,
      actualHours: sleepActualH,
      neededHours: sleepNeededH,
      pctOfNeed,
    },
    weather,
    history,
    trainingLoad: computeTrainingLoad(),
    baselineSampleSize: baselines.sampleSize,
    lastFetch: getLastFetchAt() != null ? new Date(getLastFetchAt()!).toISOString() : null,
    hasData: today !== null,
  };
}
