import {describe, expect, it} from 'vitest';
import {clamp, computeTooltipPosition} from './tooltipPosition';

describe('computeTooltipPosition', () => {
  const anchor = {left: 100, top: 100, width: 600, height: 400};

  it('places the tooltip to the right when it fits', () => {
    const {left, top} = computeTooltipPosition({
      anchor,
      container: {left: 0, top: 0, width: 800, height: 600},
      tooltipWidth: 200,
      tooltipHeight: 120,
      x: 20,
      y: 20,
    });
    expect(left).toBe(100 + 20 + 14);
    expect(top).toBe(100 + 20 + 14);
  });

  it('flips to the left when the tooltip would overflow the right edge', () => {
    const {left} = computeTooltipPosition({
      anchor,
      container: {left: 0, top: 0, width: 260, height: 600},
      tooltipWidth: 200,
      tooltipHeight: 120,
      x: 130,
      y: 20,
    });
    expect(left).toBe(100 + 130 - 200 - 14);
  });

  it('clamps within the container so it never leaves the screen', () => {
    const {left} = computeTooltipPosition({
      anchor: {left: 0, top: 0, width: 200, height: 200},
      container: {left: 0, top: 0, width: 200, height: 200},
      tooltipWidth: 240,
      tooltipHeight: 120,
      x: 10,
      y: 10,
    });
    expect(left).toBe(10);
  });

  it('flips above the anchor when the tooltip would overflow the bottom', () => {
    const {top} = computeTooltipPosition({
      anchor,
      container: {left: 0, top: 0, width: 800, height: 160},
      tooltipWidth: 200,
      tooltipHeight: 120,
      x: 20,
      y: 100,
    });
    expect(top).toBe(Math.max(10, 160 - 120 - 10));
  });

  it('clamps values', () => {
    expect(clamp(5, 10, 20)).toBe(10);
    expect(clamp(25, 10, 20)).toBe(20);
    expect(clamp(15, 10, 20)).toBe(15);
  });
});
