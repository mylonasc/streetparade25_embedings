const { test, expect, devices } = require('@playwright/test');
const { runChecks } = require('./quality-checks.cjs');

test.use({ browserName: 'chromium' });

const DEVICES = [
  { name: 'Pixel 7', slug: 'pixel-7' },
  { name: 'Pixel 10', slug: 'pixel-10' },
  { name: 'iPhone SE (3rd gen)', slug: 'iphone-se-3rd-gen' },
  { name: 'iPhone 13', slug: 'iphone-13' },
  { name: 'iPhone 16', slug: 'iphone-16' },
];

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

async function timeRangeBounds(page, container) {
  return page.locator(`${container} .time-range-input`).first().evaluate((el) => ({
    min: Number(el.min || 0),
    max: Number(el.max || 100),
    step: Number(el.step || 1),
  }));
}

// Range inputs report "Malformed value" unless (value - min) is a whole
// multiple of step, and the min/max differ per run (they follow the trucks'
// event window). Snap requested fractions to the slider's own grid.
async function setTimeRange(page, container, fromFraction, untilFraction) {
  const { min, max, step } = await timeRangeBounds(page, container);
  const snap = (fraction) => min + Math.floor(((max - min) * fraction) / step) * step;
  await page.locator(`${container} .time-range-from`).fill(String(snap(fromFraction)));
  await page.locator(`${container} .time-range-until`).fill(String(snap(untilFraction)));
}

async function resetTimeRange(page, container) {
  await setTimeRange(page, container, 0, 1);
}

for (const device of DEVICES) {
  test.describe(`visual quality - ${device.name}`, () => {
    const { defaultBrowserType, ...deviceOptions } = devices[device.name];
    test.use(deviceOptions);

    test('full flow stays inside the viewport with no text overflow or unintended overlap', async ({ page, browser }) => {
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

      await page.locator('.app-bar').getByRole('button', { name: 'Share' }).click();
      await expect(page.locator('.share-menu-dropdown')).toBeVisible();
      await runChecks(page, slug, '02b-share-menu');
      await page.getByRole('menuitem', { name: 'Copy link' }).click();
      await page.keyboard.press('Escape');
      await expect(page.locator('.share-menu-dropdown')).toBeHidden();

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

      await page.locator('.artist-favorites-panel select').selectOption('likely');
      await expect(page.locator('.artist-favorites-empty')).toBeVisible();
      await runChecks(page, slug, '06b-likely-empty');

      await page.locator('.artist-favorites-panel').getByRole('button', { name: 'Show loved trucks' }).click();
      await expect(page.locator('.liked-trucks-modal')).toBeVisible();
      await expect(page.locator('.liked-trucks-modal .share-score-filter input')).toBeVisible();
      await expect(page.locator('.liked-trucks-modal .time-range-input').first()).toBeVisible();
      await runChecks(page, slug, '06c-loved-trucks-modal');

      await setTimeRange(page, '.liked-trucks-modal', 0.3, 0.7);
      await runChecks(page, slug, '06c2-loved-trucks-sliders');
      await resetTimeRange(page, '.liked-trucks-modal');

      await page.locator('.liked-trucks-modal').getByRole('button', { name: 'Share' }).click();
      await expect(page.locator('.liked-trucks-modal .share-menu-dropdown')).toBeVisible();
      await expect(page.locator('.liked-trucks-modal').getByRole('menuitem', { name: 'Copy link' })).toBeEnabled();
      await runChecks(page, slug, '06d-trucks-share-menu');
      const telegramHref = await page.getByRole('menuitem', { name: 'Telegram' }).getAttribute('href');
      const sharedUrl = new URL(telegramHref).searchParams.get('url');
      expect(sharedUrl).toMatch(/\?share=/);
      await page.keyboard.press('Escape');
      await page.locator('.liked-trucks-modal').getByRole('button', { name: 'Close' }).click();
      await expect(page.locator('.liked-trucks-modal')).toBeHidden();

      const sharedContext = await browser.newContext();
      const sharedPage = await sharedContext.newPage();
      await sharedPage.goto(sharedUrl);
      await expect(sharedPage.locator('.share-page')).toBeVisible();
      await expect(sharedPage.locator('.share-page h1')).not.toBeEmpty();
      expect(await sharedPage.locator('.share-page').textContent()).toContain(username);
      await expect(sharedPage.locator('.share-page .share-score-filter input')).toBeVisible();
      await expect(sharedPage.locator('.share-page .time-range-input').first()).toBeVisible();
      await runChecks(sharedPage, slug, '06e-shared-page');

      await setTimeRange(sharedPage, '.share-page', 0.3, 0.7);
      await runChecks(sharedPage, slug, '06e2-shared-sliders');
      await resetTimeRange(sharedPage, '.share-page');
      await sharedPage.locator('.share-page').getByRole('button', { name: 'Explore the map' }).click();
      await expect(sharedPage.locator('canvas.plot')).toBeVisible();
      await runChecks(sharedPage, slug, '06f-shared-page-entered');
      await sharedContext.close();

      await page.locator('.artist-favorites-panel select').selectOption('all');
      const truckChip = page.locator('.love-mobile-chip').first();
      if (await truckChip.count()) {
        await truckChip.click();
        await expect(page.locator('.love-mobile-modal')).toBeVisible();
        await runChecks(page, slug, '07-love-mobile-modal');
        await page.getByRole('button', { name: 'Close' }).click();
      }

      await page.locator('.map-toolbar').getByRole('button', { name: 'Help' }).click();
      await expect(page.locator('.help-modal')).toBeVisible();
      await runChecks(page, slug, '08-help-modal');
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
      await runChecks(page, slug, '09-layout-modal');
    });
  });
}
