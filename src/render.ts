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
  const strain = p.durationMin === 0 ? '–' : p.targetStrain;
  const dur = p.durationMin === 0 ? '–' : `${p.durationMin} min`;
  const ceiling =
    p.zone === null ? '' : `<p class="ride__ceiling">Pulstak ${hrCeiling(p)}</p>`;
  return `
    <article class="ride ride--${kind}">
      <p class="eyebrow">${label}</p>
      <h3 class="ride__bike">${esc(p.bike)}</h3>
      <p class="ride__workout">${esc(p.workout)}</p>
      <dl class="ride__stats">
        <div><dt>Tid</dt><dd>${dur}</dd></div>
        <div><dt>Målzon</dt><dd>${zoneText(p)}</dd></div>
        <div><dt>Strain</dt><dd>${strain}</dd></div>
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
  --bg:#0e1420; --panel:#161d2b; --ink:#eef1f6; --muted:#8a97ac; --line:#232c3d;
  --dawn:#5b7fa6;
  --green:#1f9d6b; --green-ink:#eafaf2;
  --yellow:#d0a03e; --yellow-ink:#221a06;
  --red:#c2483d; --red-ink:#fdeceb;
  --good:#37b98a; --bad:#e2675b;
  --v: var(--green); --v-ink: var(--green-ink);
}
:root[data-level="yellow"]{ --v: var(--yellow); --v-ink: var(--yellow-ink); }
:root[data-level="red"]{ --v: var(--red); --v-ink: var(--red-ink); }
@media (prefers-color-scheme: light){
  :root{ --bg:#eef1f4; --panel:#ffffff; --ink:#121722; --muted:#5c6579; --line:#dde2ea; }
}
*{ box-sizing:border-box; }
html,body{ margin:0; overflow-x:hidden; }
body{
  background:var(--bg); color:var(--ink);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  -webkit-font-smoothing:antialiased; line-height:1.4;
  padding:0 0 env(safe-area-inset-bottom);
}
.wrap{ width:100%; max-width:520px; margin:0 auto; padding:18px 16px 40px; }
/* Let flex/grid children shrink instead of forcing horizontal overflow. */
.metrics>*, .rides>*, .weather__row>*, .masthead>*, .ride__stats>*, .foot>*{ min-width:0; }
svg{ max-width:100%; }
.metric__value, .weather__temp{ overflow-wrap:anywhere; }
.masthead__date{ white-space:nowrap; text-align:right; }
.masthead{ display:flex; align-items:baseline; justify-content:space-between; gap:12px; margin-bottom:14px; }
.wordmark{ display:flex; align-items:center; gap:8px; font-weight:800; letter-spacing:.14em; font-size:.8rem; text-transform:uppercase; }
.wordmark svg{ width:18px; height:18px; fill:var(--v); }
.masthead__date{ color:var(--muted); font-size:.78rem; text-transform:lowercase; }
.eyebrow{ margin:0 0 8px; font-size:.68rem; letter-spacing:.16em; text-transform:uppercase; color:var(--muted); font-weight:700; }

/* Day toggle */
.daynav{ display:flex; align-items:center; justify-content:space-between; gap:10px; margin:0 0 16px; }
.daynav__arrow{ width:38px; height:38px; border-radius:11px; border:1px solid var(--line); background:var(--panel); display:flex; align-items:center; justify-content:center; font-size:1.25rem; line-height:1; text-decoration:none; color:var(--ink); }
.daynav__arrow.is-off{ opacity:.28; }
.daynav__badge, .daynav__today{ font-size:.72rem; letter-spacing:.14em; text-transform:uppercase; font-weight:700; }
.daynav__badge{ color:var(--muted); }
.daynav__today{ color:var(--dawn); text-decoration:none; }

/* Verdict band — the single loud element */
.verdict{
  background:var(--v); color:var(--v-ink);
  border-radius:20px; padding:22px 20px 20px; margin-bottom:18px;
  box-shadow:0 12px 34px -18px var(--v);
}
.verdict__q{ margin:0 0 6px; font-size:.72rem; letter-spacing:.16em; text-transform:uppercase; opacity:.72; font-weight:700; }
.verdict__title{ margin:0; font-size:2.5rem; line-height:1.02; font-weight:850; letter-spacing:-.02em; }
.verdict__reasons{ margin:14px 0 0; padding:0; list-style:none; display:flex; flex-direction:column; gap:5px; }
.verdict__reasons li{ font-size:.86rem; opacity:.9; padding-left:14px; position:relative; }
.verdict__reasons li::before{ content:""; position:absolute; left:0; top:.55em; width:5px; height:5px; border-radius:50%; background:currentColor; opacity:.6; }

/* Instrument row */
.metrics{ display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:18px; }
.metric{ background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:13px 14px; }
.metric__label{ margin:0 0 6px; font-size:.68rem; letter-spacing:.12em; text-transform:uppercase; color:var(--muted); font-weight:700; }
.metric__value{ margin:0; font-size:1.9rem; font-weight:800; letter-spacing:-.02em; font-variant-numeric:tabular-nums; }
.metric__unit{ font-size:.9rem; font-weight:600; color:var(--muted); margin-left:2px; }
.metric__foot{ margin:6px 0 0; font-size:.74rem; color:var(--muted); font-variant-numeric:tabular-nums; }
.chip{ display:inline-block; font-size:.72rem; font-weight:700; padding:2px 7px; border-radius:999px; font-variant-numeric:tabular-nums; }
.chip--good{ background:color-mix(in srgb, var(--good) 20%, transparent); color:var(--good); }
.chip--bad{ background:color-mix(in srgb, var(--bad) 20%, transparent); color:var(--bad); }
.chip--flat{ background:color-mix(in srgb, var(--muted) 18%, transparent); color:var(--muted); }

/* Ride cards */
.rides{ display:flex; flex-direction:column; gap:10px; margin-bottom:18px; }
.ride{ background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:15px 16px; }
.ride--primary{ border-left:3px solid var(--v); }
.ride__bike{ margin:0; font-size:1.15rem; font-weight:800; }
.ride__workout{ margin:2px 0 12px; color:var(--muted); font-size:.9rem; }
.ride__stats{ margin:0; display:grid; grid-template-columns:repeat(3,1fr); gap:8px; }
.ride__stats dt{ font-size:.64rem; letter-spacing:.1em; text-transform:uppercase; color:var(--muted); font-weight:700; }
.ride__stats dd{ margin:3px 0 0; font-size:.9rem; font-weight:700; font-variant-numeric:tabular-nums; }

/* Weather */
.weather{ background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:15px 16px; margin-bottom:18px; }
.weather__row{ display:flex; align-items:center; justify-content:space-between; gap:12px; }
.weather__now{ display:flex; align-items:baseline; gap:10px; }
.weather__temp{ font-size:1.9rem; font-weight:800; font-variant-numeric:tabular-nums; }
.weather__desc{ color:var(--muted); font-size:.9rem; }
.weather__wind{ color:var(--muted); font-size:.85rem; font-variant-numeric:tabular-nums; }
.weather__window{ margin:12px 0 0; font-size:.9rem; }
.weather__window strong{ color:var(--dawn); }

/* Training load */
.training{ background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:15px 16px; margin-bottom:18px; }
.tl__top{ display:flex; gap:24px; margin-bottom:12px; }
.tl__stat{ display:flex; flex-direction:column; gap:4px; }
.tl__num{ font-size:1.55rem; font-weight:800; font-variant-numeric:tabular-nums; }
.tl__cap{ font-size:.66rem; color:var(--muted); letter-spacing:.08em; text-transform:uppercase; font-weight:700; display:flex; align-items:center; gap:6px; }
.tl__list{ list-style:none; margin:0; padding:0; display:flex; flex-direction:column; }
.tl__list li{ display:flex; justify-content:space-between; gap:10px; font-size:.82rem; border-top:1px solid var(--line); padding:7px 0; }
.tl__day{ font-weight:700; text-transform:capitalize; }
.tl__meta{ color:var(--muted); font-variant-numeric:tabular-nums; }

/* Interactive chart */
.history{ background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:15px 16px; }
.chart__tabs{ display:flex; gap:6px; margin-bottom:12px; flex-wrap:wrap; }
.chart__ranges{ display:flex; gap:6px; margin-top:10px; justify-content:flex-end; }
.chart__tab, .chart__range{ font:inherit; cursor:pointer; border:1px solid var(--line); background:transparent; color:var(--muted); border-radius:9px; padding:6px 11px; font-size:.72rem; font-weight:700; }
.chart__tab.is-on, .chart__range.is-on{ background:var(--bg); color:var(--ink); border-color:var(--dawn); }
.chart__wrap{ position:relative; }
.chart{ display:block; width:100%; height:120px; overflow:visible; touch-action:none; }
.chart__line{ stroke-width:2; stroke-linejoin:round; stroke-linecap:round; }
.chart__dots circle{ opacity:.9; }
.chart__guide{ stroke:var(--line); stroke-width:1; stroke-dasharray:2 4; }
.chart__base{ stroke:var(--muted); stroke-width:1; stroke-dasharray:4 3; opacity:.55; }
.chart__tip{ position:absolute; top:-2px; background:var(--ink); color:var(--bg); font-size:.72rem; padding:3px 7px; border-radius:7px; pointer-events:none; white-space:nowrap; font-variant-numeric:tabular-nums; }
.chart__tip b{ font-weight:800; }
.spark__empty{ margin:0; color:var(--muted); font-size:.82rem; }
.ride__ceiling{ margin:10px 0 0; font-size:.74rem; color:var(--muted); font-variant-numeric:tabular-nums; }

.notice{ background:color-mix(in srgb, var(--dawn) 16%, transparent); border:1px solid var(--dawn); color:var(--ink); border-radius:12px; padding:12px 14px; font-size:.9rem; margin-bottom:16px; }
.notice a{ color:var(--dawn); }
.foot{ margin:18px 2px 0; color:var(--muted); font-size:.72rem; display:flex; justify-content:space-between; gap:10px; }

@media (min-width:480px){
  .verdict__title{ font-size:2.9rem; }
}
.wrap{ animation:rise .4s ease both; }
@keyframes rise{ from{ opacity:0; transform:translateY(6px); } to{ opacity:1; transform:none; } }
@media (prefers-reduced-motion:reduce){ .wrap{ animation:none; } }
a{ color:inherit; }
</style>
</head>
<body>
<main class="wrap">
  <header class="masthead">
    <span class="wordmark">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 13c3-1 5-3 8-3 1-2 3-3 6-3 2 0 3 1 4 2-1 0-2 0-3 1 1 0 2 1 2 2-2 0-3 0-5 1-2 2-5 3-8 3-3 0-5-2-6-4 1 0 1 1 2 1 0-1 0-2-1-3 2 0 3 1 5 2-1-1-3-2-5-2z"/></svg>
      Munin
    </span>
    <span class="masthead__date">${esc(d.dateLabel)}</span>
  </header>

  ${daynav}
  ${noData}

  <section class="verdict" aria-label="Dagens omdöme">
    <p class="verdict__q">${question}</p>
    <h1 class="verdict__title">${esc(v.title)}</h1>
    <ul class="verdict__reasons">${reasons}</ul>
  </section>

  ${metrics}
  ${rides}
  ${weather}
  ${training}
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
