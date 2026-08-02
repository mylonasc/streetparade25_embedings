export const USERNAME_KEY = 'streetparade.visualizer.username';
export const MARKS_KEY = 'streetparade.visualizer.marked';

export function readMarks() {
  try {
    return new Set(JSON.parse(localStorage.getItem(MARKS_KEY) || '[]'));
  } catch {
    return new Set();
  }
}
