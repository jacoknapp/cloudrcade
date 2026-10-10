#!/usr/bin/env node
// Render the maintained SVG into opaque app icons. Requires Playwright + Chromium.
// Run: node scripts/render-icons.cjs [--preview /path/to/preview.png]
// Ordinary/Apple tiles fill more space; the separate maskable icon keeps its safe circle.
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

(async () => {
  const root = path.resolve(__dirname, '..');
  const assets = path.join(root, 'deploy/webrcade/touch/assets');
  const publicImages = path.join(root, 'public/images');
  const svg = await fs.readFile(path.join(assets, 'cloudrcade.svg'), 'utf8');
  const maskable = svg.replace('scale(1.35)', 'scale(1)');
  assert.notEqual(maskable, svg, 'Expected the ordinary icon artwork scale');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto('about:blank');
    for (const [name, size, source] of [
      ...[32, 180, 192, 512].map(size => [`cloudrcade-${size}.png`, size, svg]),
      ['cloudrcade-maskable-512.png', 512, maskable]
    ]) {
      const result = await page.evaluate(async ({ size, source }) => {
        const img = new Image();
        img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(source)));
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const context = canvas.getContext('2d');
        context.drawImage(img, 0, 0, size, size);
        const pixels = context.getImageData(0, 0, size, size).data;
        let alpha = 255, left = size, top = size, right = 0, bottom = 0, radius = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          alpha = Math.min(alpha, pixels[i + 3]);
          if (Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) < 100) continue;
          const x = (i / 4) % size, y = Math.floor(i / 4 / size);
          left = Math.min(left, x); right = Math.max(right, x);
          top = Math.min(top, y); bottom = Math.max(bottom, y);
          radius = Math.max(radius, Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2));
        }
        return { png: canvas.toDataURL('image/png').split(',')[1], alpha,
          bounds: [left, top, right, bottom], radius };
      }, { size, source });
      assert.equal(result.alpha, 255, `${name} must have an opaque full-tile background`);
      const [left, top, right, bottom] = result.bounds;
      assert.ok(Math.abs((left + right + 1) / 2 - size / 2) <= 1, `${name} horizontally centered`);
      assert.ok(Math.abs((top + bottom + 1) / 2 - size / 2) <= 1, `${name} vertically centered`);
      if (name.includes('maskable')) assert.ok(result.radius <= size * 0.4, 'Maskable safe circle');
      else if (size >= 180) assert.ok((bottom - top + 1) / size > 0.84, 'Ordinary artwork fills its tile');
      const png = Buffer.from(result.png, 'base64');
      await fs.writeFile(path.join(assets, name), png);
      await fs.writeFile(path.join(publicImages, name), png);
      console.log(`PASS ${name}: opaque, centered, bounds ${result.bounds.join(',')}`);
    }
    await fs.writeFile(path.join(publicImages, 'cloudrcade.svg'), svg);
    const apple = await fs.readFile(path.join(assets, 'cloudrcade-180.png'));
    await fs.writeFile(path.join(root, 'public/apple-touch-icon.png'), apple);
    await fs.writeFile(path.join(root, 'public/apple-touch-icon-precomposed.png'), apple);
    const favicon = await fs.readFile(path.join(assets, 'cloudrcade-32.png'));
    const icoHeader = Buffer.alloc(22);
    icoHeader.writeUInt16LE(1, 2); icoHeader.writeUInt16LE(1, 4);
    icoHeader[6] = icoHeader[7] = 32;
    icoHeader.writeUInt16LE(1, 10); icoHeader.writeUInt16LE(32, 12);
    icoHeader.writeUInt32LE(favicon.length, 14); icoHeader.writeUInt32LE(22, 18);
    const ico = Buffer.concat([icoHeader, favicon]);
    await fs.writeFile(path.join(assets, 'cloudrcade.ico'), ico);
    await fs.writeFile(path.join(root, 'public/favicon.ico'), ico);
    const previewIndex = process.argv.indexOf('--preview');
    if (previewIndex !== -1) {
      const src = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
      await page.setViewportSize({ width: 640, height: 260 });
      await page.setContent(`<style>body{margin:0;background:#292929;color:white;font:14px sans-serif;display:flex;gap:28px;padding:20px}figure{margin:0;text-align:center}img{width:180px;height:180px;display:block;margin-bottom:12px}.ios{border-radius:40px}</style><figure><img src="${src}">Full tile</figure><figure><img class="ios" src="${src}">iPhone shape</figure><figure><img style="width:96px;height:96px;border-radius:22px" src="${src}">Small tile</figure>`);
      await page.locator('img').evaluateAll(images => Promise.all(images.map(img => img.decode())));
      await page.screenshot({ path: process.argv[previewIndex + 1] });
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
