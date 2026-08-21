/** Renderar dashboarden i headless Chromium mot stubbade API-svar i källornas
 *  riktiga format, och rapporterar renderingsfel. */
import { chromium } from 'playwright';

const base = process.env.BASE || 'http://localhost:8788';
const H = 240;
const t0 = new Date(); t0.setUTCMinutes(0, 0, 0);
const iso = (i, step = 1) => new Date(t0.getTime() + i * step * 36e5).toISOString().slice(0, 19) + 'Z';
const wave = (i, off) => 9 + Math.sin((i - 4) / 24 * 2 * Math.PI) * 5 + Math.sin(i / 40) * 3 + off;

// SMHI SNOW1g v1: timvis första dygnet, därefter tretimmars, med
// intervallparametrar som gäller bakåt.
function smhiBody() {
  const timeSeries = [];
  let i = 0, hour = 0;
  while (hour < H) {
    const span = hour < 24 ? 1 : 3;
    timeSeries.push({
      time: iso(hour),
      intervalParametersStartTime: iso(hour - span),
      data: {
        air_temperature: +wave(hour, 0).toFixed(1),
        wind_from_direction: 180, wind_speed: 3.2, wind_speed_of_gust: 6.4,
        relative_humidity: 70, cloud_area_fraction: (i % 9),
        symbol_code: [1, 2, 3, 4, 6, 8, 18, 19][i % 8],
        precipitation_amount_mean: i % 5 === 0 ? 0.6 : 0,
        probability_of_precipitation: (i * 7) % 100,
      },
    });
    hour += span; i++;
  }
  return { createdTime: iso(0), referenceTime: iso(0), geometry: { type: 'Point', coordinates: [18.07, 59.33] }, timeSeries };
}

// MET locationforecast 2.0 compact.
function yrBody() {
  const timeseries = [];
  let hour = 0, i = 0;
  while (hour < H) {
    const span = hour < 48 ? 1 : 6;
    const block = {
      summary: { symbol_code: ['clearsky_day', 'partlycloudy_day', 'cloudy', 'lightrain', 'rain'][i % 5] },
      details: { precipitation_amount: i % 4 === 0 ? 0.4 : 0, probability_of_precipitation: (i * 11) % 100 },
    };
    timeseries.push({
      time: iso(hour),
      data: {
        instant: { details: { air_temperature: +wave(hour, 1.2).toFixed(1), wind_speed: 4.1, wind_speed_of_gust: 7.5, wind_from_direction: 200, relative_humidity: 66, cloud_area_fraction: 40 } },
        [span === 1 ? 'next_1_hours' : 'next_6_hours']: block,
      },
    });
    hour += span; i++;
  }
  return { type: 'Feature', properties: { meta: { updated_at: iso(0) }, timeseries } };
}

