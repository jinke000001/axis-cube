/**
 * Headless stills and short clips for the v2 teaching hand.
 * Serves nothing itself: expects the capture vite server on 127.0.0.1:3422.
 */
import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import puppeteer from '/tmp/puppeteer/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';

const out = new URL('../artifacts/', import.meta.url);
const stills = new URL('stills/', out);
const frames = new URL('frames/', out);
mkdirSync(stills, { recursive: true });
mkdirSync(new URL('clips/', out), { recursive: true });

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome-stable',
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-dev-shm-usage', '--no-sandbox', '--hide-scrollbars', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setCacheEnabled(false);
page.on('pageerror', error => console.error('PAGE', error.message));
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });

async function open(query) {
  await page.goto(`http://127.0.0.1:3422/${query}`, { waitUntil: 'networkidle0', timeout: 180000 });
  await page.waitForFunction(() => document.body.dataset.ready === '1' || document.body.dataset.error, { timeout: 180000 });
  const error = await page.evaluate(() => document.body.dataset.error || '');
  if (error) throw new Error(`${query} ${error}`);
}

async function still(query, name) {
  await open(query);
  const file = new URL(name, stills).pathname;
  await page.screenshot({ path: file });
  console.log('still', name);
}

async function clip(id, start, end, name, fps = 12) {
  await open(`?shot=frame&id=${id}&t=${start}`);
  const dir = new URL(`${name}/`, frames);
  mkdirSync(dir, { recursive: true });
  const count = Math.max(2, Math.round((end - start) * fps));
  for (let i = 0; i < count; i++) {
    const time = start + (end - start) * i / (count - 1);
    const info = await page.evaluate(t => window.__axis.seek(t), time);
    const file = new URL(`frame-${String(i).padStart(4, '0')}.png`, dir).pathname;
    await page.screenshot({ path: file });
    if (i === 0 || i === count - 1) console.log(name, i, info.phase, info.instruction);
  }
  const video = new URL(`clips/${name}.mp4`, out).pathname;
  const encoded = spawnSync('ffmpeg', ['-y', '-framerate', String(fps), '-i', new URL('frame-%04d.png', dir).pathname, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', video], { encoding: 'utf8' });
  if (encoded.status !== 0) throw new Error(encoded.stderr);
  console.log('clip', name, count);
}

await still('?shot=compare&model=early&view=quarter', 'compare-early.png');
await still('?shot=compare&model=baseline&view=quarter', 'compare-baseline.png');
await still('?shot=compare&model=v2&view=quarter', 'compare-v2.png');
await still('?shot=open&view=quarter', 'open-hand.png');
await still('?shot=hold&t=0', 'holding-cube.png');
await still('?shot=frame&id=gan-f2l-40&t=1.15', 'f2l-40-insert.png');
await still('?shot=frame&id=gan-oll-18&t=28.7', 'oll-18-dual-flick.png');
await still('?shot=frame&id=gan-oll-12&t=19.2', 'oll-12-mid-layer.png');
await clip('gan-f2l-40', 0, 4.8, 'f2l-40-insert');
await clip('gan-oll-18', 25.73, 30.58, 'oll-18-dual-flick', 10);
await clip('gan-oll-12', 18.2, 20.19, 'oll-12-mid-layer', 12);
await browser.close();
console.log('CAPTURE_DONE');
