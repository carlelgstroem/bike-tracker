/**
 * Verdict tuning knobs. Kept in one place so you can adjust the ride logic
 * without touching the decision code. All percentages are 0–100.
 */
export const thresholds = {
  recovery: {
    /** >= this is "green" (WHOOP's green band starts at 67). */
    green: 67,
    /** < this is "red". 34–66 is "yellow". */
    red: 34,
  },
  /** Sleep performance needed to allow a hard day even when recovery is green. */
  sleepPerformanceGood: 80,
  /** HRV this many % below the 30-day baseline forces a rest day. */
  hrvDropRedPct: 15,
  weather: {
    /** A ride window shorter than this (hours) downgrades to indoor/rest. */
    minRideWindowHours: 1,
    /** Ride-window search bounds (local hour, 24h). */
    dayStartHour: 6,
    dayEndHour: 20,
    /** Rain probability (%) at or above this makes an hour "bad". */
    maxPrecipProbability: 30,
    /** Wind speed (km/h) at or above this makes an hour "bad". */
    maxWindKmh: 30,
  },
  /** Prescriptions per verdict level. HR ceilings are % of max HR. */
  prescriptions: {
    hard: {
      bike: 'Landsväg (road)',
      workout: 'Intervaller / tröskel',
      targetStrain: [14, 16] as [number, number],
      hrCeilingPct: 90,
      durationMin: 90,
    },
    easy: {
      bike: 'Grus (gravel)',
      workout: 'Lugn zon 2',
      targetStrainMax: 10,
      hrCeilingPct: 70,
      durationMin: 75,
    },
  },
} as const;

export type Thresholds = typeof thresholds;
