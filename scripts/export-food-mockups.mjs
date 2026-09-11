import { chromium } from '../node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/index.mjs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';

const names = ['Splash', 'Discover', 'Map', 'Restaurant', 'Search', 'Profile', 'OwnerEntry', 'Welcome', 'Details', 'BrandStyle', 'Photos', 'Goals', 'Subscription', 'Dashboard', 'Notifications', 'Settings'];
const out = 'exports/food-advisor-screen-concepts';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/repl/tools/bin/chromium', headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const images = [];
  for (const [index, name] of names.entries()) {
    const url = `https://${process.env.REPLIT_DEV_DOMAIN}/__mockup/preview/food-advisor/${name}`;
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(Array.from(document.images).map(img => img.decode().catch(() => {})));
    });
    const file = `${String(index + 1).padStart(2, '0')}-${name}.png`;
    await page.screenshot({ path: `${out}/${file}` });
    images.push({ name, file });
    console.log(`Exported ${file}`);
  }
  if (errors.length) throw new Error(`Preview errors: ${[...new Set(errors)].join('; ')}`);
  await writeFile(`${out}/README.txt`, 'THE FOOD ADVISOR — SCREEN CONCEPTS\n\n16 proposed mobile screen designs, exported at 1170 × 2532 pixels.\nThese are design mockups, not screenshots of implemented app features.\nRestaurant data, maps, metrics and content are illustrative. AI services and £99/month payments are proposed, not activated.\nLonger screens can be scrolled in the canvas previews; these PNGs show the opening viewport of each screen.\nThe live app has not been changed by this design work.\n');
  const sheet = await browser.newPage({ viewport: { width: 1600, height: 2800 }, deviceScaleFactor: 1 });
  const cards = [];
  for (const { name, file } of images) {
    const image = (await readFile(`${out}/${file}`)).toString('base64');
    cards.push(`<article><h2>${name.replace(/([a-z])([A-Z])/g, '$1 $2')}</h2><img src="data:image/png;base64,${image}" /></article>`);
  }
  await sheet.setContent(`<html><head><style>*{box-sizing:border-box}body{margin:0;background:#f6f2ec;color:#27231e;font-family:Arial;padding:36px}h1{margin:0;font-size:36px}p{color:#665e55}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:24px}article{break-inside:avoid}h2{font-size:16px}img{width:100%;border:1px solid #ddd4c9;border-radius:16px}@media print{body{padding:18px}.grid{grid-template-columns:repeat(4,1fr);gap:12px}h1{font-size:24px}h2{font-size:10px}}</style></head><body><h1>The Food Advisor</h1><p>16 screen concepts · Illustrative data · Not live app screenshots</p><div class="grid">${cards.join('')}</div></body></html>`);
  await sheet.screenshot({ path: `${out}/all-screens-overview.png`, fullPage: true });
  await sheet.pdf({ path: `${out}/screen-concepts.pdf`, width: '1600px', height: '3850px', printBackground: true });
} finally {
  await browser.close();
}