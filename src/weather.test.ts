import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeBestWindow, type HourForecast } from './weather.js';

/** Build an hourly array for hours 0..23 with per-hour precip/wind overrides. */
function makeHours(
  spec: Partial<Record<number, { precip?: number; wind?: number }>>,
): HourForecast[] {
  return Array.from({ length: 24 }, (_, hour) => ({
    time: `2026-07-05T${hour.toString().padStart(2, '0')}:00`,
    hour,
    temperature: 20,
    precipProbability: spec[hour]?.precip ?? 0,
    windSpeed: spec[hour]?.wind ?? 5,
    windDirection: 180,
    weatherCode: 1,
  }));
}

test('all-clear day → window spans the full 06–20 band', () => {
  const w = computeBestWindow(makeHours({}));
  assert.ok(w);
  assert.equal(w.startHour, 6);
  assert.equal(w.endHour, 20);
  assert.equal(w.hours, 14);
  assert.equal(w.startLabel, '06:00');
  assert.equal(w.endLabel, '20:00');
});

test('rain midday splits the day; picks the longer block', () => {
  // Rain 10:00–13:00. Morning block 06–10 (4h), afternoon 13–20 (7h) → afternoon wins.
  const w = computeBestWindow(
    makeHours({ 10: { precip: 80 }, 11: { precip: 80 }, 12: { precip: 80 } }),
  );
  assert.ok(w);
  assert.equal(w.startHour, 13);
  assert.equal(w.endHour, 20);
  assert.equal(w.hours, 7);
});

test('high wind makes hours unrideable', () => {
  // Wind kills 06–17; only 17,18,19 rideable → 17–20.
  const spec: Record<number, { wind: number }> = {};
  for (let h = 6; h < 17; h++) spec[h] = { wind: 35 };
  const w = computeBestWindow(makeHours(spec));
  assert.ok(w);
  assert.equal(w.startHour, 17);
  assert.equal(w.hours, 3);
});

test('boundary: 30% precip is NOT rideable (strict <30)', () => {
  const spec: Record<number, { precip: number }> = {};
  for (let h = 6; h < 20; h++) spec[h] = { precip: 30 };
  assert.equal(computeBestWindow(makeHours(spec)), null);
});

test('boundary: 29% precip IS rideable', () => {
  const spec: Record<number, { precip: number }> = {};
  for (let h = 6; h < 20; h++) spec[h] = { precip: 29 };
  const w = computeBestWindow(makeHours(spec));
  assert.ok(w);
  assert.equal(w.hours, 14);
});

test('washed-out day → null window', () => {
  const spec: Record<number, { precip: number }> = {};
  for (let h = 0; h < 24; h++) spec[h] = { precip: 95 };
  assert.equal(computeBestWindow(makeHours(spec)), null);
});

test('only pre-06 / post-20 clear → null (outside ride band)', () => {
  const spec: Record<number, { precip: number }> = {};
  for (let h = 6; h < 20; h++) spec[h] = { precip: 90 };
  // hours outside 6–20 are clear by default, but must be ignored
  assert.equal(computeBestWindow(makeHours(spec)), null);
});
