// Browser-side security checks (Chromium and Firefox): the CSP is really enforced and the module never
// hands dangerous URLs to the page.
import { test, expect } from '@playwright/test';

test('the demo runs under the CSP with zero violations', async ({ page }) => {
  const violations = [];
  await page.addInitScript(() => {
    window.__violations = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__violations.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  const response = await page.goto('/');
  expect(response.headers()['content-security-policy']).toContain("script-src 'self'");
  await expect(page.locator('#main')).toHaveAttribute('data-loaded', /\d+/);
  violations.push(...(await page.evaluate(() => window.__violations)));
  expect(violations).toEqual([]);
});

test('an injected inline script is blocked by the CSP and never runs', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    window.__violations = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__violations.push(e.violatedDirective));
    const s = document.createElement('script');
    s.textContent = 'window.__pwned = true';
    document.body.append(s);
  });
  await expect.poll(() => page.evaluate(() => window.__violations.length)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
});

test('a remote image and remote script are blocked (no third-party origins)', async ({ page }) => {
  await page.goto('/');
  const blocked = await page.evaluate(() => new Promise((resolve) => {
    const seen = [];
    document.addEventListener('securitypolicyviolation', (e) => seen.push(e.violatedDirective.split(' ')[0].replace(/-elem$/, '')));
    const img = new Image(); img.src = 'https://example.invalid/x.png';
    const s = document.createElement('script'); s.src = 'https://example.invalid/x.js'; document.body.append(s);
    setTimeout(() => resolve(seen), 500);
  }));
  expect(blocked).toEqual(expect.arrayContaining(['img-src', 'script-src']));
});

test('the page cannot be framed (frame-ancestors / X-Frame-Options)', async ({ page, baseURL }) => {
  const res = await page.request.get('/');
  expect(res.headers()['x-frame-options']).toBe('DENY');
  expect(res.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  void baseURL;
});

test('the module refuses javascript:, data:text/html and file: image sources but still renders safe ones', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { ArcticMasonry, isSafeImageSrc } = await import('/arctic-masonry.js');
    const host = document.createElement('div');
    document.body.append(host);
    const images = [
      { src: 'javascript:window.__pwned=1', width: 1, height: 1 },
      { src: 'data:text/html,<script>window.__pwned=2</script>', width: 1, height: 1 },
      { src: 'file:///etc/passwd', width: 1, height: 1 },
      { src: 'images/' + (await (await fetch('/images.json')).json())[0].src.split('/').pop(), width: 500, height: 500 },
    ];
    new ArcticMasonry(host, { images, batchSize: 10 });
    const imgs = [...host.querySelectorAll('img')];
    return {
      srcs: imgs.map((i) => i.getAttribute('src')),
      errors: [...host.querySelectorAll('.arctic-block')].map((b) => b.classList.contains('is-error')),
      pwned: window.__pwned,
      unit: ['https://a.invalid/x.png', 'blob:https://a.invalid/1', 'data:image/png;base64,AAAA', '/x.png', 'x.png'].map(isSafeImageSrc),
      unitBad: ['javascript:1', 'data:text/html,x', 'file:///x', 'vbscript:x', 'data:image/svg+xml,<svg/>'].map(isSafeImageSrc),
    };
  });
  expect(result.srcs.slice(0, 3)).toEqual([null, null, null]);
  expect(result.errors.slice(0, 3)).toEqual([true, true, true]);
  expect(result.srcs[3]).toMatch(/^images\//);
  expect(result.pwned).toBeUndefined();
  expect(result.unit).toEqual([true, true, true, true, true]);
  expect(result.unitBad).toEqual([false, false, false, false, false]);
});

test('alt text and other metadata are inert text, never parsed as HTML', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { ArcticMasonry } = await import('/arctic-masonry.js');
    const host = document.createElement('div');
    document.body.append(host);
    const evil = '"><img src=x onerror="window.__pwned=3"><b>bold</b>';
    new ArcticMasonry(host, { images: [{ src: 'images/none.jpg', alt: evil, width: 1, height: 1 }] });
    const img = host.querySelector('img');
    await new Promise((r) => setTimeout(r, 300));
    return { alt: img.alt, injectedImgs: host.querySelectorAll('img').length, bold: host.querySelectorAll('b').length, pwned: window.__pwned };
  });
  expect(result.alt).toContain('onerror');           // kept verbatim as text
  expect(result.injectedImgs).toBe(1);               // no extra <img> was created from the alt text
  expect(result.bold).toBe(0);
  expect(result.pwned).toBeUndefined();
});
