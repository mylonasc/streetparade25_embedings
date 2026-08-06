export const USERNAME_KEY = 'streetparade.visualizer.username';
export const MARKS_KEY = 'streetparade.visualizer.marked';

export function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeSetItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be blocked or full; the app keeps working in-memory.
  }
}

export function readMarks(): Set<string> {
  try {
    return new Set(JSON.parse(safeGetItem(MARKS_KEY) || '[]') as string[]);
  } catch {
    return new Set();
  }
}
