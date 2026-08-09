export type ThemePalette = {
  accent: string;
  warm: string;
  predicted: string;
  predictedUp: string;
  predictedDown: string;
  text: string;
  muted: string;
};

let cached: ThemePalette | null = null;

function readVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function resolveTheme(): ThemePalette {
  if (cached) return cached;
  cached = {
    accent: readVar('--accent'),
    warm: readVar('--warm'),
    predicted: readVar('--predicted'),
    predictedUp: readVar('--predicted-up'),
    predictedDown: readVar('--predicted-down'),
    text: readVar('--text'),
    muted: readVar('--muted'),
  };
  return cached;
}

function hexToRgb(color: string): [number, number, number] {
  const normalized = color.trim().replace(/^#/, '');
  if (normalized.length === 3) {
    const [r, g, b] = normalized;
    return [parseInt(r + r, 16), parseInt(g + g, 16), parseInt(b + b, 16)];
  }
  const value = parseInt(normalized, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export function withAlpha(color: string, alpha: number): string {
  const [r, g, b] = hexToRgb(color);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
