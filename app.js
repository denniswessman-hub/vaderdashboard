/* Väderdashboard – klientlogik, sammanvägning och rendering. */
'use strict';

const TZ = 'Europe/Stockholm';
const STORE = { loc: 'vd.location', favs: 'vd.favs', theme: 'vd.theme' };

const SOURCE_META = {
  smhi: { label: 'SMHI', color: 'var(--series-smhi)' },
  yr: { label: 'Yr', color: 'var(--series-yr)' },
  ecmwf: { label: 'ECMWF', color: 'var(--series-klart)' },
};

const SEVERITY = ['clear', 'fair', 'partlycloudy', 'cloudy', 'fog', 'drizzle',
  'sleet', 'snow', 'heavysnow', 'rain', 'heavyrain', 'thunder'];

const SYMBOL_TEXT = {
  clear: 'Klart', fair: 'Mest klart', partlycloudy: 'Växlande molnighet', cloudy: 'Mulet',
  fog: 'Dimma', drizzle: 'Lätt regn', rain: 'Regn', heavyrain: 'Kraftigt regn',
  sleet: 'Snöblandat regn', snow: 'Snö', heavysnow: 'Kraftigt snöfall', thunder: 'Åska',
};

const state = {
  loc: null, favs: [], data: null, grid: null, days: null, fetched: 0,
  range: window.matchMedia('(max-width: 560px)').matches ? 24 : 48,
  cursor: 0,
};

/* ------------------------------------------------------------------ *
 * Lagring
 * ------------------------------------------------------------------ */

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* privat läge */ }
}

/* ------------------------------------------------------------------ *
 * Sol – avgör dag/natt för symboler och nattskuggning
 * ------------------------------------------------------------------ */

function sunElevation(date, lat, lon) {
  const rad = Math.PI / 180;
  const n = date.getTime() / 86400000 + 2440587.5 - 2451545.0;
  const L = ((280.460 + 0.9856474 * n) % 360 + 360) % 360;
  const g = (((357.528 + 0.9856003 * n) % 360 + 360) % 360) * rad;
  const lambda = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * rad;
  const eps = 23.439 * rad;
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const gmst = ((18.697374558 + 24.06570982441908 * n) % 24 + 24) % 24;
  const ha = (gmst * 15 + lon) * rad - ra;
  return Math.asin(Math.sin(lat * rad) * Math.sin(dec) +
    Math.cos(lat * rad) * Math.cos(dec) * Math.cos(ha)) / rad;
}
const isDay = (date) => !state.loc || sunElevation(date, state.loc.lat, state.loc.lon) > -1;

/* ------------------------------------------------------------------ *
 * Symbolgrafik
 * ------------------------------------------------------------------ */

function glyph(symbol, day = true) {
  const sun = day
    ? '<circle cx="25" cy="24" r="11" fill="#f2a516"/>'
    : '<path d="M32 14a12 12 0 1 0 8 20 14 14 0 0 1-8-20Z" fill="#c9c8be"/>';
  // Fristående sol respektive måne, centrerad – används när himlen är klar.
  const rays = [0, 45, 90, 135, 180, 225, 270, 315].map((a) =>
    `<line x1="32" y1="32" x2="${(32 + Math.cos(a * Math.PI / 180) * 25).toFixed(1)}" y2="${(32 + Math.sin(a * Math.PI / 180) * 25).toFixed(1)}" stroke="#f2a516" stroke-width="3.5" stroke-linecap="round" opacity=".9"/>`).join('');
  const soloSun = day
    ? `<g>${rays}<circle cx="32" cy="32" r="19" fill="var(--surface-1)"/><circle cx="32" cy="32" r="13" fill="#f2a516"/></g>`
    : '<path d="M36 12a17 17 0 1 0 15 26 19 19 0 0 1-15-26Z" fill="#c9c8be"/>';
  const cloud = (o = '') =>
    `<path ${o} d="M20 46a10 10 0 0 1 .6-19.9A14 14 0 0 1 47 30a8 8 0 0 1-1 16Z" fill="var(--text-secondary)" opacity=".85"/>`;
  const drops = (c) => [0, 1, 2].map((i) =>
    `<path d="M${24 + i * 9} ${52 + (i % 2) * 3}l-2.4 5.4a2.7 2.7 0 1 0 4.8 0Z" fill="${c}"/>`).join('');
  const flakes = (c) => [0, 1, 2].map((i) =>
    `<g stroke="${c}" stroke-width="2" stroke-linecap="round"><path d="M${25 + i * 9} ${53 + (i % 2) * 3}v6M${22 + i * 9} ${55 + (i % 2) * 3}l6 3M${28 + i * 9} ${55 + (i % 2) * 3}l-6 3"/></g>`).join('');

  switch (symbol) {
    case 'clear': return soloSun;
    case 'fair': return sun + cloud('transform="translate(6 8) scale(.72)"');
    case 'partlycloudy': return sun + cloud();
    case 'cloudy': return cloud();
    case 'fog': return cloud() + '<g stroke="var(--text-muted)" stroke-width="2.5" stroke-linecap="round"><path d="M16 53h32M20 59h26"/></g>';
    case 'drizzle': return cloud() + drops('#5598e7');
    case 'rain': return cloud() + drops('#2a78d6');
    case 'heavyrain': return cloud() + drops('#184f95');
    case 'sleet': return cloud() + drops('#2a78d6').slice(0, 200) + flakes('#9ec5f4');
    case 'snow': return cloud() + flakes('#9ec5f4');
    case 'heavysnow': return cloud() + flakes('#cde2fb');
    case 'thunder': return cloud() + '<path d="M32 50l-8 12h6l-3 9 12-14h-7l4-7Z" fill="#eda100"/>';
    default: return cloud();
  }
}

