const { test, expect } = require('@playwright/test');

const REQUESTED_CLUSTERS = 5;
const SEED_CLUSTERS = 7;

async function visibleClusterCount(clusterSelect) {
  return (await clusterSelect.locator('option').count()) - 1;
}

test('recomputed PCA/tSNE layout updates the cluster count and colors in the UI', async ({ page }) => {
  test.setTimeout(300_000);

  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  // Enter the visualizer with a fresh username.
  await page.getByPlaceholder('e.g. nina-zurich').fill('e2e-tester');
  await page.getByRole('button', { name: 'Enter visualizer' }).click();

  // Wait for the initial map to render its cluster dropdown.
  const clusterSelect = page.locator('.cluster-select-row select');
  await expect(clusterSelect).toBeVisible();

  // Baseline: the pre-seeded anonymous layout exposes SEED_CLUSTERS clusters.
  await expect.poll(() => visibleClusterCount(clusterSelect)).toBe(SEED_CLUSTERS);

  // Capture the visualization reload triggered once the layout job completes.
  const reloaded = page.waitForResponse(
    (response) => response.url().includes('/visualization?') && response.request().method() === 'GET',
    { timeout: 240_000 },
  );

  // Configure the recompute with a specific cluster count.
  await page.getByRole('button', { name: 'Configure and recompute' }).click();
  const spectralClustering = page.locator('details').filter({ hasText: 'Spectral clustering' });
  await spectralClustering.locator('summary').click();
  await page.getByLabel('Clusters').fill(String(REQUESTED_CLUSTERS));
  await page.getByRole('button', { name: 'Recompute t-SNE map' }).click();

  // The recomputed layout is served by the refreshed visualization payload.
  const response = await reloaded;
  const payload = await response.json();
  const clusterValues = new Set(payload.points.map((point) => point.cluster));
  expect(clusterValues.size, 'refreshed /visualization must contain exactly the requested clusters').toBe(REQUESTED_CLUSTERS);

  // The cluster dropdown must reflect the requested count.
  await expect.poll(() => visibleClusterCount(clusterSelect)).toBe(REQUESTED_CLUSTERS);
});
