const path = require('node:path');
const fs = require('node:fs');
const { expect } = require('@playwright/test');

const SHOT_ROOT = path.join(__dirname, 'screenshots');

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
  checkNoHorizontalOverflow,
  checkNoClippedText,
  checkNoElementPastRightEdge,
  checkNoGroupOverlap,
  checkRangeInputsContained,
};