/* ------------------------------------------------------------------ *
 * Sammanvägning
 * ------------------------------------------------------------------ */

// Linjär interpolation av en källa till en godtycklig tidpunkt.
function sampleAt(source, t) {
  const h = source.hours;
  if (!h.length) return null;
  const first = Date.parse(h[0].time);
  const last = Date.parse(h[h.length - 1].time);
  if (t < first - 36e5 || t > last) return null;

  let lo = 0, hi = h.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (Date.parse(h[mid].time) <= t) lo = mid; else hi = mid;
  }
  const a = h[lo];
  const b = h[Math.min(lo + 1, h.length - 1)];
  const ta = Date.parse(a.time), tb = Date.parse(b.time);
  const f = tb > ta ? Math.min(Math.max((t - ta) / (tb - ta), 0), 1) : 0;
  const mix = (x, y) => (x === null || x === undefined || y === null || y === undefined ? (x ?? y ?? null) : x + (y - x) * f);

  return {
    temp: mix(a.temp, b.temp),
    wind: mix(a.wind, b.wind),
    gust: mix(a.gust, b.gust),
    dir: a.dir,
    // Nederbörd är intensitet i mm/h och gäller framåt från punkten.
    rate: a.rate ?? null,
    pop: a.pop ?? null,
    humidity: mix(a.humidity, b.humidity),
    cloud: mix(a.cloud, b.cloud),
    symbol: a.symbol,
  };
}

const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

function circularMean(degs) {
  if (!degs.length) return null;
  let x = 0, y = 0;
  for (const d of degs) { x += Math.cos(d * Math.PI / 180); y += Math.sin(d * Math.PI / 180); }
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

// Lika vikt för alla källor: medelvärde för tal, majoritet för symbol,
// median på allvarlighetsskalan när ingen symbol får majoritet.
function combine(samples) {
  const vals = samples.filter(Boolean);
  if (vals.length === 0) return null;

  const temps = vals.map((v) => v.temp).filter((v) => typeof v === 'number');
  const rates = vals.map((v) => v.rate).filter((v) => typeof v === 'number');
  const winds = vals.map((v) => v.wind).filter((v) => typeof v === 'number');
  const gusts = vals.map((v) => v.gust).filter((v) => typeof v === 'number');
  const dirs = vals.map((v) => v.dir).filter((v) => typeof v === 'number');
  const pops = vals.map((v) => v.pop).filter((v) => typeof v === 'number');
  const syms = vals.map((v) => v.symbol).filter(Boolean);

  let symbol = null, symbolAgree = 0;
  if (syms.length) {
    const count = {};
    for (const s of syms) count[s] = (count[s] || 0) + 1;
    const best = Object.entries(count).sort((a, b) => b[1] - a[1]);
    if (best[0][1] > 1 || syms.length === 1) {
      symbol = best[0][0];
      symbolAgree = best[0][1] / syms.length;
    } else {
      const ordered = syms.slice().sort((a, b) => SEVERITY.indexOf(a) - SEVERITY.indexOf(b));
      symbol = ordered[Math.floor(ordered.length / 2)];
      symbolAgree = 1 / syms.length;
    }
  }

  const spread = temps.length > 1 ? Math.max(...temps) - Math.min(...temps) : 0;
  const wet = rates.filter((r) => r >= 0.1).length;
  const precipAgree = rates.length ? Math.max(wet, rates.length - wet) / rates.length : 1;
  const tempAgree = Math.max(0, 1 - spread / 6);
  const agreement = 0.40 * symbolAgree + 0.35 * tempAgree + 0.25 * precipAgree;

  return {
    n: vals.length,
    temp: mean(temps),
    tempMin: temps.length ? Math.min(...temps) : null,
    tempMax: temps.length ? Math.max(...temps) : null,
    spread,
    rate: mean(rates),
    wetShare: rates.length ? wet / rates.length : 0,
    // Källornas egna sannolikheter när de finns, annars hur många av dem som
    // tror på nederbörd alls.
    pop: pops.length ? mean(pops) : (rates.length ? (wet / rates.length) * 100 : null),
    popSources: pops.length,
    wind: mean(winds),
    gust: gusts.length ? Math.max(...gusts) : null,
    dir: circularMean(dirs),
    humidity: mean(vals.map((v) => v.humidity).filter((v) => typeof v === 'number')),
    cloud: mean(vals.map((v) => v.cloud).filter((v) => typeof v === 'number')),
    symbol,
    symbolAgree,
    agreement,
  };
}

// Bygger ett gemensamt timrutnät och sammanväger varje timme.
function buildGrid(data, hours = 240) {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  const rows = [];
  for (let i = 0; i < hours; i++) {
    const t = start.getTime() + i * 36e5;
    const per = {};
    for (const s of data.sources) per[s.id] = sampleAt(s, t);
    const consensus = combine(Object.values(per));
    if (!consensus) continue;
    rows.push({ t, date: new Date(t), per, c: consensus });
  }
  return rows;
}

// Dygnsvis aggregering per källa och sammanvägt.
function buildDays(grid, data) {
  const fmt = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  const byDay = new Map();
  for (const row of grid) {
    const key = fmt.format(row.date);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(row);
  }

  const days = [];
  for (const [key, rows] of byDay) {
    if (rows.length < 6) continue;
    const per = {};
    for (const s of data.sources) {
      const temps = rows.map((r) => r.per[s.id]?.temp).filter((v) => typeof v === 'number');
      const rates = rows.map((r) => r.per[s.id]?.rate).filter((v) => typeof v === 'number');
      const winds = rows.map((r) => r.per[s.id]?.wind).filter((v) => typeof v === 'number');
      if (!temps.length) continue;
      per[s.id] = {
        min: Math.min(...temps),
        max: Math.max(...temps),
        precip: rates.reduce((a, b) => a + b, 0),
        wind: winds.length ? Math.max(...winds) : null,
        symbol: dominantSymbol(rows.map((r) => r.per[s.id]?.symbol), rows),
      };
    }
    const mins = Object.values(per).map((p) => p.min);
    const maxs = Object.values(per).map((p) => p.max);
    const precips = Object.values(per).map((p) => p.precip);
    days.push({
      key,
      date: rows[Math.floor(rows.length / 2)].date,
      rows,
      per,
      min: mean(mins),
      max: mean(maxs),
      minSpread: mins.length > 1 ? Math.max(...mins) - Math.min(...mins) : 0,
      maxSpread: maxs.length > 1 ? Math.max(...maxs) - Math.min(...maxs) : 0,
      precip: mean(precips),
      precipMin: precips.length ? Math.min(...precips) : 0,
      precipMax: precips.length ? Math.max(...precips) : 0,
      wind: mean(Object.values(per).map((p) => p.wind).filter((v) => typeof v === 'number')),
      symbol: dominantSymbol(rows.map((r) => r.c.symbol), rows),
      agreement: mean(rows.map((r) => r.c.agreement)),
    });
  }
  return days.slice(0, 10);
}

// Dygnets symbol: nederbörd väger tyngst, annars dagtimmarnas vanligaste.
function dominantSymbol(symbols, rows) {
  const count = {};
  symbols.forEach((s, i) => {
    if (!s) return;
    const hour = Number(new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, hour: '2-digit', hour12: false }).format(rows[i].date));
    const daytime = hour >= 7 && hour <= 19;
    const wet = SEVERITY.indexOf(s) >= SEVERITY.indexOf('drizzle');
    count[s] = (count[s] || 0) + (daytime ? 1 : 0.4) * (wet ? 1.8 : 1);
  });
  const best = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : null;
}

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */

