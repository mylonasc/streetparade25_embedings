const path = require('node:path');
const fs = require('node:fs');
const { test, expect, devices } = require('@playwright/test');

test.use({ browserName: 'chromium' });

const SHOT_ROOT = path.join(__dirname, 'screenshots');

const DEVICES = [
  { name: 'Pixel 7', slug: 'pixel-7' },
  { name: 'Pixel 10', slug: 'pixel-10' },
  { name: 'iPhone SE (3rd gen)', slug: 'iphone-se-3rd-gen' },
  { name: 'iPhone 13', slug: 'iphone-13' },
  { name: 'iPhone 16', slug: 'iphone-16' },
];

// Containers whose direct children are laid out in a row/grid and must not overlap.
const OVERLAP_GROUPS = [
  '.app-bar',
  '.map-search',
  '.search-input-row',
  '.cluster-select-row',
  '.search-results',
  '.map-toolbar',
  '.selection-actions',
  '.selection-history',
  '.selection-panel-header',
  '.side-tabs',
  '.evaluation-toggle',
  '.modal-actions',
  '.gate-card',
  '.training-options',
  '.artist-favorite-actions',
  '.playlist',
  '.tooltip-actions',
];

function shotPath(slug, stage) {
  const dir = path.join(SHOT_ROOT, slug);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${stage}.png`);
}

async function snapshot(page, slug, stage) {
  await page.screenshot({ path: shotPath(slug, stage) });
}

async function checkNoHorizontalOverflow(page, stage) {
  const sizes = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    inner: window.innerWidth,
  }));
  expect(sizes.doc, `${stage}: document scrollWidth (${sizes.doc}) must not exceed viewport (${sizes.inner})`).toBeLessThanOrEqual(sizes.inner);
  expect(sizes.body, `${stage}: body scrollWidth (${sizes.body}) must not exceed viewport (${sizes.inner})`).toBeLessThanOrEqual(sizes.inner);
}

async function checkNoClippedText(page, stage) {
  const offenders = await page.evaluate(() => {
    const out = [];
    for (const el of document.body.querySelectorAll('*')) {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      if (style.display === 'none' || style.visibility === 'hidden' || rect.width < 4 || rect.height < 4) continue;
      const tag = el.tagName.toLowerCase();
      if (tag === 'input' || tag === 'select' || tag === 'textarea' || tag === 'option' || tag === 'svg') continue;
      const hasDirectText = Array.from(el.childNodes).some((node) => node.nodeType === Node.TEXT_NODE && /\S/.test(node.textContent || ''));
      if (!hasDirectText) continue;
      if (style.whiteSpace === 'nowrap') continue;
      if (style.overflowX === 'auto' || style.overflowX === 'scroll') continue;
      if (el.scrollWidth > el.clientWidth + 1) {
        out.push({
          tag,
          cls: String(el.className || '').slice(0, 90),
          text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 70),
          client: el.clientWidth,
          scroll: el.scrollWidth,
        });
      }
    }
    return out;
  });
  expect(offenders, `${stage}: text must not overflow its box (see offender list)`).toEqual([]);
}

async function checkNoElementPastRightEdge(page, stage) {
  const offenders = await page.evaluate(() => {
    const inner = window.innerWidth;
    const out = [];
    for (const el of document.body.querySelectorAll('*')) {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      if (style.display === 'none' || style.visibility === 'hidden' || rect.width < 4 || rect.height < 4) continue;
      if (rect.right > inner + 2 || rect.left < -2) {
        out.push({
          tag: el.tagName.toLowerCase(),
          cls: String(el.className || '').slice(0, 90),
          text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          viewport: inner,
        });
      }
    }
    return out;
  });
  expect(offenders, `${stage}: no element may stick out past the right edge of the viewport (see offender list)`).toEqual([]);
}

async function checkNoGroupOverlap(page, stage) {
  const offenders = await page.evaluate((selectors) => {
    const intersect = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    const describe = (el) => ({ cls: String(el.className || el.tagName).slice(0, 60), text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 28) });
    const out = [];
    for (const selector of selectors) {
      const container = document.querySelector(selector);
      if (!container) continue;
      const items = Array.from(container.children).filter((child) => {
        const style = getComputedStyle(child);
        const rect = child.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      });
      for (let i = 0; i < items.length; i += 1) {
        for (let j = i + 1; j < items.length; j += 1) {
          const a = items[i].getBoundingClientRect();
          const b = items[j].getBoundingClientRect();
          const area = intersect(a, b);
          if (area > 4) {
            out.push({ container: selector, a: describe(items[i]), b: describe(items[j]), area: Math.round(area) });
          }
        }
      }
    }
    return out;
  }, OVERLAP_GROUPS);
  expect(offenders, `${stage}: sibling elements must not overlap (see offender list)`).toEqual([]);
}

async function runChecks(page, slug, stage) {
  await snapshot(page, slug, stage);
  await checkNoHorizontalOverflow(page, stage);
  await checkNoClippedText(page, stage);
  await checkNoElementPastRightEdge(page, stage);
  await checkNoGroupOverlap(page, stage);
}

async function enterVisualizer(page) {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByPlaceholder('e.g. nina-zurich')).toBeVisible();
}

async function resolveSearchTerm(visualizationResponse) {
  const response = await visualizationResponse;
  const points = (await response.json()).points || [];
  expect(points.length, 'the visualization must expose points to search').toBeGreaterThan(0);
  const term = String(points[0].label || points[0].id || '')
    .split(/[-\s]+/)
    .find((part) => /^[a-z0-9]{4,}$/i.test(part));
  expect(term, 'a searchable token must be derivable from a point label').toBeTruthy();
  return term;
}

for (const device of DEVICES) {
  test.describe(`visual quality - ${device.name}`, () => {
    const { defaultBrowserType, ...deviceOptions } = devices[device.name];
    test.use(deviceOptions);

    test('full flow stays inside the viewport with no text overflow or unintended overlap', async ({ page }) => {
      test.setTimeout(180_000);
      const { slug } = device;
      const username = `quality-${slug}`;

      const visualizationResponse = page.waitForResponse(
        (res) => res.url().includes('/visualization?') && res.request().method() === 'GET',
      );
      await enterVisualizer(page);
      await runChecks(page, slug, '01-username-gate');

      await page.getByPlaceholder('e.g. nina-zurich').fill(username);
      await page.getByRole('button', { name: 'Enter visualizer' }).click();
      const searchTerm = await resolveSearchTerm(visualizationResponse);

      await expect(page.locator('canvas.plot')).toBeVisible();
      await expect(page.locator('.cluster-select-row select')).toBeVisible();
      await runChecks(page, slug, '02-map');

      await page.getByPlaceholder('Search artists, tracks, URLs...').fill(searchTerm);
      await expect(page.locator('.search-results button').first()).toBeVisible();
      await runChecks(page, slug, '03-search');

      await page.locator('.search-results button').first().click();
      const sheet = page.locator('.selection-panel.has-selection');
      await expect(sheet).toBeVisible();
      await expect(sheet.locator('h3')).not.toBeEmpty();
      await runChecks(page, slug, '04-selection-sheet');

      await sheet.getByRole('button', { name: 'Minimize' }).click();
      await expect(sheet).toHaveClass(/is-minimized/);

      await page.locator('.side-tabs').getByRole('button', { name: 'Training' }).click();
      await expect(page.locator('.training-panel')).toBeVisible();
      await runChecks(page, slug, '05-training');

      await page.locator('.side-tabs').getByRole('button', { name: 'Artists' }).click();
      await expect(page.locator('.artist-favorites-panel')).toBeVisible();
      await runChecks(page, slug, '06-artists');

      await page.locator('.map-toolbar').getByRole('button', { name: 'Help' }).click();
      await expect(page.locator('.help-modal')).toBeVisible();
      await runChecks(page, slug, '07-help-modal');
      await page.getByRole('button', { name: 'Close' }).click();

      const activeSheet = page.locator('.selection-panel.has-selection');
      if (await activeSheet.isVisible()) {
        const minimizeButton = activeSheet.getByRole('button', { name: 'Minimize' });
        if (await minimizeButton.count()) {
          await minimizeButton.click();
          await expect(activeSheet).toHaveClass(/is-minimized/);
        }
      }

      await page.getByRole('button', { name: 'Configure and recompute' }).click();
      await expect(page.locator('.layout-modal')).toBeVisible();
      await runChecks(page, slug, '08-layout-modal');
    });
  });
}
