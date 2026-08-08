import {parseTimeRange} from './loveMobile';

export type ClockRange = {start: string; end: string};

export type MinuteRange = {start: number; end: number};

const TIME_PATTERN = /^(\d{1,2}):(\d{2})$/;

export function timeToMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const normalized = String(value).trim().replace('.', ':');
  const match = normalized.match(TIME_PATTERN);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function minutesToTime(minutes: number): string {
  const total = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const hours = Math.floor(total / 60);
  const minutesPart = total % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutesPart).padStart(2, '0')}`;
}

export function rangeInMinutes(range: ClockRange | null | undefined): MinuteRange | null {
  if (!range) return null;
  const start = timeToMinutes(range.start);
  let end = timeToMinutes(range.end);
  if (start === null || end === null) return null;
  if (end <= start) end += 1440;
  return {start, end};
}

export function truckRangeFromTime(time: string | null | undefined): MinuteRange | null {
  return rangeInMinutes(parseTimeRange(time));
}

export function eventRangeFromTrucks(trucks: Array<{time?: string | null}>): ClockRange | null {
  let minStart: number | null = null;
  let maxEnd: number | null = null;
  for (const truck of trucks) {
    const range = truckRangeFromTime(truck.time);
    if (!range) continue;
    if (minStart === null || range.start < minStart) minStart = range.start;
    if (maxEnd === null || range.end > maxEnd) maxEnd = range.end;
  }
  if (minStart === null || maxEnd === null) return null;
  return {start: minutesToTime(minStart), end: minutesToTime(maxEnd)};
}

export function likedSlotRange(slots: Array<{set_start?: string | null; set_end?: string | null}>): MinuteRange | null {
  let minStart: number | null = null;
  let maxEnd: number | null = null;
  for (const slot of slots) {
    const start = timeToMinutes(slot.set_start);
    let end = timeToMinutes(slot.set_end);
    if (start === null || end === null) continue;
    if (end <= start) end += 1440;
    if (minStart === null || start < minStart) minStart = start;
    if (maxEnd === null || end > maxEnd) maxEnd = end;
  }
  if (minStart === null || maxEnd === null) return null;
  return {start: minStart, end: maxEnd};
}

export function timePosition(event: MinuteRange, range: MinuteRange): {left: number; width: number} | null {
  const span = event.end - event.start;
  if (span <= 0) return null;
  const left = Math.max(0, Math.min(100, ((range.start - event.start) / span) * 100));
  const right = Math.max(0, Math.min(100, ((range.end - event.start) / span) * 100));
  return {left, width: Math.max(0, right - left)};
}

export function rangesOverlap(window: MinuteRange, range: MinuteRange): boolean {
  return window.start < range.end && range.start < window.end;
}

export function truckOverlapsWindow(time: string | null | undefined, window: MinuteRange): boolean {
  const range = truckRangeFromTime(time);
  if (!range) return true;
  return rangesOverlap(window, range);
}
