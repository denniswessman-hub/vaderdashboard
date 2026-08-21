/**
 * Väderdashboard – API-proxy och normalisering.
 *
 * Körs både som Cloudflare Pages "advanced mode"-worker (_worker.js i dist/)
 * och lokalt via dev-server.mjs, som importerar samma default-export.
 *
 * Rutter:
 *   GET /api/geo?q=Sundsvall          -> platssökning
 *   GET /api/revgeo?lat=&lon=         -> omvänd geokodning (för GPS)
 *   GET /api/forecast?lat=&lon=       -> normaliserad prognos från alla källor
 *   GET /api/klart-debug?q=Stockholm  -> diagnostik för Klart.se-adaptern
 */

// MET Norway kräver att anropande klient identifierar sig. En URL till den
// publicerade sidan duger, så adressen sätts automatiskt från inkommande
// begäran – ingen mejladress behöver ligga i koden. FALLBACK används bara
// när koden körs utan känd värd (t.ex. enhetstester).
const FALLBACK_SITE = 'https://github.com/denniswessman-hub/vaderdashboard';
let UA = `vaderdashboard/1.0 (+${FALLBACK_SITE})`;

function setIdentity(origin) {
  if (origin && !origin.includes('localhost') && !origin.includes('127.0.0.1')) {
    UA = `vaderdashboard/1.0 (+${origin})`;
  }
}

const CACHE_TTL_MS = 10 * 60 * 1000;
const memCache = new Map();

/* ------------------------------------------------------------------ *
 * Hjälpare
 * ------------------------------------------------------------------ */

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=300',
      ...extraHeaders,
    },
  });
}

async function cached(key, ttl, producer) {
  const hit = memCache.get(key);
  const now = Date.now();
  if (hit && hit.expires > now) return hit.value;
  const value = await producer();
  memCache.set(key, { value, expires: now + ttl });
  if (memCache.size > 200) {
    for (const [k, v] of memCache) if (v.expires <= now) memCache.delete(k);
  }
  return value;
}