const $ = (id) => document.getElementById(id);
const fmtTemp = (v) => (typeof v === 'number' ? `${v > 0 ? '' : ''}${Math.round(v)}°` : '–');
const fmtNum = (v, d = 1) => (typeof v === 'number' ? v.toFixed(d).replace('.', ',') : '–');
const timeFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, weekday: 'short' });
const dateFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, day: 'numeric', month: 'short' });
const dayLongFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, weekday: 'long' });
const compass = (d) => ['N', 'NO', 'O', 'SO', 'S', 'SV', 'V', 'NV'][Math.round(((d % 360) + 360) % 360 / 45) % 8];

function activeSources() {
  return state.data ? state.data.sources : [];
}
function sourceColor(id) {
  return (SOURCE_META[id] || {}).color || 'var(--text-secondary)';
}
function sourceLabel(s) {
  return (SOURCE_META[s.id] || {}).label || s.name;
}

function renderNow() {
  const row = state.grid[0];
  const c = row.c;
  $('nowGlyph').innerHTML = glyph(c.symbol, isDay(row.date));
  $('nowTemp').textContent = fmtTemp(c.temp);
  $('nowDesc').innerHTML = `${SYMBOL_TEXT[c.symbol] || 'Prognos'}<small>${c.n} av ${state.data.sources.length} källor · spridning ${fmtNum(c.spread)}\u00a0°C</small>`;

  const m = [
    ['Nederbörd', `${fmtNum(c.rate, 1)} mm/h`],
    ['Regnrisk', c.pop === null ? '–' : `${Math.round(c.pop)} %`],
    ['Vind', `${fmtNum(c.wind, 1)} m/s ${c.dir === null ? '' : compass(c.dir)}`],
    ['Byar', c.gust === null ? '–' : `${fmtNum(c.gust, 1)} m/s`],
    ['Luftfuktighet', c.humidity === null ? '–' : `${Math.round(c.humidity)} %`],
    ['Molnighet', c.cloud === null ? '–' : `${Math.round(c.cloud)} %`],
  ];
  $('nowMetrics').innerHTML = m.map(([k, v]) => `<div class="metric"><b>${v}</b><span>${k}</span></div>`).join('');

  const pct = Math.round(c.agreement * 100);
  $('agreeBar').style.width = `${pct}%`;
  $('agreeBar').style.background = pct >= 75 ? 'var(--good)' : pct >= 50 ? 'var(--warning)' : 'var(--serious)';
  $('agreePct').textContent = `${pct} %`;
  $('agreeText').textContent = pct >= 75 ? 'Källorna är eniga' : pct >= 50 ? 'Källorna är delvis oeniga' : 'Källorna säger olika saker';
}

