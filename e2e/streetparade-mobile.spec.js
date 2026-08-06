const { test, expect, devices } = require('@playwright/test');

test.use({ ...devices['iPhone 13'], browserName: 'chromium' });

async function enterVisualizer(page) {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByPlaceholder('e.g. nina-zurich').fill('mobile-tester');
  await page.getByRole('button', { name: 'Enter visualizer' }).click();
  await expect(page.locator('.cluster-select-row select')).toBeVisible();
  await expect(page.locator('canvas.plot')).toBeVisible();
}

test('mobile layout keeps the page inside the viewport', async ({ page }) => {
  test.setTimeout(300_000);
  await enterVisualizer(page);

  const overflow = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(overflow.documentWidth, `document scrollWidth (${overflow.documentWidth}) must not exceed viewport (${overflow.innerWidth})`).toBeLessThanOrEqual(overflow.innerWidth);
  expect(overflow.bodyWidth, `body scrollWidth (${overflow.bodyWidth}) must not exceed viewport (${overflow.innerWidth})`).toBeLessThanOrEqual(overflow.innerWidth);
});

test('map toolbar targets are at least 44x44px on a coarse pointer', async ({ page }) => {
  test.setTimeout(300_000);
  await enterVisualizer(page);

  const buttons = page.locator('.map-toolbar button');
  expect(await buttons.count(), 'the map toolbar must expose buttons').toBeGreaterThan(0);
  const sizes = await buttons.evaluateAll((els) =>
    els.map((el) => {
      const rect = el.getBoundingClientRect();
      return { label: el.getAttribute('aria-label') || el.textContent?.trim() || '?', width: rect.width, height: rect.height };
    }),
  );
  for (const { label, width, height } of sizes) {
    expect(width, `toolbar button "${label}" width ${width}px`).toBeGreaterThanOrEqual(44);
    expect(height, `toolbar button "${label}" height ${height}px`).toBeGreaterThanOrEqual(44);
  }
});

test('hover tooltip stays hidden on a touch device', async ({ page }) => {
  test.setTimeout(300_000);
  await enterVisualizer(page);

  await page.locator('canvas.plot').hover();
  await page.waitForTimeout(600);
  await expect(page.locator('.tooltip')).toBeHidden();
});

test('tapping a search result opens the selection sheet on mobile', async ({ page }) => {
  test.setTimeout(300_000);

  const visualizationResponse = page.waitForResponse(
    (response) => response.url().includes('/visualization?') && response.request().method() === 'GET',
  );
  await enterVisualizer(page);
  const visualization = await visualizationResponse;
  const points = (await visualization.json()).points || [];
  expect(points.length, 'the visualization must expose points to search').toBeGreaterThan(0);

  const searchTerm = String(points[0].label || points[0].id || '')
    .split(/[-\s]+/)
    .find((part) => /^[a-z0-9]{4,}$/i.test(part));
  expect(searchTerm, 'a searchable token must be derivable from a point label').toBeTruthy();

  await page.getByPlaceholder('Search artists, tracks, URLs...').fill(searchTerm);
  await expect(page.locator('.search-results button').first()).toBeVisible();
  await page.locator('.search-results button').first().click();

  const sheet = page.locator('.selection-panel.has-selection');
  await expect(sheet).toBeVisible();
  await expect(sheet).not.toHaveClass(/is-minimized/);
  await expect(sheet.locator('h3')).not.toBeEmpty();
});
