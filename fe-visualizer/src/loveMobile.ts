import type {LoveMobile} from './types';

export type TimeRange = {
  start: string;
  end: string;
};

const TIME_RANGE_PATTERN = /^(\d{1,2}[:.]\d{2})\s*(?:-|–|—)\s*(\d{1,2}[:.]\d{2})$/;

function normalizeTime(value: string): string {
  return value.replace('.', ':');
}

export function parseTimeRange(time: string | null | undefined): TimeRange | null {
  if (!time) return null;
  const match = time.trim().match(TIME_RANGE_PATTERN);
  if (!match) return null;
  return {start: normalizeTime(match[1]), end: normalizeTime(match[2])};
}

export function truckNumber(loveMobile: LoveMobile): string {
  const number = loveMobile.number ?? loveMobile.source_index;
  return number !== undefined && number !== null ? String(number) : '';
}

export function truckLabel(loveMobile: LoveMobile): string {
  const number = truckNumber(loveMobile);
  const range = parseTimeRange(loveMobile.time);
  if (range) return `#${number} ${range.start}–${range.end}`;
  return `#${number}`;
}

export function loveMobileTitle(loveMobile: LoveMobile): string {
  return loveMobile.name || loveMobile.title || `Love Mobile ${truckNumber(loveMobile)}`;
}