function renderSources() {
  const row = state.grid[0];
  const html = activeSources().map((s) => {
    const v = row.per[s.id];
    const dev = v && typeof v.temp === 'number' && typeof row.c.temp === 'number' ? v.temp - row.c.temp : null;
    return `<div class="srow">
      <span class="swatch" style="background:${sourceColor(s.id)}"></span>
      <span class="nm">${sourceLabel(s)}<small>${s.model || ''}</small></span>
      <span class="val">${v ? fmtTemp(v.temp) : '–'}</span>
      <span class="dev">${dev === null ? '' : `${dev >= 0 ? '+' : '−'}${Math.abs(dev).toFixed(1).replace('.', ',')} °C`}</span>
    </div>`;
  }).join('');

  const errs = Object.entries(state.data.errors || {});
  $('sourceRows').innerHTML = html;
  $('srcErrors').textContent = errs.length ? errs.map(([k, v]) => `${(SOURCE_META[k] || { label: k }).label}: ${v}`).join(' · ') : '';


  $('legend').innerHTML =
    '<b><i class="thick" style="background:var(--text-primary)"></i>Troligaste prognos</b>' +
    activeSources().map((s) => `<b><i style="background:${sourceColor(s.id)}"></i>${sourceLabel(s)}</b>`).join('') +
    '<b><i class="band" style="background:var(--text-primary)"></i>Spridning</b>';
}
/* ---------- Diagram över kommande dygn ---------- */

/* Diagrammet ritas i riktiga skärmpixlar och fyller kortets bredd, så att
 * inget behöver skrollas i sidled. Värden läses av genom att dra fingret
 * längs ytan; svaret hamnar i rutan ovanför i stället för under fingret. */

const CHART = { padL: 34, padR: 12, top: 20, precipH: 34, axisH: 22, gap: 14 };

let chartCache = null;

function chartGeometry() {
  const wrap = document.querySelector('.chart-wrap');
  const w = Math.max(wrap ? wrap.clientWidth : 320, 260);
  const h = w < 520 ? 250 : 300;
  const { padL, padR, top, precipH, axisH, gap } = CHART;
  const axisY = h - axisH;
  const precipBottom = axisY - 6;
  const precipTop = precipBottom - precipH;
  const tempBottom = precipTop - gap;
  return { w, h, padL, padR, top, tempBottom, precipTop, precipBottom, axisY, plotW: w - padL - padR };
}

