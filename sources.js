/* Väderkällor – hämtar och normaliserar SMHI, Yr och ECMWF direkt i webbläsaren.
 *
 * Alla tre API:erna tillåter anrop från webbläsare, så sidan behöver ingen
 * serverdel. Svaren cachas i 15 minuter per plats för att inte belasta
 * källorna i onödan – särskilt MET Norway, vars villkor ber om måttlig trafik.
 *
 * Normaliserad form per timme:
 *   { time, temp, wind, gust, dir, rate, pop, humidity, cloud, symbol }
 *   rate = nederbörd i mm/h som gäller framåt från tidpunkten
 *   pop  = sannolikhet för nederbörd i procent, null om källan saknar den
 */

const Sources = (() => {
  'use strict';

  const CACHE_TTL = 15 * 60 * 1000;
  const hourKey = (iso) => new Date(iso).toISOString().slice(0, 13) + ':00:00Z';

  /* ---------- cache ---------- */

  function cacheGet(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const { t, v } = JSON.parse(raw);
      return Date.now() - t < CACHE_TTL ? v : null;
    } catch { return null; }
  }
  function cacheSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), v: value })); } catch { /* fullt eller privat läge */ }
  }
  async function cached(key, producer) {
    const hit = cacheGet(key);
    if (hit) return hit;
    const value = await producer();
    cacheSet(key, value);
    return value;
  }

  async function getJson(url, timeout = 12000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status} från ${new URL(url).host}`);
      return await res.json();
    } finally { clearTimeout(timer); }
  }

  /* ---------- symboler ---------- */

  // SMHI:s symbol_code följer Wsymb2-skalan 1–27.
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
    if (c === 61 || c === 63 || c === 80 || c === 81) return 'rain';
    if (c === 65 || c === 82) return 'heavyrain';
    if (c === 66 || c === 67) return 'sleet';
    if (c === 71 || c === 73 || c === 85) return 'snow';
    if (c === 75 || c === 77 || c === 86) return 'heavysnow';
    if (c >= 95) return 'thunder';
    return 'cloudy';
  }

  /* ---------- SMHI ---------- */

  // SNOW1g v1. Intervallparametrar (nederbörd, sannolikhet) gäller tiden FRAM
  // till entryts tidpunkt, medan sidan räknar framåt – därför flyttas de ett
  // steg bakåt så att varje timme bär nederbörden som komma skall.
  async function smhi(lat, lon) {
    const url = 'https://opendata-download-metfcst.smhi.se/api/category/snow1g/version/1' +
      `/geotype/point/lon/${Number(lon).toFixed(6)}/lat/${Number(lat).toFixed(6)}/data.json`;
    const raw = await getJson(url);
    const series = raw.timeSeries || [];
    if (!series.length) throw new Error('SMHI: tom tidsserie');

    const rows = series.map((e) => {
      const d = e.data || {};
      const start = e.intervalParametersStartTime ? Date.parse(e.intervalParametersStartTime) : null;
      const span = start ? Math.max((Date.parse(e.time) - start) / 36e5, 1) : 1;
      return {
        time: hourKey(e.time),
        temp: d.air_temperature ?? null,
        wind: d.wind_speed ?? null,
        gust: d.wind_speed_of_gust ?? null,
        dir: d.wind_from_direction ?? null,
        humidity: d.relative_humidity ?? null,
        cloud: d.cloud_area_fraction === undefined ? null : d.cloud_area_fraction * 12.5, // oktas
        symbol: SMHI_SYMBOL[Math.round(d.symbol_code)] || null,
        _amount: d.precipitation_amount_mean ?? null,
        _span: span,
        _pop: d.probability_of_precipitation ?? null,
      };
    });

    rows.forEach((row, i) => {
      const next = rows[i + 1];
      row.rate = next && next._amount !== null ? next._amount / next._span : 0;
      row.pop = next ? next._pop : null;
    });

    return { id: 'smhi', name: 'SMHI', model: 'SNOW1g v1', updated: raw.referenceTime || raw.createdTime || null, hours: rows };
  }

  /* ---------- Yr / MET Norway ---------- */

  async function yr(lat, lon) {
    const url = 'https://api.met.no/weatherapi/locationforecast/2.0/compact' +
      `?lat=${Number(lat).toFixed(4)}&lon=${Number(lon).toFixed(4)}`;
    const raw = await getJson(url);
    const series = raw?.properties?.timeseries || [];
    if (!series.length) throw new Error('Yr: tom tidsserie');

    const rows = series.map((e) => {
      const d = e.data || {};
      const inst = d.instant?.details || {};
      const block = d.next_1_hours || d.next_6_hours || d.next_12_hours;
      const span = d.next_1_hours ? 1 : d.next_6_hours ? 6 : 12;
      const amount = block?.details?.precipitation_amount;
      return {
        time: hourKey(e.time),
        temp: inst.air_temperature ?? null,
        wind: inst.wind_speed ?? null,
        gust: inst.wind_speed_of_gust ?? null,
        dir: inst.wind_from_direction ?? null,
        humidity: inst.relative_humidity ?? null,
        cloud: inst.cloud_area_fraction ?? null,
        symbol: metSymbol(block?.summary?.symbol_code),
        rate: typeof amount === 'number' ? amount / span : 0,
        pop: block?.details?.probability_of_precipitation ?? null,
      };
    });

    return { id: 'yr', name: 'Yr', model: 'MET Norway', updated: raw?.properties?.meta?.updated_at || null, hours: rows };
  }

  /* ---------- ECMWF via Open-Meteo ---------- */

  // Open-Meteo anger nederbörd som summan för timmen FÖRE tidsstämpeln,
  // så samma bakåtflytt görs här som för SMHI.
  async function ecmwf(lat, lon) {
    const url = 'https://api.open-meteo.com/v1/forecast' +
      `?latitude=${Number(lat).toFixed(4)}&longitude=${Number(lon).toFixed(4)}` +
      '&hourly=temperature_2m,relative_humidity_2m,precipitation,precipitation_probability,' +
      'weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m' +
      '&models=ecmwf_ifs025&wind_speed_unit=ms&forecast_days=10&timezone=UTC';
    const raw = await getJson(url);
    const h = raw.hourly;
    if (!h || !h.time) throw new Error('ECMWF: tomt svar');

    const rows = h.time.map((t, i) => ({
      time: hourKey(t.endsWith('Z') ? t : `${t}Z`),
      temp: h.temperature_2m?.[i] ?? null,
      wind: h.wind_speed_10m?.[i] ?? null,
      gust: h.wind_gusts_10m?.[i] ?? null,
      dir: h.wind_direction_10m?.[i] ?? null,
      humidity: h.relative_humidity_2m?.[i] ?? null,
      cloud: h.cloud_cover?.[i] ?? null,
      symbol: h.weather_code?.[i] === undefined || h.weather_code[i] === null ? null : wmoSymbol(h.weather_code[i]),
      _amount: h.precipitation?.[i] ?? null,
      _pop: h.precipitation_probability?.[i] ?? null,
    }));

    rows.forEach((row, i) => {
      const next = rows[i + 1];
      row.rate = next && next._amount !== null ? next._amount : 0;
      row.pop = next ? next._pop : null;
    });

    return { id: 'ecmwf', name: 'ECMWF', model: 'IFS via Open-Meteo', updated: null, hours: rows };
  }

  /* ---------- publikt ---------- */

  const KEY = (id, lat, lon) => `vd.cache.${id}.${lat.toFixed(3)},${lon.toFixed(3)}`;

  async function loadAll(lat, lon) {
    const jobs = [
      ['smhi', smhi],
      ['yr', yr],
      ['ecmwf', ecmwf],
    ];
    const settled = await Promise.allSettled(
      jobs.map(([id, fn]) => cached(KEY(id, lat, lon), () => fn(lat, lon)))
    );

    const sources = [];
    const errors = {};
    settled.forEach((res, i) => {
      const id = jobs[i][0];
      if (res.status === 'fulfilled') sources.push(withSpans(res.value));
      else errors[id] = String(res.reason && res.reason.message ? res.reason.message : res.reason);
    });

    if (!sources.length) throw new Error(Object.values(errors).join(' · ') || 'Ingen källa svarade');
    return { lat, lon, generated: new Date().toISOString(), sources, errors };
  }

  // Prognoserna glesnar med tiden; varje punkt får bära hur många timmar den
  // täcker så att dygnssummor blir rätt.
  function withSpans(source) {
    const hours = source.hours
      .filter((h) => h && h.time && typeof h.temp === 'number')
      .sort((a, b) => a.time.localeCompare(b.time));
    for (let i = 0; i < hours.length; i++) {
      const next = hours[i + 1];
      const span = next ? (Date.parse(next.time) - Date.parse(hours[i].time)) / 36e5 : 1;
      hours[i].span = Math.min(Math.max(span, 1), 12);
    }
    return { ...source, hours };
  }

  async function searchPlaces(q) {
    const url = 'https://geocoding-api.open-meteo.com/v1/search' +
      `?name=${encodeURIComponent(q)}&count=12&language=sv&format=json&countryCode=SE`;
    const raw = await cached(`vd.geo.${q.toLowerCase()}`, () => getJson(url, 8000));
    return (raw.results || []).map((r) => ({
      name: r.name,
      kommun: r.admin2 || r.admin3 || null,
      lan: r.admin1 || null,
      lat: r.latitude,
      lon: r.longitude,
    }));
  }

  async function reverseGeocode(lat, lon) {
    try {
      const url = 'https://api.bigdatacloud.net/data/reverse-geocode-client' +
        `?latitude=${lat}&longitude=${lon}&localityLanguage=sv`;
      const raw = await getJson(url, 8000);
      return {
        name: raw.city || raw.locality || raw.principalSubdivision || 'Min position',
        kommun: raw.localityInfo?.administrative?.find((a) => a.adminLevel === 7)?.name || raw.city || null,
        lan: raw.principalSubdivision || null,
      };
    } catch {
      return { name: 'Min position', kommun: null, lan: null };
    }
  }

  return { loadAll, searchPlaces, reverseGeocode };
})();
