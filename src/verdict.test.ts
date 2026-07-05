import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeVerdict, type VerdictInput } from './verdict.js';

/** A healthy baseline input: green recovery, good sleep, clear weather. */
function base(overrides: Partial<VerdictInput> = {}): VerdictInput {
  return {
    recovery: 75,
    hrv: 60,
    hrvBaseline: 58,
    restingHr: 48,
    rhrBaseline: 49,
    sleepPerformance: 88,
    yesterdayStrain: 8,
    rideWindowHours: 5,
    maxHeartRate: 190,
    ...overrides,
  };
}

test('green recovery + good sleep + clear weather → hard road ride', () => {
  const v = computeVerdict(base());
  assert.equal(v.level, 'green');
  assert.equal(v.title, 'Ja — kör hårt');
  assert.equal(v.recommendation.bike, 'Landsväg (road)');
  assert.equal(v.recommendation.indoor, false);
  assert.equal(v.recommendation.hrCeilingPct, 90);
  assert.equal(v.recommendation.hrCeilingBpm, 171); // round(0.9 * 190)
  assert.equal(v.recommendation.targetStrain, '14–16');
  assert.ok(v.alternative && !v.alternative.indoor, 'offers an easy alternative');
});

test('green recovery but poor sleep → downgraded to easy (yellow)', () => {
  const v = computeVerdict(base({ sleepPerformance: 70 }));
  assert.equal(v.level, 'yellow');
  assert.equal(v.title, 'Ja — lugnt');
  assert.equal(v.recommendation.bike, 'Grus (gravel)');
  assert.equal(v.recommendation.hrCeilingPct, 70);
  assert.equal(v.recommendation.hrCeilingBpm, 133); // round(0.7 * 190)
});

test('yellow recovery → easy gravel ride', () => {
  const v = computeVerdict(base({ recovery: 50 }));
  assert.equal(v.level, 'yellow');
  assert.equal(v.recommendation.bike, 'Grus (gravel)');
  assert.equal(v.alternative, null);
});

test('red recovery → rest day', () => {
  const v = computeVerdict(base({ recovery: 25 }));
  assert.equal(v.level, 'red');
  assert.equal(v.title, 'Nej — vila');
  assert.equal(v.recommendation.durationMin, 0);
});

test('HRV >15% below baseline forces red even with high recovery', () => {
  // baseline 60, today 45 → 25% below.
  const v = computeVerdict(base({ recovery: 80, hrv: 45, hrvBaseline: 60 }));
  assert.equal(v.level, 'red');
  assert.ok(v.reasons.some((r) => r.includes('HRV')), 'explains the HRV reason');
});

test('HRV just under the 15% threshold stays green', () => {
  // baseline 60, today 51.5 → ~14.2% below.
  const v = computeVerdict(base({ hrv: 51.5, hrvBaseline: 60 }));
  assert.equal(v.level, 'green');
});

test('no ride window → indoor downgrade, keeps color intent', () => {
  const v = computeVerdict(base({ rideWindowHours: 0 }));
  assert.equal(v.level, 'green');
  assert.equal(v.weatherLimited, true);
  assert.equal(v.recommendation.indoor, true);
  assert.ok(v.reasons.some((r) => r.toLowerCase().includes('inomhus')));
});

test('sub-1h window on an easy day → indoor easy', () => {
  const v = computeVerdict(base({ recovery: 50, rideWindowHours: 0 }));
  assert.equal(v.level, 'yellow');
  assert.equal(v.weatherLimited, true);
  assert.equal(v.recommendation.indoor, true);
});

test('red day is unaffected by weather (already resting)', () => {
  const v = computeVerdict(base({ recovery: 20, rideWindowHours: 0 }));
  assert.equal(v.level, 'red');
  assert.equal(v.weatherLimited, false);
});

test('missing recovery score → conservative yellow', () => {
  const v = computeVerdict(base({ recovery: null }));
  assert.equal(v.level, 'yellow');
});

test('unknown max HR → percentage ceiling, null bpm', () => {
  const v = computeVerdict(base({ maxHeartRate: null }));
  assert.equal(v.recommendation.hrCeilingBpm, null);
  assert.equal(v.recommendation.hrCeilingPct, 90);
});