function renderChart() {
  const hours = state.range;
  const rows = state.grid.slice(0, hours + 1);
  const svg = $('chart48');
  const g = chartGeometry();
  const x = (i) => g.padL + (g.plotW * i) / (rows.length - 1);

  const temps = rows.flatMap((row) => [row.c.tempMin, row.c.tempMax,
    ...Object.values(row.per).map((v) => v && v.temp)]).filter((v) => typeof v === 'number');
  let lo = Math.min(...temps), hi = Math.max(...temps);
  if (hi - lo < 4) { const mid = (hi + lo) / 2; lo = mid - 2; hi = mid + 2; }
  const pad = (hi - lo) * 0.14;
  lo -= pad; hi += pad;
  const y = (v) => g.tempBottom - ((v - lo) / (hi - lo)) * (g.tempBottom - g.top);

  const maxRate = Math.max(0.5, ...rows.map((row) => row.c.rate || 0));
  const yp = (v) => g.precipBottom - (Math.min(v, maxRate) / maxRate) * (g.precipBottom - g.precipTop);

  const parts = [`<defs>
    <linearGradient id="fadeTop" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="var(--text-primary)" stop-opacity=".13"/>
      <stop offset="1" stop-color="var(--text-primary)" stop-opacity=".02"/>
    </linearGradient>
  </defs>`];

  // Natt som ett svagt fält bakom allt annat
  let runStart = null;
  rows.forEach((row, i) => {
    const night = !isDay(row.date);
    if (night && runStart === null) runStart = i;
    if ((!night || i === rows.length - 1) && runStart !== null) {
      parts.push(`<rect class="night" x="${x(runStart).toFixed(1)}" y="${g.top - 8}" width="${Math.max(x(i) - x(runStart), 1).toFixed(1)}" height="${(g.precipBottom - g.top + 8).toFixed(1)}"/>`);
      runStart = null;
    }
  });

  // Vågräta stödlinjer med gradtal
  for (const t of niceTicks(lo, hi, g.h < 280 ? 3 : 4)) {
    const yy = y(t).toFixed(1);
    parts.push(`<line class="grid" x1="${g.padL}" x2="${g.w - g.padR}" y1="${yy}" y2="${yy}"/>`);
    parts.push(`<text class="ylab" x="${g.padL - 7}" y="${(y(t) + 4).toFixed(1)}" text-anchor="end">${Math.round(t)}°</text>`);
  }

  // Dygnsgränser med veckodag
  rows.forEach((row, i) => {
    if (Number(hourInTz(row.date)) !== 0 || i === 0) return;
    parts.push(`<line class="daysep" x1="${x(i).toFixed(1)}" x2="${x(i).toFixed(1)}" y1="${g.top - 8}" y2="${g.precipBottom}"/>`);
    parts.push(`<text class="dlab" x="${(x(i) + 5).toFixed(1)}" y="${g.top - 1}">${dayFmt.format(row.date)}</text>`);
  });

  // Spridningen mellan högsta och lägsta källa
  const band = rows.map((row, i) => `${x(i).toFixed(1)},${y(row.c.tempMax).toFixed(1)}`)
    .concat(rows.slice().reverse().map((row, i) => `${x(rows.length - 1 - i).toFixed(1)},${y(row.c.tempMin).toFixed(1)}`));
  parts.push(`<polygon class="band" points="${band.join(' ')}"/>`);

  // Ytan under den sammanvägda linjen ger kurvan tyngd
  const cpts = rows.map((row, i) => `${x(i).toFixed(1)},${y(row.c.temp).toFixed(1)}`);
  parts.push(`<polygon class="area" points="${x(0).toFixed(1)},${g.tempBottom} ${cpts.join(' ')} ${x(rows.length - 1).toFixed(1)},${g.tempBottom}"/>`);

  for (const s of activeSources()) {
    const pts = rows.map((row, i) => {
      const v = row.per[s.id];
      return v && typeof v.temp === 'number' ? `${x(i).toFixed(1)},${y(v.temp).toFixed(1)}` : null;
    }).filter(Boolean);
    if (pts.length) parts.push(`<polyline class="line src" points="${pts.join(' ')}" stroke="${sourceColor(s.id)}"/>`);
  }
  parts.push(`<polyline class="line consensus" points="${cpts.join(' ')}"/>`);

  // Nederbörd i egen bana
  parts.push(`<line class="axis" x1="${g.padL}" x2="${g.w - g.padR}" y1="${g.precipBottom}" y2="${g.precipBottom}"/>`);
  parts.push(`<text class="ylab" x="${g.padL - 7}" y="${(g.precipTop + 9).toFixed(1)}" text-anchor="end">${fmtNum(maxRate, 1)}</text>`);
  const bw = Math.max(2.5, g.plotW / rows.length - 2.5);
  rows.forEach((row, i) => {
    const v = row.c.rate || 0;
    if (v <= 0.02) return;
    const barH = Math.max(2, g.precipBottom - yp(v));
    const risk = row.c.pop === null ? row.c.wetShare : row.c.pop / 100;
    parts.push(`<rect class="bar" x="${(x(i) - bw / 2).toFixed(1)}" y="${(g.precipBottom - barH).toFixed(1)}" width="${bw.toFixed(1)}" height="${barH.toFixed(1)}" rx="${Math.min(2, bw / 2).toFixed(1)}" opacity="${(0.4 + 0.6 * risk).toFixed(2)}"/>`);
  });
  parts.push(`<text class="unit" x="${g.padL - 7}" y="${(g.precipBottom + 4).toFixed(1)}" text-anchor="end">mm/h</text>`);

  // Tidsaxel – tätare etiketter bara när det finns plats
  const step = g.plotW / rows.length > 9 ? 6 : 12;
  rows.forEach((row, i) => {
    const hour = Number(hourInTz(row.date));
    if (hour % step !== 0) return;
    parts.push(`<text class="xlab" x="${x(i).toFixed(1)}" y="${(g.axisY + 15).toFixed(1)}" text-anchor="middle">${String(hour).padStart(2, '0')}</text>`);
  });

  // Markör för nuläget
  parts.push(`<line class="nowline" x1="${x(0).toFixed(1)}" x2="${x(0).toFixed(1)}" y1="${g.top - 8}" y2="${g.precipBottom}"/>`);

  parts.push(`<g class="cursor" style="display:none">
    <line y1="${g.top - 8}" y2="${g.precipBottom}"/>
    <circle class="halo" r="9"/><circle class="dot" r="4"/>
  </g>`);

  svg.setAttribute('viewBox', `0 0 ${g.w} ${g.h}`);
  svg.setAttribute('height', g.h);
  svg.innerHTML = parts.join('');

  chartCache = { rows, x, y, g };
  attachScrub(svg);
  setCursor(state.cursor ?? 0);
  renderHourTable(state.grid.slice(0, hours + 1));
}

const hourInTz = (date) =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, hour: '2-digit', hour12: false }).format(date);

// Väljer det steg som ger ungefär önskat antal linjer, men aldrig färre än tre
// – annars blir gradskalan obegriplig när dygnet är jämnt.
function niceTicks(lo, hi, count) {
  const span = hi - lo;
  const mag = 10 ** Math.floor(Math.log10(Math.max(span / count, 1e-6)));
  const steps = [1, 2, 2.5, 5, 10].map((m) => m * mag);
  const ticksFor = (step) => {
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(v);
    return out;
  };
  let best = null;
  for (const step of steps) {
    const t = ticksFor(step);
    if (t.length < 3) continue;
    if (!best || Math.abs(t.length - count) < Math.abs(best.length - count)) best = t;
  }
  return best || ticksFor(steps[0]);
}

