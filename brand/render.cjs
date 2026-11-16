// Renders logo.html and header.html to PNG: `node brand/render.cjs` (needs Playwright).
const { chromium } = require('playwright');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

(async () => {
  const browser = await chromium.launch();
  for (const [page, out, width, height] of [['logo.html', 'logo-1000.png', 1000, 1000], ['header.html', 'header-1500x500.png', 1500, 500]]) {
    const tab = await browser.newPage({ viewport: { width, height } });
    await tab.goto(pathToFileURL(path.join(__dirname, page)).href);
    await tab.evaluate(() => document.fonts.ready);
    await tab.screenshot({ path: path.join(__dirname, out) });
  }
  await browser.close();
})();