async function fetchJson(url, { headers = {}, timeout = 8000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': UA, accept: 'application/json', ...headers },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} från ${new URL(url).host}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

const round = (v, d = 1) => (v === null || v === undefined || Number.isNaN(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
const hourKey = (iso) => new Date(iso).toISOString().slice(0, 13) + ':00:00Z';

/* ------------------------------------------------------------------ *
 * Kanoniska vädersymboler
 * ------------------------------------------------------------------ *
 * clear, fair, partlycloudy, cloudy, fog, drizzle, rain, heavyrain,
 * sleet, snow, heavysnow, thunder
 */

// Ordnad skala används när källorna är oeniga och ingen har majoritet:
// då väljs medianen på denna skala.
const SEVERITY = [
  'clear', 'fair', 'partlycloudy', 'cloudy', 'fog', 'drizzle',
  'sleet', 'snow', 'heavysnow', 'rain', 'heavyrain', 'thunder',
];

const SMHI_SYMBOL = {
  1: 'clear', 2: 'fair', 3: 'partlycloudy', 4: 'partlycloudy', 5: 'cloudy', 6: 'cloudy',
  7: 'fog', 8: 'drizzle', 9: 'rain', 10: 'heavyrain', 11: 'thunder',
  12: 'sleet', 13: 'sleet', 14: 'sleet', 15: 'snow', 16: 'snow', 17: 'heavysnow',
  18: 'drizzle', 19: 'rain', 20: 'heavyrain', 21: 'thunder',
  22: 'sleet', 23: 'sleet', 24: 'sleet', 25: 'snow', 26: 'snow', 27: 'heavysnow',
};

function metSymbol(code) {
  if (!code) return null;
  const c = String(code).replace(/_(day|night|polartwilight)$/, '');
  if (c === 'clearsky') return 'clear';
  if (c === 'fair') return 'fair';
  if (c === 'partlycloudy') return 'partlycloudy';
  if (c === 'cloudy') return 'cloudy';
  if (c === 'fog') return 'fog';
  if (c.includes('thunder')) return 'thunder';
  if (c.includes('sleet')) return 'sleet';
  if (c.includes('snow')) return c.startsWith('heavy') ? 'heavysnow' : 'snow';
  if (c.startsWith('heavyrain')) return 'heavyrain';
  if (c.startsWith('lightrain')) return 'drizzle';
  if (c.includes('rain')) return 'rain';
  return 'cloudy';
}

function wmoSymbol(code) {
  const c = Number(code);
  if (c === 0) return 'clear';
  if (c === 1) return 'fair';
  if (c === 2) return 'partlycloudy';
  if (c === 3) return 'cloudy';
  if (c === 45 || c === 48) return 'fog';
  if (c >= 51 && c <= 57) return 'drizzle';
  if (c === 61 || c === 80) return 'rain';
  if (c === 63 || c === 81) return 'rain';
  if (c === 65 || c === 82) return 'heavyrain';
  if (c === 66 || c === 67) return 'sleet';
  if (c === 71 || c === 73 || c === 85) return 'snow';
  if (c === 75 || c === 77 || c === 86) return 'heavysnow';
  if (c >= 95) return 'thunder';
  return 'cloudy';
}

/* ------------------------------------------------------------------ *
 * Källa 1: SMHI (snow1gv1)
 * ------------------------------------------------------------------ */

async function fetchSMHI(lat, lon) {
  const la = Number(lat).toFixed(6);
  const lo = Number(lon).toFixed(6);
  const url = `https://opendata-download-metfcst.smhi.se/api/category/snow1g/version/1/geotype/point/lon/${lo}/lat/${la}/data.json`;
  const raw = await fetchJson(url);
  const series = raw.timeSeries || raw.timeseries || [];
  if (!series.length) throw new Error('SMHI: tom tidsserie');

  const pick = (entry) => {
    // snow1gv1 levererar platt JSON, pmp3g levererade parameters[]-array.
    // Adaptern hanterar båda formerna.
    if (Array.isArray(entry.parameters)) {
      const m = {};
      for (const p of entry.parameters) m[p.name] = Array.isArray(p.values) ? p.values[0] : p.value;
      return m;
    }
    return entry;
  };
  const num = (m, ...keys) => {
    for (const k of keys) {
      const v = m[k];
      if (typeof v === 'number' && !Number.isNaN(v)) return v;
    }
    return null;
  };

  const hours = series.map((entry) => {
    const m = pick(entry);
    const sym = num(m, 'Wsymb2', 'wsymb2', 'Wsymb', 'weather_symbol');
    return {
      time: hourKey(entry.validTime || entry.valid_time || entry.time),
      temp: num(m, 't', 'temperature', 'air_temperature'),
      wind: num(m, 'ws', 'wind_speed'),
      gust: num(m, 'gust', 'wind_gust', 'ws_gust'),
      dir: num(m, 'wd', 'wind_direction'),
      precipRate: num(m, 'pmean', 'pmedian', 'precipitation_mean', 'pmin'),
      humidity: num(m, 'r', 'relative_humidity'),
      cloud: (() => {
        const c = num(m, 'tcc_mean', 'tcc', 'total_cloud_cover');
        return c === null ? null : c * 12.5; // oktas -> procent
      })(),
      symbol: sym === null ? null : SMHI_SYMBOL[Math.round(sym)] || null,
    };
  });

  return {
    id: 'smhi',
    name: 'SMHI',
    model: 'SNOW1g v1',
    updated: raw.approvedTime || raw.referenceTime || null,
    hours: withDurations(hours),
  };
}

/* ------------------------------------------------------------------ *
 * Källa 2: Yr / MET Norway (locationforecast 2.0)
 * ------------------------------------------------------------------ */

async function fetchYR(lat, lon) {
  const la = Number(lat).toFixed(4);
  const lo = Number(lon).toFixed(4);
  const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${la}&lon=${lo}`;
  const raw = await fetchJson(url);
  const series = raw?.properties?.timeseries || [];
  if (!series.length) throw new Error('Yr: tom tidsserie');

  const hours = series.map((entry) => {
    const d = entry.data || {};
    const inst = d.instant?.details || {};
    const n1 = d.next_1_hours;
    const n6 = d.next_6_hours;
    const block = n1 || n6 || d.next_12_hours;
    const span = n1 ? 1 : n6 ? 6 : 12;
    const amount = block?.details?.precipitation_amount;
    return {
      time: hourKey(entry.time),
      temp: inst.air_temperature ?? null,
      wind: inst.wind_speed ?? null,
      gust: inst.wind_speed_of_gust ?? null,
      dir: inst.wind_from_direction ?? null,
      precipRate: typeof amount === 'number' ? amount / span : null,
      humidity: inst.relative_humidity ?? null,
      cloud: inst.cloud_area_fraction ?? null,
      symbol: metSymbol(block?.summary?.symbol_code),
    };
  });

  return {
    id: 'yr',
    name: 'Yr',
    model: 'MET Norway',
    updated: raw?.properties?.meta?.updated_at || null,
    hours: withDurations(hours),
  };
}

/* ------------------------------------------------------------------ *
 * Källa 3: Klart.se (experimentell) med ECMWF som reserv
 * ------------------------------------------------------------------ */

// Klart.se publicerar inget dokumenterat API. Adaptern provar kända
// mönster i tur och ordning och rapporterar utfallet via /api/klart-debug.
function klartCandidates(lat, lon, q) {
  const la = Number(lat).toFixed(4);
  const lo = Number(lon).toFixed(4);
  const name = encodeURIComponent(q || '');
  return [
    `https://www.klart.se/api/forecast?lat=${la}&lon=${lo}`,
    `https://www.klart.se/api/v1/forecast?latitude=${la}&longitude=${lo}`,
    `https://api.klart.se/v1/forecast?lat=${la}&lon=${lo}`,
    `https://www.klart.se/api/search?q=${name}`,
    `https://www.klart.se/api/locations/search?query=${name}`,
  ];
}

async function probeKlart(lat, lon, q) {
  const results = [];
  for (const url of klartCandidates(lat, lon, q)) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(url, {
        headers: { 'user-agent': UA, accept: 'application/json,text/html' },
        signal: ctrl.signal,
      });
      clearTimeout(t);
      const ct = res.headers.get('content-type') || '';
      const body = await res.text();
      results.push({
        url,
        status: res.status,
        contentType: ct,
        looksJson: ct.includes('json') || body.trimStart().startsWith('{'),
        sample: body.slice(0, 600),
      });
    } catch (err) {
      results.push({ url, error: String(err && err.message ? err.message : err) });
    }
  }
  return results;
}

async function fetchKlart(lat, lon) {
  for (const url of klartCandidates(lat, lon).slice(0, 3)) {
    try {
      const data = await fetchJson(url, { timeout: 5000 });
      const hours = normaliseKlart(data);
      if (hours && hours.length > 6) {
        return { id: 'klart', name: 'Klart', model: 'klart.se', updated: null, hours: withDurations(hours) };
      }
    } catch {
      /* prova nästa mönster */
    }
  }
  throw new Error('Klart.se: inget känt API svarade');
}

// Bäst-möjliga tolkning av ett okänt JSON-svar från Klart.
function normaliseKlart(data) {
  const arr =
    data?.forecast?.hourly || data?.hourly || data?.timeSeries || data?.timeseries ||
    (Array.isArray(data) ? data : null);
  if (!Array.isArray(arr)) return null;
  return arr
    .map((e) => {
      const time = e.time || e.validTime || e.datetime || e.date;
      if (!time) return null;
      return {
        time: hourKey(time),
        temp: e.temperature ?? e.temp ?? e.t ?? null,
        wind: e.windSpeed ?? e.wind ?? e.ws ?? null,
        gust: e.windGust ?? e.gust ?? null,
        dir: e.windDirection ?? e.wd ?? null,
        precipRate: e.precipitation ?? e.precip ?? e.rain ?? null,
        humidity: e.humidity ?? e.r ?? null,
        cloud: e.cloudiness ?? e.cloudCover ?? null,
        symbol: null,
      };
    })
    .filter(Boolean);
}

async function fetchECMWF(lat, lon) {
  const la = Number(lat).toFixed(4);
  const lo = Number(lon).toFixed(4);
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${la}&longitude=${lo}` +
    '&hourly=temperature_2m,relative_humidity_2m,precipitation,weather_code,cloud_cover,' +
    'wind_speed_10m,wind_direction_10m,wind_gusts_10m' +
    '&models=ecmwf_ifs025&wind_speed_unit=ms&forecast_days=10&timezone=UTC';
  const raw = await fetchJson(url);
  const h = raw.hourly;
  if (!h || !h.time) throw new Error('ECMWF: tomt svar');

  const hours = h.time.map((t, i) => ({
    time: hourKey(t.endsWith('Z') ? t : `${t}Z`),
    temp: h.temperature_2m?.[i] ?? null,
    wind: h.wind_speed_10m?.[i] ?? null,
    gust: h.wind_gusts_10m?.[i] ?? null,
    dir: h.wind_direction_10m?.[i] ?? null,
    precipRate: h.precipitation?.[i] ?? null,
    humidity: h.relative_humidity_2m?.[i] ?? null,
    cloud: h.cloud_cover?.[i] ?? null,
    symbol: h.weather_code?.[i] === undefined ? null : wmoSymbol(h.weather_code[i]),
  }));

  return { id: 'ecmwf', name: 'ECMWF', model: 'Open-Meteo / IFS', updated: null, hours: withDurations(hours) };
}

/* ------------------------------------------------------------------ *
 * Normalisering
 * ------------------------------------------------------------------ */

// Prognoser glesnar med tiden (1 h -> 3 h -> 6 h). Varje punkt får bära
// hur många timmar den representerar, annars blir nederbördssummorna fel.
function withDurations(hours) {
  const clean = hours
    .filter((h) => h && h.time && h.temp !== null && h.temp !== undefined)
    .sort((a, b) => a.time.localeCompare(b.time));
  for (let i = 0; i < clean.length; i++) {
    const next = clean[i + 1];
    const span = next ? (new Date(next.time) - new Date(clean[i].time)) / 36e5 : 1;
    clean[i].span = Math.min(Math.max(span, 1), 12);
    clean[i].precip = clean[i].precipRate === null ? null : round(clean[i].precipRate * clean[i].span, 2);
  }
  return clean;
}

/* ------------------------------------------------------------------ *
 * Rutter
 * ------------------------------------------------------------------ */

async function handleGeo(url) {
  const q = (url.searchParams.get('q') || '').trim();
  if (q.length < 2) return json({ results: [] });
  const api =
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}` +
    '&count=12&language=sv&format=json&countryCode=SE';
  const raw = await cached(`geo:${q.toLowerCase()}`, 24 * 3600e3, () => fetchJson(api));
  const results = (raw.results || []).map((r) => ({
    name: r.name,
    kommun: r.admin2 || r.admin3 || null,
    lan: r.admin1 || null,
    lat: r.latitude,
    lon: r.longitude,
    population: r.population || 0,
  }));
  return json({ results });
}

async function handleRevGeo(url) {
  const lat = url.searchParams.get('lat');
  const lon = url.searchParams.get('lon');
  if (!lat || !lon) return json({ error: 'lat och lon krävs' }, 400);
  try {
    const api = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=sv`;
    const raw = await cached(`rev:${Number(lat).toFixed(2)},${Number(lon).toFixed(2)}`, 24 * 3600e3, () => fetchJson(api));
    return json({
      name: raw.city || raw.locality || raw.principalSubdivision || 'Min position',
      kommun: raw.localityInfo?.administrative?.find((a) => a.adminLevel === 7)?.name || raw.city || null,
      lan: raw.principalSubdivision || null,
    });
  } catch {
    return json({ name: 'Min position', kommun: null, lan: null });
  }
}

async function handleForecast(url) {
  const lat = Number(url.searchParams.get('lat'));
  const lon = Number(url.searchParams.get('lon'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return json({ error: 'ogiltiga koordinater' }, 400);

  const key = `fc:${lat.toFixed(3)},${lon.toFixed(3)}`;
  const payload = await cached(key, CACHE_TTL_MS, async () => {
    const settled = await Promise.allSettled([
      fetchSMHI(lat, lon),
      fetchYR(lat, lon),
      fetchKlart(lat, lon),
    ]);

    const sources = [];
    const errors = {};
    const ids = ['smhi', 'yr', 'klart'];
    settled.forEach((r, i) => {
      if (r.status === 'fulfilled') sources.push(r.value);
      else errors[ids[i]] = String(r.reason && r.reason.message ? r.reason.message : r.reason);
    });

    // Utan Klart faller vi tillbaka på ECMWF så att sammanvägningen
    // fortfarande vilar på tre oberoende modeller.
    if (!sources.some((s) => s.id === 'klart')) {
      try {
        const ec = await fetchECMWF(lat, lon);
        ec.substituteFor = 'klart';
        sources.push(ec);
      } catch (err) {
        errors.ecmwf = String(err.message || err);
      }
    }

    return { lat, lon, generated: new Date().toISOString(), sources, errors };
  });

  return json(payload);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    setIdentity(url.origin);

    try {
      if (path === '/api/geo') return await handleGeo(url);
      if (path === '/api/revgeo') return await handleRevGeo(url);
      if (path === '/api/forecast') return await handleForecast(url);
      if (path === '/api/klart-debug') {
        const lat = url.searchParams.get('lat') || '59.3293';
        const lon = url.searchParams.get('lon') || '18.0686';
        const q = url.searchParams.get('q') || 'Stockholm';
        return json({ probes: await probeKlart(lat, lon, q) }, 200, { 'cache-control': 'no-store' });
      }
      if (path.startsWith('/api/')) return json({ error: 'okänd rutt' }, 404);
    } catch (err) {
      return json({ error: String(err && err.message ? err.message : err) }, 502, { 'cache-control': 'no-store' });
    }

    return env.ASSETS.fetch(request);
  },
};
