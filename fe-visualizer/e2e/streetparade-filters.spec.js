const { test, expect } = require('@playwright/test');
const { checkTimeRangeFill } = require('./quality-checks.cjs');

// Fabricated shared payload used to exercise the shared favorites page without
// depending on the seeded DB having loved trucks or set times.
const SHARE_PAYLOAD = {
  username: 'share-tester',
  marked: [],
  eventStart: '13:00',
  eventEnd: '21:37',
  likedArtists: ['Alpha', 'Beta'],
  likedTrucks: [
    { number: '3', name: 'Truck Three', genres: 'Tech House', time: '15:00 - 18:00', artists: ['Alpha'], score: 0.8, soundcloudUrl: '', artistSlots: [{ name: 'Alpha', set_start: '15:00', set_end: '16:00' }] },
    { number: '9', name: 'Magic Mountain', genres: 'House', time: '13:00 - 18:00', artists: ['Alpha'], score: 0.9, soundcloudUrl: '', artistSlots: [{ name: 'Alpha', set_start: '13:00', set_end: '14:15' }] },
    { number: '21', name: 'Night Truck', genres: 'Techno', time: '19:00 - 21:37', artists: ['Beta'], score: 0.5, soundcloudUrl: '', artistSlots: [{ name: 'Beta', set_start: '19:30', set_end: '21:00' }] },
  ],
};

const VISUALIZATION_PAYLOAD = {
  signature: 'filters-spec-v1',
  features: { song_downloads_and_embeddings: false },
  points: [
    { id: 't1', kind: 'track', label: 'Alpha Song', x: 0, y: 0, cluster: 1, metadata: { artist_name: 'Alpha', track_id: 1 } },
    { id: 't2', kind: 'track', label: 'Beta One', x: 0, y: 0, cluster: 1, metadata: { artist_name: 'Beta', track_id: 2 } },
    { id: 't3', kind: 'track', label: 'Beta Two', x: 0, y: 0, cluster: 1, metadata: { artist_name: 'Beta', track_id: 3 } },
    {
      id: 'a1', kind: 'artist', label: 'Alpha', x: 0, y: 0, cluster: 1,
      metadata: {
        artist_name: 'Alpha',
        love_mobiles: [
          { uuid: 'lm-3', number: 3, name: 'Truck Three', time: '15:00 - 18:00', set_order: 1, set_start: '15:00', set_end: '16:00' },
          { uuid: 'lm-9', number: 9, name: 'Magic Mountain', time: '13:00 - 18:00', set_order: 2, set_start: '13:00', set_end: '14:15' },
        ],
      },
    },
    {
      id: 'a2', kind: 'artist', label: 'Beta', x: 0, y: 0, cluster: 1,
      metadata: {
        artist_name: 'Beta',
        love_mobiles: [
          { uuid: 'lm-21', number: 21, name: 'Night Truck', time: '19:00 - 21:37', set_order: 1, set_start: '19:30', set_end: '21:00' },
        ],
      },
    },
  ],
};

async function openSharedPage(page) {
  await page.route(/\/shares\/[a-z0-9]+/, (route) => route.fulfill({ json: { payload: SHARE_PAYLOAD } }));
  await page.goto('/?share=filterspec');
  await expect(page.locator('.share-page')).toBeVisible();
}

async function openLikedTrucksModal(page) {
  await page.route(/\/visualization\?/, (route) => route.fulfill({ json: VISUALIZATION_PAYLOAD }));
  await page.route(/\/users\/[^/]+\/preferences/, (route) => route.fulfill({ json: { preferences: { 'track:1': 'up', 'track:2': 'up' } } }));
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByPlaceholder('e.g. nina-zurich').fill('modal-tester');
  await page.getByRole('button', { name: 'Enter visualizer' }).click();
  await expect(page.locator('.cluster-select-row select')).toBeVisible();
  await page.locator('.side-tabs').getByRole('button', { name: 'Artists' }).click();
  await page.locator('.artist-favorites-panel').getByRole('button', { name: 'Show loved trucks' }).click();
  await expect(page.locator('.liked-trucks-modal')).toBeVisible();
}

test.describe('time and preference filters', () => {
  test('shared page time filter narrows the truck list', async ({ page }) => {
    await openSharedPage(page);
    await expect(page.locator('.liked-trucks-list li')).toHaveCount(3);

    await page.locator('.time-range-until').fill('900'); // until 15:00
    await expect(page.locator('.liked-trucks-list li')).toHaveCount(1);
    await expect(page.locator('.liked-trucks-list li').first()).toContainText('#9');
    await checkTimeRangeFill(page, 'shared-until-900');

    await page.locator('.time-range-from').fill('840'); // from 14:00
    await expect(page.locator('.liked-trucks-list li')).toHaveCount(1);
    await checkTimeRangeFill(page, 'shared-from-840');

    await page.locator('.time-range-until').fill('1290'); // back to full window
    await expect(page.locator('.liked-trucks-list li')).toHaveCount(3);
  });

  test('shared page preference filter narrows the truck list', async ({ page }) => {
    await openSharedPage(page);
    await page.locator('.share-score-filter input').fill('0.75');
    await expect(page.locator('.liked-trucks-list li')).toHaveCount(2);
    await expect(page.locator('.liked-truck-number').allTextContents()).resolves.toEqual(['#9', '#3']);
    await page.locator('.share-score-filter input').fill('0');
    await expect(page.locator('.liked-trucks-list li')).toHaveCount(3);
  });

  test('shared page timeline summary lists all trucks ordered by number', async ({ page }) => {
    await openSharedPage(page);
    await expect(page.locator('.truck-timeline-box')).toHaveCount(3);
    await expect(page.locator('.truck-timeline-number').allTextContents()).resolves.toEqual(['#3', '#9', '#21']);
  });

  test('shared page truck widgets share one width and show a set-time tooltip', async ({ page }) => {
    await openSharedPage(page);
    const widths = await page.locator('.liked-trucks-list .truck-time-widget').evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().width)));
    expect(new Set(widths).size, `all widget widths should match (got ${widths})`).toBe(1);

    await page.locator('.liked-trucks-list li', { hasText: '#3' }).locator('.truck-time-liked').hover();
    const tooltip = page.locator('.truck-time-tooltip');
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toHaveText('Alpha 15:00–16:00');
  });

  test('modal time filter narrows the truck list', async ({ page }) => {
    await openLikedTrucksModal(page);
    await expect(page.locator('.liked-trucks-list li')).toHaveCount(3);

    await page.locator('.liked-trucks-modal .time-range-until').fill('840'); // until 14:00
    await expect(page.locator('.liked-trucks-list li')).toHaveCount(1);
    await expect(page.locator('.liked-trucks-list li').first()).toContainText('#9');
    await checkTimeRangeFill(page, 'modal-until-840');
  });

  test('modal preference filter narrows the truck list', async ({ page }) => {
    await openLikedTrucksModal(page);
    await page.locator('.liked-trucks-modal input[aria-label="Minimum truck score"]').fill('0.75');
    await expect(page.locator('.liked-trucks-list li')).toHaveCount(2);
    await expect(page.locator('.liked-truck-number').allTextContents()).resolves.toEqual(['#3', '#9']);
  });

  test('modal truck widgets show a set-time tooltip', async ({ page }) => {
    await openLikedTrucksModal(page);
    await page.locator('.liked-trucks-modal .liked-trucks-list li', { hasText: '#3' }).locator('.truck-time-liked').hover();
    const tooltip = page.locator('.liked-trucks-modal .truck-time-tooltip');
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toHaveText('Alpha 15:00–16:00');
  });
});
