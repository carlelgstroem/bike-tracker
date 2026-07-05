import type { DashboardData, MetricCard } from './readiness.js';
import type { RidePrescription } from './verdict.js';
import type { TrainingLoad } from './training.js';

/**
 * Server-side HTML for the dashboard. No client framework: one self-contained
 * page with inline CSS and an inline SVG ridgeline. Mobile-first, dark by
 * default, light via prefers-color-scheme.
 *
 * Design: a "dawn instrument panel". The verdict band is the single loud
 * element and its colour is the message; the metric row is a quiet run of
 * tabular figures, cycling-computer style.
 */

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function n1(v: number | null): string {
  return v === null ? '–' : v.toFixed(1);
}
function n0(v: number | null): string {
  return v === null ? '–' : Math.round(v).toString();
}

const COMPASS = ['N', 'NO', 'O', 'SO', 'S', 'SV', 'V', 'NV'];
function compass(deg: number): string {
  return COMPASS[Math.round(deg / 45) % 8]!;
}

/** Raven mark reused as wordmark + ghosted verdict watermark. */
const RAVEN =
  '<path d="M2 13c3-1 5-3 8-3 1-2 3-3 6-3 2 0 3 1 4 2-1 0-2 0-3 1 1 0 2 1 2 2-2 0-3 0-5 1-2 2-5 3-8 3-3 0-5-2-6-4 1 0 1 1 2 1 0-1 0-2-1-3 2 0 3 1 5 2-1-1-3-2-5-2z"/>';

