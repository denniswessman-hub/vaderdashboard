/** Syntetiska prognoser för test utan nätverk. */

const SMHI_LIKE = ['clear', 'fair', 'partlycloudy', 'cloudy', 'rain', 'drizzle', 'snow', 'thunder'];

function series({ id, name, model, offset, phase, wetBias, resolution }) {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  const hours = [];
  let t = start.getTime();
  const end = t + 240 * 36e5;
  let i = 0;
  while (t < end) {
    const hourOfDay = new Date(t).getUTCHours();
    const diurnal = Math.sin(((hourOfDay - 4) / 24) * 2 * Math.PI) * 5;
    const trend = Math.sin((i / 40) + phase) * 3;
    const temp = 9 + diurnal + trend + offset;
    const rate = Math.max(0, Math.sin(i / 9 + phase * 2) - 0.55 + wetBias) * 1.4;
    hours.push({
      time: new Date(t).toISOString().slice(0, 13) + ':00:00Z',
      temp: Math.round(temp * 10) / 10,
      wind: Math.round((3 + Math.sin(i / 7) * 2 + offset) * 10) / 10,
      gust: Math.round((6 + Math.sin(i / 7) * 3) * 10) / 10,
      dir: (180 + Math.sin(i / 11) * 90 + 360) % 360,
      precipRate: Math.round(rate * 100) / 100,
      humidity: Math.round(70 + Math.sin(i / 5) * 15),
      cloud: Math.round(50 + Math.sin(i / 6 + phase) * 40),
      symbol: rate > 0.4 ? (temp < 0 ? 'snow' : rate > 0.9 ? 'rain' : 'drizzle')
        : SMHI_LIKE[Math.abs(Math.round(Math.sin(i / 8 + phase) * 3)) % 4],
      span: 1,
      precip: Math.round(rate * 100) / 100,
    });
    // Prognoser glesnar med tiden, precis som hos de riktiga källorna.
    const stepHours = i < 48 ? 1 : i < 96 ? resolution : resolution * 2;
    t += stepHours * 36e5;
    i++;
  }
  // span/precip räknas om utifrån faktiska avstånd
  for (let k = 0; k < hours.length; k++) {
    const next = hours[k + 1];
    const span = next ? (Date.parse(next.time) - Date.parse(hours[k].time)) / 36e5 : 1;
    hours[k].span = span;
    hours[k].precip = Math.round(hours[k].precipRate * span * 100) / 100;
  }
  return { id, name, model, updated: new Date().toISOString(), hours };
}

export function mockForecast(lat, lon) {
  return {
    lat, lon,
    generated: new Date().toISOString(),
    sources: [
      series({ id: 'smhi', name: 'SMHI', model: 'SNOW1g v1', offset: 0, phase: 0, wetBias: 0.1, resolution: 3 }),
      series({ id: 'yr', name: 'Yr', model: 'MET Norway', offset: 1.2, phase: 0.6, wetBias: 0.0, resolution: 6 }),
      series({ id: 'ecmwf', name: 'ECMWF', model: 'Open-Meteo / IFS', offset: -0.8, phase: 1.4, wetBias: 0.2, resolution: 3 }),
    ].map((s, i) => (i === 2 ? { ...s, substituteFor: 'klart' } : s)),
    errors: { klart: 'Klart.se: inget känt API svarade' },
  };
}
