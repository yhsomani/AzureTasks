import { describe, it, expect } from 'vitest';
import {
  formatFullTitle,
  formatTitleDate,
  getDaysInMonth,
  isLeapYear,
  parseDateFromTitle,
} from '../src/date/parser.js';

describe('Date Parser & Formatter', () => {
  it('correctly determines leap years', () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2028)).toBe(true);
    expect(isLeapYear(2000)).toBe(true);
    expect(isLeapYear(2025)).toBe(false);
    expect(isLeapYear(2026)).toBe(false);
    expect(isLeapYear(2100)).toBe(false);
  });

  it('correctly calculates days in months including February', () => {
    expect(getDaysInMonth(2024, 2)).toBe(29); // Leap year
    expect(getDaysInMonth(2025, 2)).toBe(28); // Non-leap year
    expect(getDaysInMonth(2026, 10)).toBe(31); // October
    expect(getDaysInMonth(2026, 4)).toBe(30); // April
  });

  it('formats dates as D MMM without leading zero', () => {
    expect(formatTitleDate('2026-10-03')).toBe('3 Oct');
    expect(formatTitleDate('2026-10-09')).toBe('9 Oct');
    expect(formatTitleDate('2026-10-15')).toBe('15 Oct');
    expect(formatTitleDate('2026-12-02')).toBe('2 Dec');
    expect(formatTitleDate('2027-01-07')).toBe('7 Jan');
  });

  it('formats full task title', () => {
    expect(formatFullTitle('3in1_PWA_MyAccount |', '2026-10-08')).toBe(
      '3in1_PWA_MyAccount | 8 Oct'
    );
    expect(formatFullTitle('3in1_PWA_MyAccount', '2026-10-15')).toBe(
      '3in1_PWA_MyAccount | 15 Oct'
    );
  });

  it('parses valid task titles correctly', () => {
    const res1 = parseDateFromTitle('3in1_PWA_MyAccount | 3 Oct', '2026-10-01');
    expect(res1).not.toBeNull();
    expect(res1?.day).toBe(3);
    expect(res1?.month).toBe(10);
    expect(res1?.year).toBe(2026);
    expect(res1?.isoDate).toBe('2026-10-03');
    expect(res1?.formattedTitleDate).toBe('3 Oct');

    const res2 = parseDateFromTitle('3in1_PWA_MyAccount | 15 Oct', '2026-10-01');
    expect(res2?.day).toBe(15);
    expect(res2?.month).toBe(10);
    expect(res2?.isoDate).toBe('2026-10-15');
  });

  it('handles case-insensitivity and extra whitespace', () => {
    const res = parseDateFromTitle('  3in1_PWA_MyAccount  |  6  OCT  ', '2026-10-01');
    expect(res).not.toBeNull();
    expect(res?.day).toBe(6);
    expect(res?.month).toBe(10);
    expect(res?.formattedTitleDate).toBe('6 Oct');
  });

  it('correctly handles December to January year rollover', () => {
    // Reference date is Jan 2027, but task is "31 Dec" -> belongs to 2026
    const resDec = parseDateFromTitle('3in1_PWA_MyAccount | 31 Dec', '2027-01-02');
    expect(resDec?.year).toBe(2026);
    expect(resDec?.isoDate).toBe('2026-12-31');

    // Reference date is Dec 2026, but task is "2 Jan" -> belongs to 2027
    const resJan = parseDateFromTitle('3in1_PWA_MyAccount | 2 Jan', '2026-12-30');
    expect(resJan?.year).toBe(2027);
    expect(resJan?.isoDate).toBe('2027-01-02');
  });

  it('validates leap year date for February 29', () => {
    // 2024 is leap year
    const leapRes = parseDateFromTitle('3in1_PWA_MyAccount | 29 Feb', '2024-02-15');
    expect(leapRes).not.toBeNull();
    expect(leapRes?.isoDate).toBe('2024-02-29');

    // 2025 is NOT leap year
    const nonLeapRes = parseDateFromTitle('3in1_PWA_MyAccount | 29 Feb', '2025-02-15');
    expect(nonLeapRes).toBeNull();
  });

  it('rejects invalid titles and invalid dates', () => {
    expect(parseDateFromTitle('Other Task | 3 Oct')).toBeNull();
    expect(parseDateFromTitle('3in1_PWA_MyAccount | 32 Oct')).toBeNull();
    expect(parseDateFromTitle('3in1_PWA_MyAccount | 31 Apr')).toBeNull(); // April only has 30 days
    expect(parseDateFromTitle('3in1_PWA_MyAccount | 0 Oct')).toBeNull();
    expect(parseDateFromTitle('Just some text')).toBeNull();
  });
});
