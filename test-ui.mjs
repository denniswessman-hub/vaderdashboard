/** Renderar dashboarden i headless Chromium och rapporterar fel. */
import { chromium } from 'playwright';

const base = process.env.BASE || 'http://localhost:8788';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1180, height: 1400 } });

const problems = [];
page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

await page.goto(base, { waitUntil: 'networkidle' });
await page.waitForTimeout(700);

const probe = await page.evaluate(() => ({
  temp: document.getElementById('nowTemp').textContent,
  desc: document.getElementById('nowDesc').textContent,
  metrics: document.getElementById('nowMetrics').children.length,
  sources: document.getElementById('sourceRows').children.length,
  agree: document.getElementById('agreePct').textContent,
  chartNodes: document.getElementById('chart48').childElementCount,
  days: document.getElementById('days').children.length,
  tableRows: document.querySelectorAll('#hourTable tbody tr').length,
  meta: document.getElementById('meta').textContent,
  overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
}));

console.log(JSON.stringify(probe, null, 2));

// Hovra över diagrammet för att verifiera tooltip
await page.hover('#chart48', { position: { x: 500, y: 120 } });
await page.waitForTimeout(250);
const tip = await page.evaluate(() => ({
  on: document.getElementById('tip').classList.contains('on'),
  text: document.getElementById('tip').textContent.slice(0, 90),
}));
console.log('tooltip:', JSON.stringify(tip));

await page.screenshot({ path: 'shot-light.png', fullPage: true });
await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
await page.waitForTimeout(200);
await page.screenshot({ path: 'shot-dark.png', fullPage: true });

// Mobil
const m = await browser.newPage({ viewport: { width: 390, height: 1500 } });
await m.goto(base, { waitUntil: 'networkidle' });
await m.waitForTimeout(600);
const mobileOverflow = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
await m.screenshot({ path: 'shot-mobile.png', fullPage: true });
console.log('mobil horisontell overflow:', mobileOverflow);

console.log(problems.length ? `FEL:\n${problems.join('\n')}` : 'Inga konsolfel.');
await browser.close();