/** Small weather glyph (stroke = currentColor) chosen from the WMO code. */
function weatherIcon(code: number): string {
  const S = (inner: string) =>
    `<svg class="weather__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  const sun = '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5 5l1.4 1.4M17.6 17.6L19 19M19 5l-1.4 1.4M6.4 17.6L5 19"/>';
  const cloud = '<path d="M7 18h10a3.5 3.5 0 0 0 .3-7 5 5 0 0 0-9.6-1.2A3.9 3.9 0 0 0 7 18z"/>';
  const rain = cloud + '<path d="M9 20.5l-.6 1.5M13 20.5l-.6 1.5M17 20.5l-.6 1.5"/>';
  const snow = cloud + '<path d="M9 21h.01M13 21h.01M17 21h.01"/>';
  const storm = cloud + '<path d="M12 15l-2 4h3l-2 4"/>';
  const fog = '<path d="M4 9h16M4 13h16M6 17h12"/>';
  if (code === 0 || code === 1) return S(sun);
  if (code === 2) return S('<circle cx="9" cy="8" r="3"/>' + '<path d="M9 2.5v1.5M3.5 8H5M14.5 8H13M5.2 4.2l1 1M12.8 4.2l-1 1"/>' + '<path d="M8 19h9a3.2 3.2 0 0 0 .2-6.4A4.5 4.5 0 0 0 9 11.5 3.6 3.6 0 0 0 8 19z"/>');
  if (code === 45 || code === 48) return S(fog);
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return S(rain);
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return S(snow);
  if (code >= 95) return S(storm);
  return S(cloud);
}

/** Delta chip. `goodWhen` says which direction is favourable. */
function deltaChip(m: MetricCard, unit: string, goodWhen: 'higher' | 'lower'): string {
  if (m.delta === null) return '<span class="chip chip--flat">ingen baslinje</span>';
  const rounded = Math.round(m.delta * 10) / 10;
  const favourable = goodWhen === 'higher' ? rounded >= 0 : rounded <= 0;
  const arrow = rounded > 0 ? '▲' : rounded < 0 ? '▼' : '±';
  const sign = rounded > 0 ? '+' : '';
  const cls = rounded === 0 ? 'chip--flat' : favourable ? 'chip--good' : 'chip--bad';
  return `<span class="chip ${cls}">${arrow} ${sign}${n1(rounded)}${unit}</span>`;
}

function hrCeiling(p: RidePrescription): string {
  if (p.hrCeilingPct === 0) return '–';
  if (p.hrCeilingBpm !== null) return `${p.hrCeilingBpm} slag/min · ${p.hrCeilingPct}%`;
  return `~${p.hrCeilingPct}% av max`;
}

function zoneText(p: RidePrescription): string {
  if (p.zone === null) return '–';
  if (p.zoneBpm) return `Z${p.zone} · ${p.zoneBpm[0]}–${p.zoneBpm[1]}`;
  return `Z${p.zone}`;
}

function rideCard(p: RidePrescription, kind: 'primary' | 'alt'): string {
  const label = kind === 'primary' ? 'Rekommenderat pass' : 'Alternativ';

  // Rest day: no numbers to show — give guidance instead of empty dashes.
  if (p.durationMin === 0) {
    return `
    <article class="ride ride--${kind} ride--rest">
      <p class="eyebrow">${label}</p>
      <h3 class="ride__bike">Vila</h3>
      <p class="ride__rest">Kroppen är inte redo för belastning idag. Hoppa över cykeln — prioritera sömn, lätt rörelse och bra mat. Imorgon kan se helt annorlunda ut.</p>
    </article>`;
  }

  const ceiling = `<p class="ride__ceiling">Pulstak ${hrCeiling(p)}</p>`;
  return `
    <article class="ride ride--${kind}">
      <p class="eyebrow">${label}</p>
      <h3 class="ride__bike">${esc(p.bike)}</h3>
      <p class="ride__workout">${esc(p.workout)}</p>
      <dl class="ride__stats">
        <div><dt>Tid</dt><dd>${p.durationMin} min</dd></div>
        <div><dt>Målzon</dt><dd>${zoneText(p)}</dd></div>
        <div><dt>Strain</dt><dd>${p.targetStrain}</dd></div>
      </dl>
      ${ceiling}
    </article>`;
}

function acwrLabel(acwr: number | null): { text: string; cls: string } {
  if (acwr === null) return { text: '–', cls: 'chip--flat' };
  if (acwr < 0.8) return { text: 'lågt', cls: 'chip--flat' };
  if (acwr <= 1.3) return { text: 'optimalt', cls: 'chip--good' };
  if (acwr <= 1.5) return { text: 'lite tungt', cls: 'chip--flat' };
  return { text: 'högt — skaderisk', cls: 'chip--bad' };
}

function trainingCard(load: TrainingLoad): string {
  const rides = load.recentWorkouts
    .map((w) => {
      const d = new Date(w.start).toLocaleDateString('sv-SE', { weekday: 'short', day: 'numeric' });
      const dur = w.durationMin >= 60
        ? `${Math.floor(w.durationMin / 60)}h${String(w.durationMin % 60).padStart(2, '0')}`
        : `${w.durationMin} min`;
      const strain = w.strain !== null ? `strain ${w.strain.toFixed(1)}` : '';
      const hr = w.avgHr !== null ? ` · ${w.avgHr} bpm` : '';
      return `<li><span class="tl__day">${esc(d)}</span><span class="tl__meta">${dur} · ${strain}${hr}</span></li>`;
    })
    .join('');
  const a = acwrLabel(load.acwr);
  return `
    <section class="training">
      <p class="eyebrow">Träningsbelastning</p>
      <div class="tl__top">
        <div class="tl__stat">
          <span class="tl__num">${load.weekTotal !== null ? load.weekTotal.toFixed(0) : '–'}</span>
          <span class="tl__cap">strain / 7 dagar</span>
        </div>
        <div class="tl__stat">
          <span class="tl__num">${load.acwr !== null ? load.acwr.toFixed(2) : '–'}</span>
          <span class="tl__cap">ACWR <span class="chip ${a.cls}">${a.text}</span></span>
        </div>
      </div>
      ${rides ? `<ul class="tl__list">${rides}</ul>` : '<p class="spark__empty">Inga pass registrerade den senaste veckan.</p>'}
    </section>`;
}

/** Interactive multi-metric chart section: metric + range tabs, drawn by inline JS. */
function chartSection(d: DashboardData): string {
  const known = d.history.filter((h) => h.recovery !== null).length;
  if (known < 2) {
    return `
    <section class="history">
      <p class="eyebrow">Trend</p>
      <p class="spark__empty">Historiken byggs upp allt eftersom — ${known} dag${known === 1 ? '' : 'ar'} hittills.</p>
    </section>`;
  }
  const payload = {
    history: d.history,
    hrvBaseline: d.hrv.baseline,
    rhrBaseline: d.restingHr.baseline,
  };
  return `
    <section class="history">
      <div class="chart__tabs" id="metricTabs" role="tablist" aria-label="Mått">
        <button data-metric="recovery" class="chart__tab is-on">Recovery</button>
        <button data-metric="hrv" class="chart__tab">HRV</button>
        <button data-metric="rhr" class="chart__tab">Vilopuls</button>
        <button data-metric="sleep" class="chart__tab">Sömn</button>
      </div>
      <div class="chart__wrap">
        <svg id="chartSvg" class="chart" viewBox="0 0 320 120" preserveAspectRatio="none" role="img" aria-label="Trend"></svg>
        <div id="chartTip" class="chart__tip" hidden></div>
      </div>
      <div class="chart__ranges" id="rangeTabs" role="tablist" aria-label="Intervall">
        <button data-range="14" class="chart__range is-on">14 d</button>
        <button data-range="30" class="chart__range">30 d</button>
        <button data-range="90" class="chart__range">90 d</button>
      </div>
      <script type="application/json" id="munin-chart">${JSON.stringify(payload).replace(/</g, '\\u003c')}</script>
    </section>`;
}

/** Standalone login page (same visual language as the dashboard). */
export function renderLogin(opts: { next: string; error?: boolean }): string {
  const err = opts.error
    ? `<p class="login__err">Fel lösenord. Försök igen.</p>`
    : '';
  return `<!doctype html>
<html lang="sv">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#0e1420" />
<title>Munin — logga in</title>
<style>
:root{ --bg:#0e1420; --panel:#161d2b; --ink:#eef1f6; --muted:#8a97ac; --line:#232c3d; --dawn:#5b7fa6; --red:#c2483d; }
@media (prefers-color-scheme: light){ :root{ --bg:#eef1f4; --panel:#fff; --ink:#121722; --muted:#5c6579; --line:#dde2ea; } }
*{ box-sizing:border-box; }
html,body{ margin:0; height:100%; }
body{ background:var(--bg); color:var(--ink); font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; -webkit-font-smoothing:antialiased; display:grid; place-items:center; padding:24px; }
.card{ width:100%; max-width:340px; background:var(--panel); border:1px solid var(--line); border-radius:18px; padding:26px 22px; }
.brand{ display:flex; align-items:center; gap:9px; font-weight:800; letter-spacing:.14em; text-transform:uppercase; font-size:.82rem; margin-bottom:4px; }
.brand svg{ width:20px; height:20px; fill:var(--dawn); }
.sub{ margin:0 0 20px; color:var(--muted); font-size:.82rem; }
label{ display:block; font-size:.68rem; letter-spacing:.12em; text-transform:uppercase; color:var(--muted); font-weight:700; margin:0 0 7px; }
input[type=password]{ width:100%; padding:12px 13px; border-radius:11px; border:1px solid var(--line); background:var(--bg); color:var(--ink); font-size:1rem; }
input:focus{ outline:2px solid var(--dawn); outline-offset:1px; }
button{ width:100%; margin-top:14px; padding:12px; border:0; border-radius:11px; background:var(--dawn); color:#fff; font-weight:800; font-size:1rem; cursor:pointer; }
.login__err{ margin:12px 0 0; color:var(--red); font-size:.82rem; font-weight:600; }
</style>
</head>
<body>
<main class="card">
  <div class="brand">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 13c3-1 5-3 8-3 1-2 3-3 6-3 2 0 3 1 4 2-1 0-2 0-3 1 1 0 2 1 2 2-2 0-3 0-5 1-2 2-5 3-8 3-3 0-5-2-6-4 1 0 1 1 2 1 0-1 0-2-1-3 2 0 3 1 5 2-1-1-3-2-5-2z"/></svg>
    Munin
  </div>
  <p class="sub">Ska jag cykla idag?</p>
  <form method="post" action="/login">
    <input type="hidden" name="next" value="${esc(opts.next)}" />
    <label for="pw">Lösenord</label>
    <input id="pw" name="password" type="password" autocomplete="current-password" autofocus required />
    <button type="submit">Logga in</button>
    ${err}
  </form>
</main>
</body>
</html>`;
}

export function renderDashboard(d: DashboardData): string {
  const v = d.verdict;
  const level = v.level; // green | yellow | red

  const reasons = v.reasons.map((r) => `<li>${esc(r)}</li>`).join('');

  const metrics = `
    <section class="metrics" aria-label="Nyckeltal">
      <div class="metric">
        <p class="metric__label">Recovery</p>
        <p class="metric__value">${n0(d.recovery)}<span class="metric__unit">%</span></p>
        <p class="metric__foot">WHOOP recovery</p>
      </div>
      <div class="metric">
        <p class="metric__label">HRV</p>
        <p class="metric__value">${n1(d.hrv.value)}<span class="metric__unit">ms</span></p>
        <p class="metric__foot">${deltaChip(d.hrv, 'ms', 'higher')}</p>
      </div>
      <div class="metric">
        <p class="metric__label">Vilopuls</p>
        <p class="metric__value">${n0(d.restingHr.value)}<span class="metric__unit">bpm</span></p>
        <p class="metric__foot">${deltaChip(d.restingHr, ' bpm', 'lower')}</p>
      </div>
      <div class="metric">
        <p class="metric__label">Sömn</p>
        <p class="metric__value">${n0(d.sleep.performance)}<span class="metric__unit">%</span></p>
        <p class="metric__foot">${
          d.sleep.actualHours != null && d.sleep.neededHours != null
            ? `${n1(d.sleep.actualHours)} / ${n1(d.sleep.neededHours)} h`
            : 'ingen sömndata'
        }</p>
      </div>
    </section>`;

  const rides = `
    <section class="rides">
      ${rideCard(v.recommendation, 'primary')}
      ${v.alternative ? rideCard(v.alternative, 'alt') : ''}
    </section>`;

  let weather: string;
  if (d.weather) {
    weather = `
    <section class="weather">
      <p class="eyebrow">Väder · Washington DC</p>
      <div class="weather__row">
        <div class="weather__now">
          ${weatherIcon(d.weather.current.weatherCode)}
          <span class="weather__temp">${n0(d.weather.current.temperature)}°</span>
          <span class="weather__desc">${esc(d.weather.current.description)}</span>
        </div>
        <div class="weather__wind">
          ${n0(d.weather.current.windSpeed)} km/h ${compass(d.weather.current.windDirection)}
        </div>
      </div>
      <p class="weather__window">
        ${
          d.weather.bestWindow
            ? `Bästa fönster <strong>${d.weather.bestWindow.startLabel}–${d.weather.bestWindow.endLabel}</strong> · ${d.weather.bestWindow.hours} h`
            : 'Inget bra cykelfönster idag'
        }
      </p>
    </section>`;
  } else {
    const msg = d.nav.isLatest
      ? 'Väderdata kunde inte hämtas.'
      : 'Väder visas bara för dagens vy.';
    weather = `<section class="weather"><p class="eyebrow">Väder</p><p class="weather__window">${msg}</p></section>`;
  }

  const training = trainingCard(d.trainingLoad);
  const chart = chartSection(d);

  const noData = !d.hasData
    ? `<p class="notice">Ingen WHOOP-data ännu. Öppna <a href="/auth/whoop">/auth/whoop</a> för att koppla kontot.</p>`
    : '';

  // Day toggle: prev / next stored days. Next is disabled on the latest day.
  const prevLink = d.nav.prev
    ? `<a class="daynav__arrow" href="/?day=${d.nav.prev}" aria-label="Föregående dag" rel="prev">‹</a>`
    : `<span class="daynav__arrow is-off" aria-hidden="true">‹</span>`;
  const nextLink =
    d.nav.next && !d.nav.isLatest
      ? `<a class="daynav__arrow" href="/?day=${d.nav.next}" aria-label="Nästa dag" rel="next">›</a>`
      : `<span class="daynav__arrow is-off" aria-hidden="true">›</span>`;
  const center = d.nav.isLatest
    ? `<span class="daynav__badge">Idag</span>`
    : `<a class="daynav__today" href="/">Hoppa till idag</a>`;
  const daynav = d.hasData
    ? `<nav class="daynav" aria-label="Byt dag">${prevLink}${center}${nextLink}</nav>`
    : '';

  const question = d.nav.isLatest ? 'Ska jag cykla idag?' : 'Omdöme';

  const lastFetch = d.lastFetch
    ? new Date(d.lastFetch).toLocaleString('sv-SE', {
        hour: '2-digit',
        minute: '2-digit',
        day: 'numeric',
        month: 'short',
      })
    : '–';

  return `<!doctype html>
<html lang="sv" data-level="${level}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#0e1420" />
<link rel="manifest" href="/manifest.webmanifest" />
<link rel="apple-touch-icon" href="/icon-180.png" />
<link rel="icon" href="/icon-192.png" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<meta name="apple-mobile-web-app-title" content="Munin" />
<title>Munin — ${esc(v.title)}</title>
<style>
:root{
  --page:#0a0e17; --ink:#f3f6fb; --muted:#8f9bb0;
  --line:rgba(255,255,255,.09);
  --surface:linear-gradient(180deg,#1a2233 0%,#111724 100%);
  --card-shadow:0 12px 34px -18px rgba(0,0,0,.8), inset 0 1px 0 rgba(255,255,255,.05);
  --dawn:#7191c4;
  --good:#3fc394; --bad:#f0776b;
  --green1:#1aa572; --green2:#12885c; --green-ink:#eafff5; --green-glow:rgba(26,165,114,.55);
  --yellow1:#e2b04a; --yellow2:#c8922f; --yellow-ink:#241a04; --yellow-glow:rgba(226,176,74,.5);
  --red1:#d15144; --red2:#b23a30; --red-ink:#fff1ef; --red-glow:rgba(209,81,68,.5);
  --green:var(--green1); --yellow:var(--yellow1); --red:var(--red1);
  --v1:var(--green1); --v2:var(--green2); --v:var(--green1); --v-ink:var(--green-ink); --v-glow:var(--green-glow);
}
:root[data-level="yellow"]{ --v1:var(--yellow1); --v2:var(--yellow2); --v:var(--yellow1); --v-ink:var(--yellow-ink); --v-glow:var(--yellow-glow); }
:root[data-level="red"]{ --v1:var(--red1); --v2:var(--red2); --v:var(--red1); --v-ink:var(--red-ink); --v-glow:var(--red-glow); }
@media (prefers-color-scheme: light){
  :root{
    --page:#eef1f6; --ink:#111726; --muted:#61708a; --line:rgba(15,22,40,.10);
    --surface:linear-gradient(180deg,#ffffff 0%,#f5f7fb 100%);
    --card-shadow:0 10px 26px -18px rgba(20,30,60,.4), inset 0 1px 0 rgba(255,255,255,.7);
  }
}
*{ box-sizing:border-box; }
html,body{ margin:0; overflow-x:hidden; }
body{
  color:var(--ink); background:var(--page);
  background-image:radial-gradient(125% 85% at 50% -18%, rgba(66,98,158,.30) 0%, rgba(22,32,58,.10) 44%, transparent 72%);
  background-attachment:fixed;
  font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  -webkit-font-smoothing:antialiased; text-rendering:optimizeLegibility; line-height:1.4;
  padding:0 0 env(safe-area-inset-bottom);
  font-variant-numeric:tabular-nums;
}
@media (prefers-color-scheme: light){
  body{ background-image:radial-gradient(125% 85% at 50% -18%, rgba(120,150,214,.30) 0%, transparent 64%); }
}
.wrap{ width:100%; max-width:530px; margin:0 auto; padding:22px 16px 46px; }
.metrics>*, .rides>*, .weather__row>*, .masthead>*, .ride__stats>*, .foot>*{ min-width:0; }
svg{ max-width:100%; }
a{ color:inherit; }

/* Shared card surface */
.metric, .ride, .weather, .training, .history{
  background:var(--surface); border:1px solid var(--line); border-radius:16px; box-shadow:var(--card-shadow);
}

.masthead{ display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:18px; }
.wordmark{ display:flex; align-items:center; gap:9px; font-weight:800; letter-spacing:.16em; font-size:.82rem; text-transform:uppercase; }
.wordmark svg{ width:20px; height:20px; fill:var(--v); filter:drop-shadow(0 2px 7px var(--v-glow)); }
.masthead__date{ color:var(--muted); font-size:.78rem; text-transform:lowercase; white-space:nowrap; text-align:right; }
.eyebrow{ margin:0 0 10px; font-size:.66rem; letter-spacing:.18em; text-transform:uppercase; color:var(--muted); font-weight:700; }

/* Day toggle */
.daynav{ display:flex; align-items:center; justify-content:space-between; gap:10px; margin:0 0 18px; }
.daynav__arrow{ width:40px; height:40px; border-radius:12px; border:1px solid var(--line); background:var(--surface); box-shadow:var(--card-shadow); display:flex; align-items:center; justify-content:center; font-size:1.2rem; line-height:1; text-decoration:none; color:var(--ink); transition:transform .12s ease; }
.daynav__arrow:active{ transform:scale(.9); }
.daynav__arrow.is-off{ opacity:.25; box-shadow:none; }
.daynav__badge, .daynav__today{ font-size:.7rem; letter-spacing:.16em; text-transform:uppercase; font-weight:800; }
.daynav__badge{ color:var(--muted); }
.daynav__today{ color:var(--dawn); text-decoration:none; }

/* Verdict — the jewel */
.verdict{
  position:relative; overflow:hidden; color:var(--v-ink);
  background:linear-gradient(150deg, var(--v1) 0%, var(--v2) 100%);
  border-radius:24px; padding:26px 22px 22px; margin-bottom:20px;
  box-shadow:0 26px 70px -28px var(--v-glow), 0 4px 14px -8px var(--v-glow), inset 0 1px 0 rgba(255,255,255,.22);
}
.verdict::before{ content:""; position:absolute; inset:0; background:radial-gradient(90% 65% at 12% 0%, rgba(255,255,255,.20), transparent 60%); pointer-events:none; }
.verdict__mark{ position:absolute; right:-24px; bottom:-36px; width:210px; height:210px; fill:currentColor; opacity:.12; transform:rotate(-8deg); pointer-events:none; }
.verdict__q{ position:relative; margin:0 0 8px; font-size:.72rem; letter-spacing:.18em; text-transform:uppercase; opacity:.8; font-weight:800; }
.verdict__title{ position:relative; margin:0; font-size:2.7rem; line-height:1; font-weight:800; letter-spacing:-.03em; text-shadow:0 2px 22px rgba(0,0,0,.14); }
.verdict__reasons{ position:relative; margin:16px 0 0; padding:0; list-style:none; display:flex; flex-direction:column; gap:6px; }
.verdict__reasons li{ font-size:.87rem; opacity:.94; padding-left:15px; position:relative; }
.verdict__reasons li::before{ content:""; position:absolute; left:0; top:.52em; width:5px; height:5px; border-radius:50%; background:currentColor; opacity:.7; }

/* Instrument row */
.metrics{ display:grid; grid-template-columns:repeat(2,1fr); gap:12px; margin-bottom:20px; }
.metric{ padding:15px 16px; }
.metric__label{ margin:0 0 8px; font-size:.66rem; letter-spacing:.14em; text-transform:uppercase; color:var(--muted); font-weight:700; }
.metric__value{ margin:0; font-size:2.05rem; font-weight:800; letter-spacing:-.03em; line-height:1; overflow-wrap:anywhere; }
.metric__unit{ font-size:.85rem; font-weight:600; color:var(--muted); margin-left:3px; letter-spacing:0; }
.metric__foot{ margin:9px 0 0; font-size:.74rem; color:var(--muted); }
.chip{ display:inline-flex; align-items:center; gap:3px; font-size:.72rem; font-weight:700; padding:3px 8px; border-radius:999px; border:1px solid transparent; }
.chip--good{ background:color-mix(in srgb, var(--good) 15%, transparent); color:var(--good); border-color:color-mix(in srgb,var(--good) 30%,transparent); }
.chip--bad{ background:color-mix(in srgb, var(--bad) 15%, transparent); color:var(--bad); border-color:color-mix(in srgb,var(--bad) 30%,transparent); }
.chip--flat{ background:color-mix(in srgb, var(--muted) 14%, transparent); color:var(--muted); }

/* Ride cards */
.rides{ display:grid; grid-template-columns:1fr; gap:12px; margin-bottom:20px; }
.ride{ padding:16px 17px; }
/* A lone card (no alternative) shouldn't leave half the row empty. */
.rides>.ride:only-child{ grid-column:1 / -1; }
.ride--primary{ box-shadow:var(--card-shadow), inset 3px 0 0 var(--v); }
.ride__bike{ margin:0; font-size:1.2rem; font-weight:800; letter-spacing:-.01em; }
.ride__workout{ margin:3px 0 14px; color:var(--muted); font-size:.9rem; }
.ride__rest{ margin:6px 0 0; font-size:.95rem; line-height:1.55; color:var(--ink); opacity:.82; max-width:56ch; }
.ride__stats{ margin:0; display:grid; grid-template-columns:repeat(3,1fr); gap:8px; max-width:480px; }
.ride__stats dt{ font-size:.62rem; letter-spacing:.1em; text-transform:uppercase; color:var(--muted); font-weight:700; }
.ride__stats dd{ margin:4px 0 0; font-size:.92rem; font-weight:700; }
.ride__ceiling{ margin:12px 0 0; padding-top:11px; border-top:1px solid var(--line); font-size:.74rem; color:var(--muted); }

/* Weather */
.weather{ padding:16px 17px; margin-bottom:20px; }
.weather__row{ display:flex; align-items:center; justify-content:space-between; gap:12px; }
.weather__now{ display:flex; align-items:center; gap:12px; }
.weather__icon{ width:36px; height:36px; flex:none; color:var(--dawn); }
.weather__temp{ font-size:2rem; font-weight:800; letter-spacing:-.03em; line-height:1; overflow-wrap:anywhere; }
.weather__desc{ color:var(--muted); font-size:.9rem; }
.weather__wind{ color:var(--muted); font-size:.85rem; text-align:right; }
.weather__window{ margin:14px 0 0; padding-top:12px; border-top:1px solid var(--line); font-size:.9rem; }
.weather__window strong{ color:var(--dawn); font-weight:800; }

/* Training load */
.training{ padding:16px 17px; margin-bottom:20px; }
.tl__top{ display:flex; gap:28px; margin-bottom:14px; }
.tl__stat{ display:flex; flex-direction:column; gap:5px; }
.tl__num{ font-size:1.7rem; font-weight:800; letter-spacing:-.02em; line-height:1; }
.tl__cap{ font-size:.64rem; color:var(--muted); letter-spacing:.1em; text-transform:uppercase; font-weight:700; display:flex; align-items:center; gap:6px; }
.tl__list{ list-style:none; margin:0; padding:0; }
.tl__list li{ display:flex; justify-content:space-between; gap:10px; font-size:.82rem; border-top:1px solid var(--line); padding:8px 0; }
.tl__list li:last-child{ padding-bottom:0; }
.tl__day{ font-weight:700; text-transform:capitalize; }
.tl__meta{ color:var(--muted); }

/* Pair weather + training side by side on wider screens */
.duo{ display:grid; grid-template-columns:1fr; gap:12px; align-items:start; margin-bottom:20px; }
.duo>.weather, .duo>.training{ margin-bottom:0; }

/* Interactive chart */
.history{ padding:16px 17px; }
.chart__tabs{ display:flex; gap:6px; margin-bottom:14px; flex-wrap:wrap; }
.chart__ranges{ display:flex; gap:6px; margin-top:12px; justify-content:flex-end; }
.chart__tab, .chart__range{ font:inherit; cursor:pointer; border:1px solid var(--line); background:transparent; color:var(--muted); border-radius:10px; padding:7px 12px; font-size:.72rem; font-weight:700; transition:transform .12s, background .15s, color .15s; }
.chart__tab:hover, .chart__range:hover{ color:var(--ink); }
.chart__tab:active, .chart__range:active{ transform:scale(.94); }
.chart__tab.is-on, .chart__range.is-on{ background:color-mix(in srgb, var(--dawn) 18%, transparent); color:var(--ink); border-color:color-mix(in srgb, var(--dawn) 55%, transparent); }
.chart__wrap{ position:relative; }
.chart{ display:block; width:100%; height:130px; overflow:visible; touch-action:none; }
.chart__line{ stroke-width:2.4; stroke-linejoin:round; stroke-linecap:round; filter:drop-shadow(0 4px 10px rgba(0,0,0,.35)); }
.chart__dots circle{ opacity:.95; }
.chart__guide{ stroke:var(--line); stroke-width:1; stroke-dasharray:2 5; }
.chart__base{ stroke:var(--muted); stroke-width:1; stroke-dasharray:4 4; opacity:.5; }
.chart__tip{ position:absolute; top:-4px; background:var(--ink); color:var(--page); font-size:.72rem; font-weight:600; padding:4px 8px; border-radius:8px; pointer-events:none; white-space:nowrap; box-shadow:0 6px 18px -6px rgba(0,0,0,.5); }
.chart__tip b{ font-weight:800; }
.spark__empty{ margin:0; color:var(--muted); font-size:.82rem; }

.notice{ background:color-mix(in srgb, var(--dawn) 14%, transparent); border:1px solid color-mix(in srgb,var(--dawn) 40%,transparent); color:var(--ink); border-radius:14px; padding:13px 15px; font-size:.9rem; margin-bottom:18px; }
.notice a{ color:var(--dawn); font-weight:700; }
.foot{ margin:22px 4px 0; color:var(--muted); font-size:.72rem; display:flex; justify-content:space-between; gap:10px; }

/* ---- Desktop-first: wider layout that collapses to mobile ---- */
@media (min-width:720px){
  .wrap{ max-width:920px; padding:34px 28px 60px; }
  .metrics{ grid-template-columns:repeat(4,1fr); gap:14px; }
  .rides{ grid-template-columns:1fr 1fr; gap:14px; }
  .duo{ grid-template-columns:1fr 1fr; gap:14px; }
  .verdict{ padding:34px 30px 28px; }
  .verdict__title{ font-size:3.4rem; }
  .metric__value{ font-size:2.2rem; }
  .chart{ height:200px; }
}
@media (min-width:960px){
  .wrap{ max-width:960px; }
  .verdict__title{ font-size:3.8rem; }
}

/* Staggered entrance */
.wrap>*{ animation:rise .55s cubic-bezier(.2,.7,.2,1) both; }
.wrap>*:nth-child(1){ animation-delay:.02s } .wrap>*:nth-child(2){ animation-delay:.06s }
.wrap>*:nth-child(3){ animation-delay:.10s } .wrap>*:nth-child(4){ animation-delay:.15s }
.wrap>*:nth-child(5){ animation-delay:.20s } .wrap>*:nth-child(6){ animation-delay:.25s }
.wrap>*:nth-child(7){ animation-delay:.30s } .wrap>*:nth-child(n+8){ animation-delay:.35s }
@keyframes rise{ from{ opacity:0; transform:translateY(10px) } to{ opacity:1; transform:none } }
@media (prefers-reduced-motion:reduce){ .wrap>*{ animation:none } }
</style>
</head>
<body>
<main class="wrap">
  <header class="masthead">
    <span class="wordmark">
      <svg viewBox="0 0 24 24" aria-hidden="true">${RAVEN}</svg>
      Munin
    </span>
    <span class="masthead__date">${esc(d.dateLabel)}</span>
  </header>

  ${daynav}
  ${noData}

  <section class="verdict" aria-label="Dagens omdöme">
    <svg class="verdict__mark" viewBox="0 0 24 24" aria-hidden="true">${RAVEN}</svg>
    <p class="verdict__q">${question}</p>
    <h1 class="verdict__title">${esc(v.title)}</h1>
    <ul class="verdict__reasons">${reasons}</ul>
  </section>

  ${metrics}
  ${rides}
  <div class="duo">
    ${weather}
    ${training}
  </div>
  ${chart}

  <footer class="foot">
    <span>Senast hämtad ${esc(lastFetch)}</span>
    <span>Baslinje: ${d.baselineSampleSize} dag${d.baselineSampleSize === 1 ? '' : 'ar'}</span>
  </footer>
</main>
<script>
(function(){
  var el=document.getElementById('munin-chart'); if(!el) return;
  var D=JSON.parse(el.textContent), H=D.history;
  var svg=document.getElementById('chartSvg'), tip=document.getElementById('chartTip');
  var W=320,HT=120,PL=6,PR=6,PT=10,PB=10;
  var M={
    recovery:{key:'recovery',unit:'%',fixed:[0,100],guides:[34,67],color:'var(--green)'},
    hrv:{key:'hrv',unit:' ms',color:'var(--dawn)',baseline:D.hrvBaseline},
    rhr:{key:'rhr',unit:' bpm',color:'#d08a3c',baseline:D.rhrBaseline},
    sleep:{key:'sleep',unit:'%',fixed:[0,100],guides:[80],color:'#8368d6'}
  };
  var cur='recovery',range=14;
  function slice(){ return H.slice(Math.max(0,H.length-range)); }
  function draw(){
    var m=M[cur],pts=slice();
    var vals=pts.map(function(p){return p[m.key];}).filter(function(v){return v!=null;});
    if(!vals.length){ svg.innerHTML=''; return; }
    var lo,hi;
    if(m.fixed){ lo=m.fixed[0]; hi=m.fixed[1]; }
    else { lo=Math.min.apply(null,vals); hi=Math.max.apply(null,vals);
      if(m.baseline!=null){ lo=Math.min(lo,m.baseline); hi=Math.max(hi,m.baseline); }
      var pd=(hi-lo)*0.15||1; lo-=pd; hi+=pd; }
    var n=pts.length;
    function X(i){ return PL+(n<=1?0:i*(W-PL-PR)/(n-1)); }
    function Y(v){ return PT+(hi===lo?0:(1-(v-lo)/(hi-lo))*(HT-PT-PB)); }
    var out=[];
    (m.guides||[]).forEach(function(g){ if(g>=lo&&g<=hi){ var y=Y(g).toFixed(1); out.push('<line class="chart__guide" x1="'+PL+'" x2="'+(W-PR)+'" y1="'+y+'" y2="'+y+'"/>'); }});
    if(m.baseline!=null&&m.baseline>=lo&&m.baseline<=hi){ var by=Y(m.baseline).toFixed(1); out.push('<line class="chart__base" x1="'+PL+'" x2="'+(W-PR)+'" y1="'+by+'" y2="'+by+'"/>'); }
    var dp='',st=false,dots='';
    pts.forEach(function(p,i){ var v=p[m.key]; if(v==null){ st=false; return;} var x=X(i).toFixed(1),y=Y(v).toFixed(1); dp+=(st?'L':'M')+x+','+y+' '; st=true; dots+='<circle cx="'+x+'" cy="'+y+'" r="1.8"/>'; });
    out.push('<path class="chart__line" d="'+dp.trim()+'" fill="none" style="stroke:'+m.color+'"/>');
    out.push('<g class="chart__dots" style="fill:'+m.color+'">'+dots+'</g>');
    svg.innerHTML=out.join(''); svg._pts=pts; svg._X=X; svg._m=m;
  }
  function tab(id,attr,set){ document.getElementById(id).addEventListener('click',function(e){ var b=e.target.closest('button'); if(!b)return; set(b.dataset[attr]); [].forEach.call(this.children,function(c){c.classList.toggle('is-on',c===b);}); draw(); }); }
  tab('metricTabs','metric',function(v){cur=v;});
  tab('rangeTabs','range',function(v){range=+v;});
  function move(ev){ var pts=svg._pts; if(!pts)return; var r=svg.getBoundingClientRect(); var cx=ev.touches?ev.touches[0].clientX:ev.clientX; var idx=Math.round((cx-r.left)/r.width*(pts.length-1)); idx=Math.max(0,Math.min(pts.length-1,idx)); var p=pts[idx],v=p[svg._m.key]; if(v==null){ tip.hidden=true; return;} tip.hidden=false; var dd=new Date(p.day+'T12:00').toLocaleDateString('sv-SE',{weekday:'short',day:'numeric',month:'short'}); tip.innerHTML='<b>'+(svg._m.key==='hrv'?v.toFixed(1):Math.round(v))+svg._m.unit+'</b> '+dd; var px=svg._X(idx)/W*r.width; tip.style.left=Math.max(0,Math.min(r.width-tip.offsetWidth,px-tip.offsetWidth/2))+'px'; }
  svg.addEventListener('pointermove',move); svg.addEventListener('pointerdown',move); svg.addEventListener('pointerleave',function(){tip.hidden=true;});
  draw();
})();
</script>
</body>
</html>`;
}
