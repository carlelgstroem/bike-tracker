import { config } from '../config/index.js';
import { getValidAccessToken } from './oauth.js';

/**
 * Thin typed client over the WHOOP API v2 REST endpoints we care about.
 * Only the fields Munin uses are typed; WHOOP returns more.
 */

// ---- Response shapes (subset) ----

export interface Cycle {
  id: number;
  start: string;
  end: string | null;
  score_state: string;
  score?: {
    strain: number;
    average_heart_rate: number;
    max_heart_rate: number;
    kilojoule: number;
  };
}

export interface Recovery {
  cycle_id: number;
  sleep_id: string;
  score_state: string;
  score?: {
    recovery_score: number;
    hrv_rmssd_milli: number;
    resting_heart_rate: number;
    user_calibrating: boolean;
  };
}

export interface Sleep {
  id: string;
  start: string;
  end: string;
  nap: boolean;
  score_state: string;
  score?: {
    sleep_performance_percentage: number;
    sleep_needed: {
      baseline_milli: number;
      need_from_sleep_debt_milli: number;
      need_from_recent_strain_milli: number;
    };
    stage_summary: {
      total_in_bed_time_milli: number;
      total_awake_time_milli: number;
      total_light_sleep_time_milli: number;
      total_slow_wave_sleep_time_milli: number;
      total_rem_sleep_time_milli: number;
    };
  };
}

export interface Workout {
  id: string;
  start: string;
  end: string;
  sport_id: number;
  score_state: string;
  score?: {
    strain: number;
    average_heart_rate: number;
    max_heart_rate: number;
    kilojoule: number;
  };
}

export interface UserProfile {
  user_id: number;
  email: string;
  first_name: string;
  last_name: string;
}

export interface BodyMeasurement {
  height_meter: number;
  weight_kilogram: number;
  max_heart_rate: number;
}

interface Paginated<T> {
  records: T[];
  next_token?: string;
}

// ---- Core request helper ----

async function whoopGet<T>(path: string, params?: Record<string, string>): Promise<T> {
  const token = await getValidAccessToken();
  const url = new URL(`${config.whoop.apiBase}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`WHOOP GET ${path} failed (${res.status}): ${text}`);
  }
  return JSON.parse(text) as T;
}

// ---- Endpoints ----

/** Most recent physiological cycle (today's cycle, typically). */
export async function getLatestCycle(): Promise<Cycle | null> {
  const page = await whoopGet<Paginated<Cycle>>('/cycle', { limit: '1' });
  return page.records[0] ?? null;
}

/** All cycles that started within [start, now]. Handles pagination. */
export async function getCyclesSince(start: Date): Promise<Cycle[]> {
  const out: Cycle[] = [];
  let nextToken: string | undefined;
  do {
    const params: Record<string, string> = { limit: '25', start: start.toISOString() };
    if (nextToken) params.nextToken = nextToken;
    const page = await whoopGet<Paginated<Cycle>>('/cycle', params);
    out.push(...page.records);
    nextToken = page.next_token;
  } while (nextToken);
  return out;
}

/** Recovery attached to a given cycle. */
export async function getRecoveryForCycle(cycleId: number): Promise<Recovery | null> {
  try {
    return await whoopGet<Recovery>(`/cycle/${cycleId}/recovery`);
  } catch (err) {
    // 404 => recovery not scored yet for this cycle.
    if (err instanceof Error && err.message.includes('(404)')) return null;
    throw err;
  }
}

/** Most recent sleep activity. */
export async function getLatestSleep(): Promise<Sleep | null> {
  const page = await whoopGet<Paginated<Sleep>>('/activity/sleep', { limit: '1' });
  return page.records[0] ?? null;
}

/** All sleeps within [start, now]. Handles pagination. */
export async function getSleepsSince(start: Date): Promise<Sleep[]> {
  const out: Sleep[] = [];
  let nextToken: string | undefined;
  do {
    const params: Record<string, string> = { limit: '25', start: start.toISOString() };
    if (nextToken) params.nextToken = nextToken;
    const page = await whoopGet<Paginated<Sleep>>('/activity/sleep', params);
    out.push(...page.records);
    nextToken = page.next_token;
  } while (nextToken);
  return out;
}

/** Workouts within [start, now]. Handles pagination. */
export async function getWorkoutsSince(start: Date): Promise<Workout[]> {
  const out: Workout[] = [];
  let nextToken: string | undefined;
  do {
    const params: Record<string, string> = { limit: '25', start: start.toISOString() };
    if (nextToken) params.nextToken = nextToken;
    const page = await whoopGet<Paginated<Workout>>('/activity/workout', params);
    out.push(...page.records);
    nextToken = page.next_token;
  } while (nextToken);
  return out;
}

export async function getUserProfile(): Promise<UserProfile> {
  return whoopGet<UserProfile>('/user/profile/basic');
}

export async function getBodyMeasurement(): Promise<BodyMeasurement> {
  return whoopGet<BodyMeasurement>('/user/measurement/body');
}
