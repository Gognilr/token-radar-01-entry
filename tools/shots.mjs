// Takes the three dossier screenshots of the built dashboard with Playwright
// Chromium: the board, a protocol's detail view, and a filtered view.
//   node tools/shots.mjs [out-dir]
// Writes JPEGs (quality 82) into <repo>/screenshots/.

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const outDir = process.argv[2] ?? join(repo, 'out');
const page_url = `file://${join(outDir, 'dashboard', 'index.html')}`;

const shots = [
  { name: '1-board.jpg', url: page_url, wait: '#rows tr' },
  { name: '2-detail.jpg', url: `${page_url}#detail=steakhouse-financial`, wait: '#detail:not([hidden])' },
  { name: '3-filtered.jpg', url: `${page_url}#cat=Risk%20Curators`, wait: '#rows tr' },
];

const browser = await chromium.launch();
for (const shot of shots) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(shot.url, { waitUntil: 'load' });
  await page.waitForSelector(shot.wait, { timeout: 10000 });
  await page.waitForTimeout(600);
  if (shot.name.startsWith('2-')) await page.locator('#detail').scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(repo, 'screenshots', shot.name), type: 'jpeg', quality: 82 });
  console.log('shot', shot.name);
  await page.close();
}
await browser.close();