/* ---------- Avläsning ---------- */

function setCursor(idx) {
  if (!chartCache) return;
  const { rows, x, y } = chartCache;
  const i = Math.min(Math.max(Math.round(idx), 0), rows.length - 1);
  state.cursor = i;
  const row = rows[i];

  const cursor = $('chart48').querySelector('.cursor');
  cursor.style.display = '';
  cursor.querySelectorAll('line, circle').forEach((el) => {
    if (el.tagName === 'line') { el.setAttribute('x1', x(i)); el.setAttribute('x2', x(i)); }
    else { el.setAttribute('cx', x(i)); el.setAttribute('cy', y(row.c.temp)); }
  });

  const c = row.c;
  const srcs = activeSources().map((s) => {
    const v = row.per[s.id];
    return `<span class="ro-src"><i style="background:${sourceColor(s.id)}"></i>${sourceLabel(s)} <b>${v ? fmtTemp(v.temp) : '–'}</b></span>`;
  }).join('');

  $('readout').innerHTML = `
    <div class="ro-head">
      <span class="ro-time">${dayFmt.format(row.date)} ${timeFmt.format(row.date)}</span>
      ${i === 0 ? '<span class="ro-badge">nu</span>' : '<button type="button" class="ro-now">Till nu</button>'}
    </div>
    <div class="ro-body">
      <svg viewBox="0 0 64 64" class="ro-glyph" aria-hidden="true">${glyph(c.symbol, isDay(row.date))}</svg>
      <span class="ro-temp">${fmtTemp(c.temp)}</span>
      <span class="ro-desc">${SYMBOL_TEXT[c.symbol] || ''}<small>${fmtNum(c.rate, 1)} mm/h · ${c.pop === null ? '–' : Math.round(c.pop)} % regnrisk · ${fmtNum(c.wind, 1)} m/s</small></span>
      <span class="ro-agree" title="Hur eniga källorna är">${Math.round(c.agreement * 100)} %<small>enighet</small></span>
    </div>
    <div class="ro-srcs">${srcs}</div>`;

  const back = $('readout').querySelector('.ro-now');
  if (back) back.addEventListener('click', () => setCursor(0));
}

function attachScrub(svg) {
  const at = (ev) => {
    const { rows, g } = chartCache;
    const box = svg.getBoundingClientRect();
    const px = ((ev.clientX - box.left) / box.width) * g.w;
    setCursor(((px - g.padL) / g.plotW) * (rows.length - 1));
  };

  let dragging = false;
  svg.addEventListener('pointerdown', (ev) => {
    dragging = true;
    svg.setPointerCapture(ev.pointerId);
    svg.classList.add('scrubbing');
    at(ev);
  });
  svg.addEventListener('pointermove', (ev) => {
    if (dragging || ev.pointerType === 'mouse') at(ev);
  });
  const stop = (ev) => {
    dragging = false;
    svg.classList.remove('scrubbing');
    if (svg.hasPointerCapture?.(ev.pointerId)) svg.releasePointerCapture(ev.pointerId);
  };
  svg.addEventListener('pointerup', stop);
  svg.addEventListener('pointercancel', stop);
  svg.addEventListener('pointerleave', (ev) => { if (ev.pointerType === 'mouse' && !dragging) setCursor(0); });

  // Piltangenter för den som hellre använder tangentbord
  svg.tabIndex = 0;
  svg.addEventListener('keydown', (ev) => {
    const steps = { ArrowLeft: -1, ArrowRight: 1, PageDown: -6, PageUp: 6, Home: -999, End: 999 };
    if (!(ev.key in steps)) return;
    ev.preventDefault();
    setCursor(ev.key === 'Home' ? 0 : ev.key === 'End' ? chartCache.rows.length - 1 : state.cursor + steps[ev.key]);
  });
}

/* ---------- Timtabell ---------- */

function renderHourTable(rows) {
  const srcs = activeSources();
  const head = `<thead><tr>
      <th class="col-time">Tid</th>
      <th class="col-main">Troligaste</th>
      ${srcs.map((s) => `<th><span class="th-dot" style="background:${sourceColor(s.id)}"></span>${sourceLabel(s)}</th>`).join('')}
      <th>mm/h</th><th>Regnrisk</th><th>Vind</th><th class="col-agree">Enighet</th>
    </tr></thead>`;

  let day = null;
  const body = rows.map((row) => {
    const key = dateFmt.format(row.date);
    const sep = key === day ? '' :
      `<tr class="daysep"><td colspan="${srcs.length + 6}"><span class="wd">${dayLongFmt.format(row.date)}</span> ${key}</td></tr>`;
    day = key;
    const pct = Math.round(row.c.agreement * 100);
    return `${sep}<tr>
      <td class="col-time">${timeFmt.format(row.date)}</td>
      <td class="col-main">${fmtTemp(row.c.temp)}</td>
      ${srcs.map((s) => `<td>${row.per[s.id] ? fmtTemp(row.per[s.id].temp) : '–'}</td>`).join('')}
      <td>${fmtNum(row.c.rate, 1)}</td>
      <td>${row.c.pop === null ? '–' : Math.round(row.c.pop) + ' %'}</td>
      <td>${fmtNum(row.c.wind, 1)}</td>
      <td class="col-agree"><span class="mini"><i style="width:${pct}%;background:${pct >= 75 ? 'var(--good)' : pct >= 50 ? 'var(--warning)' : 'var(--serious)'}"></i></span>${pct} %</td>
    </tr>`;
  }).join('');

  $('hourTable').innerHTML = head + `<tbody>${body}</tbody>`;
}

