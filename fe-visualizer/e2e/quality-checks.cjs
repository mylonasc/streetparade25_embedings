const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { expect } = require('@playwright/test');

const SHOT_ROOT = path.join(__dirname, 'screenshots');

// Mirrors the seed command in playwright.config.js: the runtime database is
// copied fresh from the repository source and re-seeded. The layout spec can
// recompute an anonymous layout in between, which would otherwise shadow the
// seeded baseline for tests that run afterwards.
const E2E_REPO_ROOT = path.resolve(__dirname, '../..');
const E2E_PYTHON = path.join(E2E_REPO_ROOT, '.venv', 'bin', 'python');
const E2E_SEED_SCRIPT = path.join(__dirname, 'seed-layout.py');
const E2E_SOURCE_DB = path.join(E2E_REPO_ROOT, 'streetparade_embeddings.sqlite3');
const E2E_RUNTIME_DB = '/tmp/sp26-e2e.sqlite3';

function reseede2e() {
  execFileSync(E2E_PYTHON, [E2E_SEED_SCRIPT, E2E_SOURCE_DB, E2E_RUNTIME_DB], { stdio: 'inherit' });
}

// Containers whose direct children are laid out in a row/grid and must not overlap.
const OVERLAP_GROUPS = [
  '.app-bar',
  '.app-bar-actions',
  '.share-menu-dropdown',
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
  '.artist-favorite-header',
  '.artist-love-mobiles',
  '.artist-favorites-empty',
  '.modal-header-actions',
  '.liked-trucks-list',
  '.liked-truck-slots',
  '.truck-timeline-summary',
  '.truck-timeline-strip',
  '.share-sort',
  '.share-score-filter',
  '.time-range-wrap',
  '.shared-artists',
  '.share-player',
  '.playlist',
  '.truck-artist-row',
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

async function checkRangeInputsContained(page, stage) {
  const offenders = await page.evaluate(() => {
    const out = [];
    for (const wrap of document.querySelectorAll('.time-range-track-wrap')) {
      const w = wrap.getBoundingClientRect();
      for (const input of wrap.querySelectorAll('.time-range-input')) {
        const r = input.getBoundingClientRect();
        if (r.top < w.top - 1 || r.bottom > w.bottom + 1) {
          out.push({
            cls: input.className,
            inputTop: Math.round(r.top),
            wrapTop: Math.round(w.top),
            inputBottom: Math.round(r.bottom),
            wrapBottom: Math.round(w.bottom),
          });
        }
      }
    }
    return out;
  });
  expect(offenders, `${stage}: range inputs must fit inside their track wrap (no vertical overflow into the list below)`).toEqual([]);
}

async function checkTimeRangeFill(page, stage) {
  const offenders = await page.evaluate(() => {
    const out = [];
    for (const wrap of document.querySelectorAll('.time-range-track-wrap')) {
      const fill = wrap.querySelector('.time-range-track-fill');
      const from = wrap.querySelector('.time-range-from');
      const until = wrap.querySelector('.time-range-until');
      if (!fill || !from || !until) continue;
      const wrapRect = wrap.getBoundingClientRect();
      const fillRect = fill.getBoundingClientRect();
      const min = Number(from.min);
      const max = Number(from.max);
      const span = Math.max(1, max - min);
      const expectedLeft = wrapRect.left + ((Number(from.value) - min) / span) * wrapRect.width;
      const expectedRight = wrapRect.left + ((Number(until.value) - min) / span) * wrapRect.width;
      if (Math.abs(fillRect.left - expectedLeft) > 2 || Math.abs(fillRect.right - expectedRight) > 2) {
        out.push({
          fillLeft: Math.round(fillRect.left),
          expectedLeft: Math.round(expectedLeft),
          fillRight: Math.round(fillRect.right),
          expectedRight: Math.round(expectedRight),
        });
      }
    }
    return out;
  });
  expect(offenders, `${stage}: the accent fill must span exactly the band between the from and until thumbs`).toEqual([]);
}

async function checkSearchResultsFit(page, stage) {
  const LONG_LABEL_TOKEN = 'long-label-ellipsis';
  const input = page.locator('.search-input-row input');
  const original = await input.inputValue();
  await input.fill(LONG_LABEL_TOKEN);
  await expect(page.locator('.search-results button')).not.toHaveCount(0);
  const offenders = await page.evaluate(() => {
    const out = [];
    let ellipsized = 0;
    for (const button of document.querySelectorAll('.search-results button')) {
      const style = getComputedStyle(button);
      if (style.whiteSpace !== 'nowrap' || style.overflow !== 'hidden' || style.textOverflow !== 'ellipsis') {
        out.push({ issue: 'missing single-line ellipsis rules', text: (button.textContent || '').slice(0, 40) });
      }
      const rect = button.getBoundingClientRect();
      const parent = button.parentElement ? button.parentElement.getBoundingClientRect() : null;
      if (rect.right > window.innerWidth) out.push({ issue: 'button past viewport', right: Math.round(rect.right) });
      if (parent && rect.right > parent.right + 1) {
        out.push({ issue: 'button past results list', parentRight: Math.round(parent.right), right: Math.round(rect.right) });
      }
      if (button.scrollWidth > button.clientWidth) ellipsized += 1;
    }
    if (ellipsized === 0) out.push({ issue: 'no long label was actually ellipsized' });
    return out;
  });
  expect(offenders, `${stage}: search-result labels must be single-line ellipsized inside the map card`).toEqual([]);
  await input.fill(original);
  await expect(page.locator('.search-results button').first()).toBeVisible();
}

async function runChecks(page, slug, stage) {
  await snapshot(page, slug, stage);
  await checkNoHorizontalOverflow(page, stage);
  await checkNoClippedText(page, stage);
  await checkNoElementPastRightEdge(page, stage);
  await checkNoGroupOverlap(page, stage);
  await checkRangeInputsContained(page, stage);
}

module.exports = {
  OVERLAP_GROUPS,
  runChecks,
  reseede2e,
  checkNoHorizontalOverflow,
  checkNoClippedText,
  checkNoElementPastRightEdge,
  checkNoGroupOverlap,
  checkRangeInputsContained,
  checkTimeRangeFill,
  checkSearchResultsFit,
};
