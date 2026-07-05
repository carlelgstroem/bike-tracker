import { thresholds } from './config/thresholds.js';

/**
 * Pure verdict function — no I/O, fully unit-tested. Given the morning's
 * readiness inputs it returns the "Ska jag cykla idag?" recommendation.
 */

export type VerdictLevel = 'green' | 'yellow' | 'red';

export interface VerdictInput {
  recovery: number | null; // %
  hrv: number | null; // ms (today)
  hrvBaseline: number | null; // ms (30-day)
  restingHr: number | null; // bpm (today)
  rhrBaseline: number | null; // bpm (30-day)
  sleepPerformance: number | null; // %
  yesterdayStrain: number | null;
  /** Length of the best contiguous ride window today, in hours (0 if none). */
  rideWindowHours: number;
  maxHeartRate: number | null; // bpm, for HR-ceiling numbers
}

export interface RidePrescription {
  bike: string;
  workout: string;
  durationMin: number;
  /** Absolute bpm ceiling if max HR is known, else null. */
  hrCeilingBpm: number | null;
  /** Ceiling as % of max HR (always present). */
  hrCeilingPct: number;
  /** e.g. "14–16" or "< 10". */
  targetStrain: string;
  indoor: boolean;
  /** Primary training zone (1–5), or null on a rest day. */
  zone: number | null;
  /** Target zone as an absolute bpm range, if max HR is known. */
  zoneBpm: [number, number] | null;
}

export interface Verdict {
  level: VerdictLevel;
  title: string; // Swedish headline
  recommendation: RidePrescription;
  alternative: RidePrescription | null;
  reasons: string[];
  /** True if weather forced an indoor/rest downgrade. */
  weatherLimited: boolean;
}

function ceilingBpm(maxHr: number | null, pct: number): number | null {
  return maxHr === null ? null : Math.round((pct / 100) * maxHr);
}

/** Absolute [low, high] bpm for a zone, or null if max HR is unknown. */
function zoneBpm(maxHr: number | null, zone: number): [number, number] | null {
  const band = thresholds.hrZones[zone];
  if (maxHr === null || !band) return null;
  return [Math.round((band[0] / 100) * maxHr), Math.round((band[1] / 100) * maxHr)];
}

function hardRide(maxHr: number | null, indoor = false): RidePrescription {
  const p = thresholds.prescriptions.hard;
  return {
    bike: indoor ? 'Inomhus (trainer)' : p.bike,
    workout: indoor ? 'Intervaller på trainer' : p.workout,
    durationMin: p.durationMin,
    hrCeilingBpm: ceilingBpm(maxHr, p.hrCeilingPct),
    hrCeilingPct: p.hrCeilingPct,
    targetStrain: `${p.targetStrain[0]}–${p.targetStrain[1]}`,
    indoor,
    zone: p.zone,
    zoneBpm: zoneBpm(maxHr, p.zone),
  };
}

function easyRide(maxHr: number | null, indoor = false): RidePrescription {
  const p = thresholds.prescriptions.easy;
  return {
    bike: indoor ? 'Inomhus (trainer)' : p.bike,
    workout: indoor ? 'Lugn spin på trainer' : p.workout,
    durationMin: p.durationMin,
    hrCeilingBpm: ceilingBpm(maxHr, p.hrCeilingPct),
    hrCeilingPct: p.hrCeilingPct,
    targetStrain: `< ${p.targetStrainMax}`,
    indoor,
    zone: p.zone,
    zoneBpm: zoneBpm(maxHr, p.zone),
  };
}

function restCard(_maxHr: number | null): RidePrescription {
  return {
    bike: '—',
    workout: 'Vila / lätt promenad',
    durationMin: 0,
    hrCeilingBpm: null,
    hrCeilingPct: 0,
    targetStrain: '0',
    indoor: false,
    zone: null,
    zoneBpm: null,
  };
}

/** HRV drop as a positive % below baseline (0 if at/above baseline or unknown). */
function hrvDropPct(hrv: number | null, baseline: number | null): number | null {
  if (hrv === null || baseline === null || baseline <= 0) return null;
  return ((baseline - hrv) / baseline) * 100;
}

export function computeVerdict(input: VerdictInput): Verdict {
  const t = thresholds;
  const reasons: string[] = [];

  const drop = hrvDropPct(input.hrv, input.hrvBaseline);
  const badHrv = drop !== null && drop > t.hrvDropRedPct;
  const recovery = input.recovery;

  // ---- Decide the color level (recovery-first, HRV override to red) ----
  let level: VerdictLevel;
  if (recovery === null) {
    // No recovery score yet — be conservative, treat as easy-only.
    level = 'yellow';
    reasons.push('Ingen recovery-poäng ännu — kör försiktigt.');
  } else if (recovery < t.recovery.red || badHrv) {
    level = 'red';
  } else if (recovery >= t.recovery.green) {
    level = 'green';
  } else {
    level = 'yellow';
  }

  if (badHrv && level === 'red') {
    reasons.push(
      `HRV ${drop!.toFixed(0)}% under baseline (gräns ${t.hrvDropRedPct}%) — vila.`,
    );
  }
  if (recovery !== null) {
    reasons.push(`Recovery ${recovery}%.`);
  }

  // Green requires good sleep; otherwise it's a green body on a tired night → easy.
  const sleepOk =
    input.sleepPerformance !== null && input.sleepPerformance >= t.sleepPerformanceGood;
  if (level === 'green' && !sleepOk) {
    level = 'yellow';
    reasons.push(
      input.sleepPerformance === null
        ? 'Ingen sömndata — håller det lugnt.'
        : `Sömn ${input.sleepPerformance}% (< ${t.sleepPerformanceGood}%) — grönt men trött, kör lugnt.`,
    );
  } else if (level === 'green') {
    reasons.push(`Sömn ${input.sleepPerformance}%.`);
  }

  const maxHr = input.maxHeartRate;

  // ---- Base prescription from level ----
  let recommendation: RidePrescription;
  let alternative: RidePrescription | null;
  let title: string;
  switch (level) {
    case 'green':
      title = 'Ja — kör hårt';
      recommendation = hardRide(maxHr);
      alternative = easyRide(maxHr); // always offer the easy option
      break;
    case 'yellow':
      title = 'Ja — lugnt';
      recommendation = easyRide(maxHr);
      alternative = null;
      break;
    case 'red':
    default:
      title = 'Nej — vila';
      recommendation = restCard(maxHr);
      alternative = null;
      break;
  }

  // ---- Weather gate: too small a window downgrades outdoor → indoor/rest ----
  let weatherLimited = false;
  if (level !== 'red' && input.rideWindowHours < t.weather.minRideWindowHours) {
    weatherLimited = true;
    reasons.push(
      input.rideWindowHours <= 0
        ? 'Inget bra väderfönster idag — kör inomhus.'
        : `Väderfönstret är bara ${input.rideWindowHours} h (< ${t.weather.minRideWindowHours} h) — kör inomhus.`,
    );
    recommendation =
      level === 'green' ? hardRide(maxHr, true) : easyRide(maxHr, true);
    alternative = level === 'green' ? easyRide(maxHr, true) : null;
  }

  return { level, title, recommendation, alternative, reasons, weatherLimited };
}
