// temp debug runner: node scripts/_dbg.mjs file.mjs  (file exports steps: array of {eval?: string, shot?: path, wait?: ms})
import { createServer } from 'vite';
import { chromium } from 'playwright';
const steps = (await import(process.argv[2])).default;
const port = 6000 + Math.floor(Math.random() * 90);
const server = await createServer({ root: '/Users/sachingupta/Developer/3js_game', server: { port, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
try {
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  for (const s of steps) {
    if (s.eval) console.log(JSON.stringify(await page.evaluate(s.eval)));
    if (s.wait) await page.waitForTimeout(s.wait);
    if (s.shot) await page.screenshot({ path: s.shot });
  }
} catch (e) { console.log('ERR', e.message.split('\n')[0]); }
await browser.close(); await server.close(); process.exit(0);
