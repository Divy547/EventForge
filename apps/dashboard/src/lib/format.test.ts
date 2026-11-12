import {
  endOfDayIso,
  formatAgo,
  formatPercent,
  formatWindow,
  shortId,
  startOfDayIso,
} from './format';

describe('format', () => {
  it('formats a success rate without rounding up to 100%', () => {
    expect(formatPercent(0.9411)).toBe('94.1%');
    expect(formatPercent(0.9999)).toBe('99.9%');
    expect(formatPercent(1)).toBe('100.0%');
    expect(formatPercent(null)).toBe('–');
  });

  it('labels windows in hours or days', () => {
    expect(formatWindow(1)).toBe('1 h');
    expect(formatWindow(24)).toBe('1 d');
    expect(formatWindow(720)).toBe('30 d');
  });

  it('gives a coarse relative time', () => {
    const now = Date.parse('2026-11-12T12:00:00Z');
    expect(formatAgo('2026-11-12T11:59:40Z', now)).toBe('just now');
    expect(formatAgo('2026-11-12T11:55:00Z', now)).toBe('5 min ago');
    expect(formatAgo('2026-11-12T09:00:00Z', now)).toBe('3 h ago');
    expect(formatAgo('2026-11-10T12:00:00Z', now)).toBe('2 d ago');
  });
});

describe('event helpers', () => {
  it('shortens an ID to its first eight characters', () => {
    expect(shortId('11111111-aaaa-4bbb-8ccc-222222222222')).toBe('11111111');
  });

  it('turns a date input into the local day boundaries, and rejects bad input', () => {
    expect(startOfDayIso('2026-11-12')).toBe(new Date('2026-11-12T00:00:00.000').toISOString());
    expect(endOfDayIso('2026-11-12')).toBe(new Date('2026-11-12T23:59:59.999').toISOString());
    expect(startOfDayIso('')).toBeUndefined();
    expect(endOfDayIso('2026-13-45')).toBeUndefined();
    expect(startOfDayIso('12/11/2026')).toBeUndefined();
  });
});
