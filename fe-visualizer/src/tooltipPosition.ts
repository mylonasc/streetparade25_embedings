export type Rect = {left: number; top: number; width: number; height: number};

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function computeTooltipPosition(options: {
  anchor: Rect;
  container: Rect;
  tooltipWidth: number;
  tooltipHeight: number;
  x: number;
  y: number;
  gap?: number;
  padding?: number;
}): {left: number; top: number} {
  const gap = options.gap ?? 14;
  const padding = options.padding ?? 10;
  const baseLeft = options.anchor.left - options.container.left + options.x;
  const baseTop = options.anchor.top - options.container.top + options.y;
  const containerWidth = options.container.width || window.innerWidth;
  const containerHeight = options.container.height || window.innerHeight;
  const opensLeft = baseLeft + gap + options.tooltipWidth > containerWidth - padding;
  const opensUp = baseTop + gap + options.tooltipHeight > containerHeight - padding;
  const left = clamp(opensLeft ? baseLeft - options.tooltipWidth - gap : baseLeft + gap, padding, Math.max(padding, containerWidth - options.tooltipWidth - padding));
  const top = clamp(opensUp ? baseTop - options.tooltipHeight - gap : baseTop + gap, padding, Math.max(padding, containerHeight - options.tooltipHeight - padding));
  return {left, top};
}