/* ---------- 10 dygn ---------- */

function renderDays() {
  const days = state.days;
  const lo = Math.min(...days.map((d) => d.min));
  const hi = Math.max(...days.map((d) => d.max));
  const span = Math.max(hi - lo, 1);

  const openFirst = window.matchMedia('(min-width: 780px)').matches;
  $('days').innerHTML = days.map((d, i) => {
    const left = ((d.min - lo) / span) * 100;
    const width = Math.max(((d.max - d.min) / span) * 100, 3);
    const pct = Math.round(d.agreement * 100);
    return `<details class="day"${i === 0 && openFirst ? ' open' : ''}>
      <summary>
        <span class="dname">${i === 0 ? 'Idag' : dayFmt.format(d.date)}<small>${dateFmt.format(d.date)}</small></span>
        <svg viewBox="0 0 64 64" width="30" height="30" aria-label="${SYMBOL_TEXT[d.symbol] || ''}">${glyph(d.symbol, true)}</svg>
        <span class="range"><b>${fmtTemp(d.min)}</b><span class="track"><i style="left:${left}%;width:${width}%"></i></span><b>${fmtTemp(d.max)}</b></span>
        <span class="pr">${d.precip < 0.05 ? 'Uppehåll' : `${fmtNum(d.precip, 1)} mm`}<br><small style="color:var(--text-muted)">${d.precipMax >= 0.1 ? `${fmtNum(d.precipMin, 1)}–${fmtNum(d.precipMax, 1)}` : ''}</small></span>
        <span class="ag">${pct} % enighet</span>
      </summary>
      <div class="detail">
        <table class="grid">
          <thead><tr><th>Källa</th><th>Lägst</th><th>Högst</th><th>Nederbörd</th><th>Max vind</th><th>Väder</th></tr></thead>
          <tbody>${activeSources().map((s) => {
            const p = d.per[s.id];
            if (!p) return `<tr><td>${sourceLabel(s)}</td><td colspan="5">saknar data</td></tr>`;
            return `<tr>
              <td><span class="swatch" style="display:inline-block;background:${sourceColor(s.id)};margin-right:6px"></span>${sourceLabel(s)}</td>
              <td data-label="Lägst">${fmtTemp(p.min)}</td><td data-label="Högst">${fmtTemp(p.max)}</td>
              <td data-label="Nederbörd">${fmtNum(p.precip, 1)} mm</td><td data-label="Max vind">${fmtNum(p.wind, 1)} m/s</td>
              <td data-label="Väder">${SYMBOL_TEXT[p.symbol] || '–'}</td></tr>`;
          }).join('')}
          <tr><td><b>Troligaste</b></td><td data-label="Lägst"><b>${fmtTemp(d.min)}</b></td><td data-label="Högst"><b>${fmtTemp(d.max)}</b></td>
            <td data-label="Nederbörd"><b>${fmtNum(d.precip, 1)} mm</b></td><td data-label="Max vind"><b>${fmtNum(d.wind, 1)} m/s</b></td>
            <td data-label="Väder"><b>${SYMBOL_TEXT[d.symbol] || '–'}</b></td></tr>
          </tbody>
        </table>
      </div>
    </details>`;
  }).join('');
}

/* ------------------------------------------------------------------ *
 * Plats, favoriter och datahämtning
 * ------------------------------------------------------------------ */

function renderFavs() {
  const cur = state.loc;
  $('favs').innerHTML = state.favs.map((f, i) => `
    <span class="chip" role="button" tabindex="0" data-i="${i}" aria-current="${cur && f.lat === cur.lat && f.lon === cur.lon}">
      ${f.name}<span class="x" data-del="${i}" title="Ta bort">×</span>
    </span>`).join('') +
    (cur && !state.favs.some((f) => f.lat === cur.lat && f.lon === cur.lon)
      ? `<span class="chip" id="addFav" role="button" tabindex="0">+ Spara ${cur.name}</span>` : '');
}

async function setLocation(loc, { remember = true } = {}) {
  state.loc = loc;
  if (remember) save(STORE.loc, loc);
  $('place').innerHTML = `${loc.name}<small id="placeSub">${[loc.kommun, loc.lan].filter(Boolean).join(' · ') || `${loc.lat.toFixed(3)}, ${loc.lon.toFixed(3)}`}</small>`;
  renderFavs();
  await refresh();
}

