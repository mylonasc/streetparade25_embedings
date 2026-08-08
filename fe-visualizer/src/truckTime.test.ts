import {describe, expect, it} from 'vitest';
import {
  eventRangeFromTrucks, likedSlotRange, minutesToTime, rangeInMinutes, rangesOverlap,
  timePosition, timeToMinutes, truckOverlapsWindow, truckRangeFromTime,
} from './truckTime';

describe('timeToMinutes', () => {
  it('parses colon-separated times', () => {
    expect(timeToMinutes('13:00')).toBe(780);
    expect(timeToMinutes('9:05')).toBe(545);
  });

  it('normalizes dots as separators', () => {
    expect(timeToMinutes('14.30')).toBe(870);
  });

  it('returns null for malformed or missing input', () => {
    expect(timeToMinutes(null)).toBeNull();
    expect(timeToMinutes('')).toBeNull();
    expect(timeToMinutes('25:00')).toBeNull();
    expect(timeToMinutes('13:75')).toBeNull();
    expect(timeToMinutes('lunch')).toBeNull();
  });
});

describe('minutesToTime', () => {
  it('formats minutes as HH:MM', () => {
    expect(minutesToTime(0)).toBe('00:00');
    expect(minutesToTime(780)).toBe('13:00');
    expect(minutesToTime(840)).toBe('14:00');
    expect(minutesToTime(1439)).toBe('23:59');
  });

  it('wraps values beyond midnight into the same day', () => {
    expect(minutesToTime(1500)).toBe('01:00');
    expect(minutesToTime(-30)).toBe('23:30');
  });
});

describe('rangeInMinutes', () => {
  it('converts a clock range into minutes', () => {
    expect(rangeInMinutes({start: '13:00', end: '18:00'})).toEqual({start: 780, end: 1080});
  });

  it('treats a crossing-midnight range as ending next day', () => {
    expect(rangeInMinutes({start: '22:00', end: '02:00'})).toEqual({start: 1320, end: 1560});
  });

  it('returns null when the range is incomplete', () => {
    expect(rangeInMinutes(null)).toBeNull();
    expect(rangeInMinutes({start: 'nope', end: '18:00'})).toBeNull();
  });
});

describe('truckRangeFromTime', () => {
  it('parses the truck time string into minutes', () => {
    expect(truckRangeFromTime('13:00 - 18:00')).toEqual({start: 780, end: 1080});
    expect(truckRangeFromTime('15:04–19:04')).toEqual({start: 904, end: 1144});
  });

  it('returns null when there is no time', () => {
    expect(truckRangeFromTime(null)).toBeNull();
    expect(truckRangeFromTime(undefined)).toBeNull();
    expect(truckRangeFromTime('no time')).toBeNull();
  });
});

describe('eventRangeFromTrucks', () => {
  it('derives the min start and max end across trucks', () => {
    expect(eventRangeFromTrucks([
      {time: '13:00 - 18:00'},
      {time: '15:00 - 21:30'},
      {time: '14:00 - 20:00'},
    ])).toEqual({start: '13:00', end: '21:30'});
  });

  it('ignores trucks without parseable times', () => {
    expect(eventRangeFromTrucks([
      {time: '13:00 - 18:00'},
      {time: null},
    ])).toEqual({start: '13:00', end: '18:00'});
  });

  it('returns null when no truck has a time', () => {
    expect(eventRangeFromTrucks([{time: null}, {time: undefined}])).toBeNull();
    expect(eventRangeFromTrucks([])).toBeNull();
  });
});

describe('likedSlotRange', () => {
  it('spans from the earliest set start to the latest set end', () => {
    expect(likedSlotRange([
      {set_start: '13:00', set_end: '14:15'},
      {set_start: '14:15', set_end: '15:30'},
    ])).toEqual({start: 780, end: 930});
  });

  it('ignores slots missing set times', () => {
    expect(likedSlotRange([
      {set_start: null, set_end: null},
      {set_start: '15:04', set_end: '15:38'},
    ])).toEqual({start: 904, end: 938});
  });

  it('returns null when no slot has set times', () => {
    expect(likedSlotRange([])).toBeNull();
    expect(likedSlotRange([{set_start: null, set_end: null}])).toBeNull();
  });
});

describe('timePosition', () => {
  it('computes the percentage placement of a range inside the event', () => {
    const event = {start: 780, end: 1260};
    expect(timePosition(event, {start: 900, end: 1080})).toEqual({left: 25, width: 37.5});
  });

  it('clamps ranges outside the event to the track edges', () => {
    const event = {start: 780, end: 1260};
    expect(timePosition(event, {start: 600, end: 1320})).toEqual({left: 0, width: 100});
  });

  it('returns null when the event span is empty', () => {
    expect(timePosition({start: 780, end: 780}, {start: 800, end: 900})).toBeNull();
  });
});

describe('rangesOverlap', () => {
  it('detects overlapping and non-overlapping windows', () => {
    expect(rangesOverlap({start: 780, end: 900}, {start: 800, end: 1000})).toBe(true);
    expect(rangesOverlap({start: 780, end: 900}, {start: 900, end: 1000})).toBe(false);
    expect(rangesOverlap({start: 780, end: 900}, {start: 700, end: 780})).toBe(false);
  });
});

describe('truckOverlapsWindow', () => {
  it('keeps trucks whose time overlaps the window', () => {
    expect(truckOverlapsWindow('13:00 - 18:00', {start: 900, end: 1080})).toBe(true);
  });

  it('drops trucks whose time is entirely outside the window', () => {
    expect(truckOverlapsWindow('13:00 - 14:00', {start: 1080, end: 1260})).toBe(false);
  });

  it('keeps trucks without a parseable time so they stay visible', () => {
    expect(truckOverlapsWindow(null, {start: 1080, end: 1260})).toBe(true);
    expect(truckOverlapsWindow('', {start: 1080, end: 1260})).toBe(true);
  });
});
