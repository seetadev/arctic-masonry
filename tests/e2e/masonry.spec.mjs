// Real-browser tests of the demo page (Chromium and Firefox). No mocks: the real server, module and images.
import { test, expect } from '@playwright/test';

const WIDTHS = [[500, 2], [800, 3], [1280, 5], [2300, 8]];

async function open(page, width) {
  const problems = [];
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push(`console.${m.type()}: ${m.text()}`); });
  page.on('requestfailed', (r) => problems.push('requestfailed: ' + r.url()));
  page.on('response', (r) => { if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url()}`); });
  await page.setViewportSize({ width, height: 800 });
  await page.goto('/');
  await expect(page.locator('#main')).toHaveAttribute('data-loaded', /\d+/);
  return problems;
}

// Load all 16 images: scroll loading may already have done it (wide viewports), otherwise use the button.
async function loadAll(page) {
  const main = page.locator('#main');
  await expect(async () => {
    // The button can vanish between the check and the click if scroll loading finishes first: that is fine.
    await page.locator('.arctic-more').click({ timeout: 500 }).catch(() => {});
    await expect(main).toHaveAttribute('data-loaded', '16', { timeout: 500 });
  }).toPass({ timeout: 15_000 });
}

// Images decoded AND entrance transitions finished (tiles animate in with a transform that distorts their rects).
const settle = (page) => page.waitForFunction(() =>
  [...document.querySelectorAll('.arctic-block img')].every((i) => i.complete) &&
  [...document.querySelectorAll('.arctic-block, .arctic-columns')].every((e) => getComputedStyle(e).transform === 'none' &&
    e.getAnimations().length === 0));

async function boxes(page) {
  return page.$$eval('.arctic-block', (els) => els.map((e) => {
    const r = e.getBoundingClientRect();
    return { x: r.left, y: r.top + scrollY, w: r.width, h: r.height, col: [...e.parentElement.parentElement.children].indexOf(e.parentElement) };
  }));
}

for (const [width, columns] of WIDTHS) {
  test(`${width}px wide shows ${columns} columns, no overlaps, nothing broken`, async ({ page }) => {
    const problems = await open(page, width);
    await loadAll(page);
    await settle(page);
    await expect(page.locator('#main')).toHaveAttribute('data-columns', String(columns));
    expect(await page.locator('.arctic-column').count()).toBe(columns);

    const b = await boxes(page);
    expect(b).toHaveLength(16);
    for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) {
      const a = b[i], c = b[j];
      const overlap = a.x < c.x + c.w - 1 && c.x < a.x + a.w - 1 && a.y < c.y + c.h - 1 && c.y < a.y + a.h - 1;
      expect(overlap, `tiles ${i} and ${j} overlap`).toBe(false);
    }
    // every image really decoded (not a broken-image icon)
    const broken = await page.$$eval('.arctic-block img', (imgs) => imgs.filter((i) => !i.naturalWidth).map((i) => i.src));
    expect(broken).toEqual([]);
    expect(problems).toEqual([]);
  });
}

test('every tile sits in the column that was shortest when it was placed', async ({ page }) => {
  await open(page, 1280);
  await loadAll(page);
  await settle(page);
  // Independent check: replay the placement from the images' aspect ratios (height/width) in load order.
  const result = await page.evaluate(async () => {
    const order = (await (await fetch('/images.json')).json()).map((e) => e.src);
    // DOM order is column by column; placement order is images.json order.
    const tiles = [...document.querySelectorAll('.arctic-block')]
      .sort((a, b) => order.indexOf(a.querySelector('img').getAttribute('src')) - order.indexOf(b.querySelector('img').getAttribute('src')));
    const columns = [...document.querySelectorAll('.arctic-column')];
    const heights = columns.map(() => 0);
    const mismatches = [];
    tiles.forEach((tile, i) => {
      const expected = heights.indexOf(Math.min(...heights));       // shortest, lowest index on ties
      const actual = columns.indexOf(tile.parentElement);
      if (expected !== actual) mismatches.push({ tile: i, expected, actual });
      heights[actual] += Number(tile.dataset.ratio) + 0.025;
    });
    return { mismatches, count: tiles.length };
  });
  expect(result.count).toBe(16);
  expect(result.mismatches).toEqual([]);
  // and the visible outcome: columns end up close in height (round-robin left a 326px spread at this width)
  const heights = await page.$$eval('.arctic-column', (cols) => cols.map((c) => c.getBoundingClientRect().height));
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(150);
});

test('resizing re-flows to the new column count and keeps every image', async ({ page }) => {
  await open(page, 1280);
  await loadAll(page);
  await expect(page.locator('#main')).toHaveAttribute('data-columns', '5');
  await page.setViewportSize({ width: 800, height: 800 });
  await expect(page.locator('#main')).toHaveAttribute('data-columns', '3');
  expect(await page.locator('.arctic-block').count()).toBe(16);
  await page.setViewportSize({ width: 500, height: 800 });
  await expect(page.locator('#main')).toHaveAttribute('data-columns', '2');
  expect(await page.locator('.arctic-block').count()).toBe(16);
});

test('scrolling to the bottom loads more images until all 16 are shown', async ({ page }) => {
  await open(page, 500);
  const main = page.locator('#main');
  expect(Number(await main.getAttribute('data-loaded'))).toBeLessThan(16);
  await expect(async () => {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect(main).toHaveAttribute('data-loaded', '16', { timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  await expect(page.locator('.arctic-more')).toBeHidden();
  await expect(page.locator('.arctic-status')).toHaveText('Showing 16 of 16 images');
});

test('the Load more button works from the keyboard and focus is not lost at the end', async ({ page }) => {
  await open(page, 500);
  // Stop scroll loading from interfering: the button is the accessible fallback being tested.
  await page.evaluate(() => { document.querySelector('.arctic-sentinel').remove(); });
  const before = Number(await page.locator('#main').getAttribute('data-loaded'));
  await page.locator('.arctic-more').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toHaveAttribute('data-loaded', String(Math.min(before + 6, 16)));
  while (await page.locator('.arctic-more').isVisible()) await page.keyboard.press('Space');
  await expect(page.locator('#main')).toHaveAttribute('data-loaded', '16');
  const focused = await page.evaluate(() => document.activeElement?.className);
  expect(focused).toBe('arctic-status');
  await expect(page.locator('.arctic-status')).toHaveAttribute('role', 'status');
});

test('the module works standalone from a bare page (no demo, no globals)', async ({ page }) => {
  await page.goto('/index.html');
  const result = await page.evaluate(async () => {
    const { ArcticMasonry, columnCountFor } = await import('/arctic-masonry.js');
    const host = document.createElement('div');
    document.body.append(host);
    const m = new ArcticMasonry(host, { images: [{ src: '/images/' + 'x', width: 1, height: 1 }], batchSize: 5 });
    const out = { loaded: m.loadedCount, hasMore: m.hasMore, cols: columnCountFor(1300), globals: Object.keys(window).filter((k) => /arctic/i.test(k)) };
    m.destroy();
    out.cleaned = !host.classList.contains('arctic') && host.children.length === 0;
    return out;
  });
  expect(result).toEqual({ loaded: 1, hasMore: false, cols: 5, globals: [], cleaned: true });
});

test('a bad container is rejected with a clear error', async ({ page }) => {
  await page.goto('/');
  const msg = await page.evaluate(async () => {
    const { ArcticMasonry } = await import('/arctic-masonry.js');
    try { new ArcticMasonry(null, {}); } catch (e) { return e.message; }
  });
  expect(msg).toBe('ArcticMasonry needs a container element');
});
