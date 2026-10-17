// Renders media/icon-marketplace.svg to the Marketplace icon, media/icon.png
// (the Marketplace refuses SVG icons). Run after changing the SVG.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const media = fileURLToPath(new URL('../media/', import.meta.url));
const svg = readFileSync(`${media}icon-marketplace.svg`, 'utf8');
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 256, height: 256 } });
  await page.setContent(`<style>html,body{margin:0;background:transparent}</style>${svg}`);
  await page.locator('svg').screenshot({ path: `${media}icon.png`, omitBackground: true });
} finally {
  await browser.close();
}
