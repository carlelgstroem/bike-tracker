import { config } from './config/index.js';
import { thresholds } from './config/thresholds.js';

/**
 * Open-Meteo integration (no API key). Fetches today's hourly forecast and
 * derives the best contiguous ride window. The window computation is a pure
 * function so it can be unit-tested without network.
 */

export interface HourForecast {
  time: string; // ISO local, e.g. "2026-07-05T14:00"
  hour: number; // 0–23 local
  temperature: number; // °C
  precipProbability: number; // %
  windSpeed: number; // km/h
  windDirection: number; // degrees
  weatherCode: number; // WMO code
}

export interface RideWindow {
  startHour: number; // local hour the window opens
  endHour: number; // local hour it closes (exclusive)
  hours: number; // length in hours
  startLabel: string; // "06:00"
  endLabel: string; // "09:00"
}

export interface CurrentWeather {
  temperature: number;
  windSpeed: number;
  windDirection: number;
  precipitation: number;
  weatherCode: number;
  description: string;
}

export interface WeatherReport {
  current: CurrentWeather;
  hours: HourForecast[];
  bestWindow: RideWindow | null;
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

/**
 * Longest contiguous block of "rideable" hours within [dayStart, dayEnd),
 * where an hour is rideable if precip prob and wind are both under the limits.
 * Pure — feed it the hourly array.
 */
export function computeBestWindow(hours: HourForecast[]): RideWindow | null {
  const { dayStartHour, dayEndHour, maxPrecipProbability, maxWindKmh } = thresholds.weather;

  const inDay = hours.filter((h) => h.hour >= dayStartHour && h.hour < dayEndHour);
  const rideable = (h: HourForecast) =>
    h.precipProbability < maxPrecipProbability && h.windSpeed < maxWindKmh;

  let best: { start: number; end: number } | null = null;
  let runStart: number | null = null;

  for (let i = 0; i < inDay.length; i++) {
    const h = inDay[i]!;
    if (rideable(h)) {
      if (runStart === null) runStart = h.hour;
      const end = h.hour + 1;
      if (!best || end - runStart > best.end - best.start) {
        best = { start: runStart, end };
      }
    } else {
      runStart = null;
    }
  }

  if (!best) return null;
  return {
    startHour: best.start,
    endHour: best.end,
    hours: best.end - best.start,
    startLabel: `${pad2(best.start)}:00`,
    endLabel: `${pad2(best.end)}:00`,
  };
}

// WMO weather interpretation codes → short label.
const WMO: Record<number, string> = {
  0: 'Klart',
  1: 'Mest klart',
  2: 'Halvklart',
  3: 'Mulet',
  45: 'Dimma',
  48: 'Underkyld dimma',
  51: 'Lätt duggregn',
  53: 'Duggregn',
  55: 'Tätt duggregn',
  61: 'Lätt regn',
  63: 'Regn',
  65: 'Kraftigt regn',
  66: 'Underkylt regn',
  67: 'Kraftigt underkylt regn',
  71: 'Lätt snöfall',
  73: 'Snöfall',
  75: 'Kraftigt snöfall',
  77: 'Snökorn',
  80: 'Lätta regnskurar',
  81: 'Regnskurar',
  82: 'Kraftiga regnskurar',
  85: 'Snöbyar',
  86: 'Kraftiga snöbyar',
  95: 'Åska',
  96: 'Åska med hagel',
  99: 'Kraftig åska med hagel',
};

export function describeWeatherCode(code: number): string {
  return WMO[code] ?? `Kod ${code}`;
}

interface OpenMeteoResponse {
  current: {
    temperature_2m: number;
    wind_speed_10m: number;
    wind_direction_10m: number;
    precipitation: number;
    weather_code: number;
  };
  hourly: {
    time: string[];
    temperature_2m: number[];
    precipitation_probability: number[];
    wind_speed_10m: number[];
    wind_direction_10m: number[];
    weather_code: number[];
  };
}

export async function fetchWeather(): Promise<WeatherReport> {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(config.weather.latitude));
  url.searchParams.set('longitude', String(config.weather.longitude));
  url.searchParams.set('timezone', config.weather.timezone);
  url.searchParams.set('wind_speed_unit', 'kmh');
  url.searchParams.set('forecast_days', '1');
  url.searchParams.set(
    'current',
    'temperature_2m,wind_speed_10m,wind_direction_10m,precipitation,weather_code',
  );
  url.searchParams.set(
    'hourly',
    'temperature_2m,precipitation_probability,wind_speed_10m,wind_direction_10m,weather_code',
  );

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Open-Meteo request failed (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as OpenMeteoResponse;

  const hours: HourForecast[] = data.hourly.time.map((time, i) => ({
    time,
    hour: Number.parseInt(time.slice(11, 13), 10), // "YYYY-MM-DDTHH:MM"
    temperature: data.hourly.temperature_2m[i]!,
    precipProbability: data.hourly.precipitation_probability[i]!,
    windSpeed: data.hourly.wind_speed_10m[i]!,
    windDirection: data.hourly.wind_direction_10m[i]!,
    weatherCode: data.hourly.weather_code[i]!,
  }));

  const current: CurrentWeather = {
    temperature: data.current.temperature_2m,
    windSpeed: data.current.wind_speed_10m,
    windDirection: data.current.wind_direction_10m,
    precipitation: data.current.precipitation,
    weatherCode: data.current.weather_code,
    description: describeWeatherCode(data.current.weather_code),
  };

  return { current, hours, bestWindow: computeBestWindow(hours) };
}