// Open-Meteo, timvis hela vägen.
function ecmwfBody() {
  const time = [], temperature_2m = [], precipitation = [], precipitation_probability = [],
    weather_code = [], cloud_cover = [], wind_speed_10m = [], wind_direction_10m = [], wind_gusts_10m = [], relative_humidity_2m = [];
  for (let i = 0; i < H; i++) {
    time.push(iso(i).slice(0, 16));
    temperature_2m.push(+wave(i, -0.8).toFixed(1));
    precipitation.push(i % 6 === 0 ? 0.5 : 0);
    precipitation_probability.push((i * 5) % 100);
    weather_code.push([0, 1, 2, 3, 61, 80][i % 6]);
    cloud_cover.push(55); wind_speed_10m.push(3.6); wind_direction_10m.push(210);
    wind_gusts_10m.push(6.9); relative_humidity_2m.push(72);
  }
  return { hourly: { time, temperature_2m, precipitation, precipitation_probability, weather_code, cloud_cover, wind_speed_10m, wind_direction_10m, wind_gusts_10m, relative_humidity_2m } };
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await browser.newContext({ viewport: { width: 1180, height: 1400 } });

const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
await ctx.route('**opendata-download-metfcst.smhi.se/**', (r) => r.fulfill(json(smhiBody())));
await ctx.route('**api.met.no/**', (r) => r.fulfill(json(yrBody())));
await ctx.route('**api.open-meteo.com/**', (r) => r.fulfill(json(ecmwfBody())));
await ctx.route('**geocoding-api.open-meteo.com/**', (r) => r.fulfill(json({
  results: [{ name: 'Sundsvall', admin1: 'Västernorrlands län', admin2: 'Sundsvalls kommun', latitude: 62.39, longitude: 17.31 }],
})));

const page = await ctx.newPage();
const problems = [];
page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

await page.goto(base, { waitUntil: 'networkidle' });
await page.waitForTimeout(900);

console.log(JSON.stringify(await page.evaluate(() => ({
  temp: document.getElementById('nowTemp').textContent,
  desc: document.getElementById('nowDesc').textContent,
  metrics: [...document.getElementById('nowMetrics').children].map((e) => e.textContent),
  sources: [...document.getElementById('sourceRows').children].map((e) => e.textContent.replace(/\s+/g, ' ').trim()),
  agree: document.getElementById('agreePct').textContent,
  errors: document.getElementById('srcErrors').textContent,
  chartNodes: document.getElementById('chart48').childElementCount,
  days: document.getElementById('days').children.length,
  tableRows: document.querySelectorAll('#hourTable tbody tr').length,
  meta: document.getElementById('meta').textContent,
  overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
})), null, 1));

// Sökningen ska byta plats och spara den
await page.fill('#q', 'Sundsvall');
await page.waitForTimeout(600);
await page.click('#results button');
await page.waitForTimeout(900);
console.log('efter sökning:', await page.evaluate(() => document.getElementById('place').textContent));

await page.screenshot({ path: 'shot-light.png', fullPage: true });
await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
await page.waitForTimeout(250);
await page.screenshot({ path: 'shot-dark.png', fullPage: true });

// Uppdateringsknappen ska hämta om och sätta ny tidsstämpel
await page.click('#refresh');
await page.waitForTimeout(1200);
console.log('efter uppdatering:', await page.evaluate(() => document.getElementById('meta').textContent));

const devices = [
  ['iphone-15', 390, 844, 3],
  ['iphone-se', 375, 667, 2],
  ['galaxy-s24', 384, 832, 3],
  ['galaxy-fold-yttre', 344, 882, 3],
];
for (const [name, w, h, dpr] of devices) {
  const d = await browser.newContext({
    viewport: { width: w, height: h }, deviceScaleFactor: dpr,
    isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  await d.route('**opendata-download-metfcst.smhi.se/**', (r) => r.fulfill(json(smhiBody())));
  await d.route('**api.met.no/**', (r) => r.fulfill(json(yrBody())));
  await d.route('**api.open-meteo.com/**', (r) => r.fulfill(json(ecmwfBody())));
  const mp = await d.newPage();
  mp.on('pageerror', (e) => problems.push(`${name} pageerror: ${e.message}`));
  await mp.goto(base, { waitUntil: 'networkidle' });
  await mp.waitForTimeout(900);
  const info = await mp.evaluate(() => {
    const small = [...document.querySelectorAll('button, summary, .chip')]
      .filter((e) => e.offsetParent !== null && e.getBoundingClientRect().height < 38)
      .map((e) => `${e.id || e.className || e.tagName}:${Math.round(e.getBoundingClientRect().height)}`);
    return {
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      fontSizeSearch: getComputedStyle(document.getElementById('q')).fontSize,
      smallTargets: [...new Set(small)].slice(0, 6),
      hero: document.getElementById('nowTemp').textContent,
    };
  });
  console.log(name, JSON.stringify(info));
  await mp.screenshot({ path: `shot-${name}.png`, fullPage: true });
  await d.close();
}

console.log(problems.length ? `FEL:\n${problems.join('\n')}` : 'Inga konsolfel.');
await browser.close();
