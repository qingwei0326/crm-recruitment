import { describe, expect, it, vi } from 'vitest';
import {
  dateTimeAfterDays,
  defaultFollowUpDate,
  defaultMissedFollowUpDate,
  normalizeDateTimeLocal,
  toApiDateTime,
  toDateTimeLocalValue,
} from '../dateTime';

describe('date time helpers', () => {
  it('formats a local Date for datetime-local inputs', () => {
    expect(toDateTimeLocalValue(new Date(2026, 8, 2, 9, 5))).toBe('2026-09-02T09:05');
  });

  it('normalizes API date strings without changing their local wall time', () => {
    expect(normalizeDateTimeLocal('2026-09-02 09:05:41')).toBe('2026-09-02T09:05');
    expect(normalizeDateTimeLocal('')).toBe('');
  });

  it('adds API seconds only when the input does not already have them', () => {
    expect(toApiDateTime('2026-09-02T09:05')).toBe('2026-09-02T09:05:00');
    expect(toApiDateTime('2026-09-02T09:05:41')).toBe('2026-09-02T09:05:41');
    expect(toApiDateTime('')).toBe('');
  });

  it('builds stable follow-up defaults from the current local time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 2, 8, 0));

    expect(defaultFollowUpDate()).toBe('2026-09-03T09:00');
    expect(dateTimeAfterDays(2, 14, 30)).toBe('2026-09-04T14:30');
    expect(defaultMissedFollowUpDate()).toBe('2026-09-02T08:10');

    vi.useRealTimers();
  });
});
