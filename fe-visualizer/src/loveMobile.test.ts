import {describe, expect, it} from 'vitest';
import {artistSetLabel, artistSetRange, loveMobileTitle, parseTimeRange, truckLabel, truckNumber} from './loveMobile';
import type {LoveMobile} from './types';

describe('parseTimeRange', () => {
  it('parses a "start - end" range', () => {
    expect(parseTimeRange('13:00 - 18:00')).toEqual({start: '13:00', end: '18:00'});
    expect(parseTimeRange('14:08 - 18:08')).toEqual({start: '14:08', end: '18:08'});
  });

  it('accepts hyphen variants and dot separators', () => {
    expect(parseTimeRange('13.00 – 18.00')).toEqual({start: '13:00', end: '18:00'});
    expect(parseTimeRange('22:00 — 02:00')).toEqual({start: '22:00', end: '02:00'});
  });

  it('returns null for missing or malformed values', () => {
    expect(parseTimeRange(null)).toBeNull();
    expect(parseTimeRange(undefined)).toBeNull();
    expect(parseTimeRange('13:00')).toBeNull();
    expect(parseTimeRange('all day')).toBeNull();
    expect(parseTimeRange('')).toBeNull();
  });
});

describe('truckNumber', () => {
  it('prefers number over source_index', () => {
    expect(truckNumber({number: 5, source_index: 2} as LoveMobile)).toBe('5');
  });

  it('falls back to source_index', () => {
    expect(truckNumber({source_index: 3} as LoveMobile)).toBe('3');
  });

  it('returns an empty string when unavailable', () => {
    expect(truckNumber({} as LoveMobile)).toBe('');
  });
});

describe('truckLabel', () => {
  it('combines number and time range', () => {
    expect(truckLabel({number: 1, time: '13:00 - 18:00'} as LoveMobile)).toBe('#1 13:00–18:00');
  });

  it('omits the range when unparseable', () => {
    expect(truckLabel({number: 2} as LoveMobile)).toBe('#2');
  });
});

describe('loveMobileTitle', () => {
  it('prefers name, then title, then a fallback', () => {
    expect(loveMobileTitle({name: 'Drumcode x Friends', number: 1} as LoveMobile)).toBe('Drumcode x Friends');
    expect(loveMobileTitle({title: '1. Drumcode', number: 1} as LoveMobile)).toBe('1. Drumcode');
    expect(loveMobileTitle({number: 1} as LoveMobile)).toBe('Love Mobile 1');
  });
});

describe('artistSetRange', () => {
  it('reads the artist set slot from set_start/set_end', () => {
    expect(artistSetRange({set_start: '13:00', set_end: '14:15'} as LoveMobile)).toEqual({start: '13:00', end: '14:15'});
  });

  it('normalizes dot separators', () => {
    expect(artistSetRange({set_start: '13.00', set_end: '15.30'} as LoveMobile)).toEqual({start: '13:00', end: '15:30'});
  });

  it('returns null when the slot is missing', () => {
    expect(artistSetRange({} as LoveMobile)).toBeNull();
    expect(artistSetRange({set_start: '13:00'} as LoveMobile)).toBeNull();
    expect(artistSetRange({time: '13:00 - 18:00'} as LoveMobile)).toBeNull();
  });
});

describe('artistSetLabel', () => {
  it('formats the slot with an en dash', () => {
    expect(artistSetLabel({set_start: '13:00', set_end: '14:15'} as LoveMobile)).toBe('13:00–14:15');
  });

  it('returns null without a slot', () => {
    expect(artistSetLabel({time: '13:00 - 18:00'} as LoveMobile)).toBeNull();
  });
});
