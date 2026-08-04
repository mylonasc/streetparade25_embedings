export const USERNAME_KEY = 'streetparade.visualizer.username';
export const MARKS_KEY = 'streetparade.visualizer.marked';

export function safeGetItem(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeSetItem(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be blocked or full; the app keeps working in-memory.
  }
}

export function readMarks() {
  try {
    return new Set(JSON.parse(safeGetItem(MARKS_KEY) || '[]'));
  } catch {
    return new Set();
  }
}