async function refresh({ force = false } = {}) {
  const loc = state.loc;
  const btn = $('refresh');
  btn.setAttribute('aria-busy', 'true');
  $('meta').textContent = force ? 'Hämtar färska prognoser…' : 'Hämtar prognoser…';
  try {
    const data = await Sources.loadAll(loc.lat, loc.lon, { force });
    state.data = data;
    state.fetched = Date.now();
    state.grid = buildGrid(data);
    state.cursor = 0;
    state.days = buildDays(state.grid, data);
    renderSources();
    renderNow();
    renderChart();
    renderDays();
    $('meta').textContent = `Uppdaterad ${timeFmt.format(new Date(data.generated))} · ${data.sources.length} källor · sammanvägning med lika vikt`;
  } catch (err) {
    $('meta').innerHTML = `<span class="err">Kunde inte hämta prognos: ${err.message}</span>`;
  } finally {
    btn.removeAttribute('aria-busy');
  }
}

function useGeolocation() {
  if (!navigator.geolocation) {
    $('meta').innerHTML = '<span class="err">Webbläsaren stödjer inte positionering.</span>';
    return;
  }
  $('meta').textContent = 'Hämtar din position…';
  navigator.geolocation.getCurrentPosition(async (pos) => {
    const { latitude: lat, longitude: lon } = pos.coords;
    let info = { name: 'Min position', kommun: null, lan: null };
    try { info = await Sources.reverseGeocode(lat, lon); } catch { /* behåll fallback */ }
    setLocation({ ...info, lat, lon });
  }, (err) => {
    $('meta').innerHTML = `<span class="err">Position nekad eller otillgänglig (${err.message}). Sök på kommun i stället.</span>`;
  }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 });
}

function initSearch() {
  const input = $('q');
  const box = $('results');
  let timer;

  const close = () => box.classList.remove('open');

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) return close();
    timer = setTimeout(async () => {
      try {
        const results = await Sources.searchPlaces(q);
        if (!results.length) { box.innerHTML = '<button disabled>Ingen träff</button>'; box.classList.add('open'); return; }
        box.innerHTML = results.map((r, i) =>
          `<button data-i="${i}">${r.name}<br><small>${[r.kommun, r.lan].filter(Boolean).join(' · ')}</small></button>`).join('');
        box.classList.add('open');
        box.querySelectorAll('button[data-i]').forEach((b) => b.addEventListener('click', () => {
          const r = results[Number(b.dataset.i)];
          input.value = '';
          close();
          setLocation(r);
        }));
      } catch { close(); }
    }, 220);
  });

  input.addEventListener('blur', () => setTimeout(close, 150));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
}

function initTheme() {
  const saved = load(STORE.theme, null);
  if (saved) document.documentElement.dataset.theme = saved;
  $('theme').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme;
    const next = cur === 'dark' ? 'light' : cur === 'light' ? '' : 'dark';
    if (next) document.documentElement.dataset.theme = next;
    else delete document.documentElement.dataset.theme;
    save(STORE.theme, next);
    if (state.grid) renderChart();
  });
}

function initFavs() {
  $('favs').addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      state.favs.splice(Number(del.dataset.del), 1);
      save(STORE.favs, state.favs);
      renderFavs();
      return;
    }
    if (e.target.closest('#addFav')) {
      state.favs.push({ ...state.loc });
      save(STORE.favs, state.favs);
      renderFavs();
      return;
    }
    const chip = e.target.closest('.chip[data-i]');
    if (chip) setLocation(state.favs[Number(chip.dataset.i)]);
  });
}

async function boot() {
  state.favs = load(STORE.favs, []);
  initTheme();
  initSearch();
  initFavs();
  $('geo').addEventListener('click', useGeolocation);
  $('refresh').addEventListener('click', () => { if (state.loc) refresh({ force: true }); });

  document.querySelector('.seg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-range]');
    if (!b) return;
    state.range = Number(b.dataset.range);
    state.cursor = 0;
    document.querySelectorAll('.seg button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    $('rangeLabel').textContent = state.range;
    if (state.grid) renderChart();
  });
  document.querySelectorAll('.seg button').forEach((b) =>
    b.setAttribute('aria-pressed', String(Number(b.dataset.range) === state.range)));
  $('rangeLabel').textContent = state.range;

  // Diagrammet ritas om när kortet byter bredd (rotation, delad skärm)
  let resizeTimer;
  const redraw = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (state.grid) renderChart(); }, 120);
  };
  window.addEventListener('resize', redraw);
  if (window.ResizeObserver) new ResizeObserver(redraw).observe(document.querySelector('.chart-wrap'));

  // Skugga under topplisten så fort sidan rullas
  const bar = document.querySelector('.topbar');
  const onScroll = () => bar.classList.toggle('scrolled', window.scrollY > 4);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Mobiler fryser sidan i bakgrunden. När den plockas fram igen hämtas
  // färska siffror om de i rutan hunnit bli gamla.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !state.loc) return;
    if (Date.now() - (state.fetched || 0) > 15 * 60 * 1000) refresh({ force: true });
  });

  setInterval(() => { if (state.loc && document.visibilityState === 'visible') refresh(); }, 10 * 60 * 1000);

  const saved = load(STORE.loc, null);
  await setLocation(saved || { name: 'Stockholm', kommun: 'Stockholms kommun', lan: 'Stockholms län', lat: 59.3293, lon: 18.0686 }, { remember: !saved });
}

boot();
