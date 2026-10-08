/**
 * Robust date parser and formatter for Azure DevOps task titles:
 * Pattern: "3in1_PWA_MyAccount | <D MMM>"
 */

import { ParsedDateInfo } from './types.js';

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
] as const;

const MONTH_MAP: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function getDaysInMonth(year: number, month: number): number {
  switch (month) {
    case 2:
      return isLeapYear(year) ? 29 : 28;
    case 4:
    case 6:
    case 9:
    case 11:
      return 30;
    default:
      return 31;
  }
}

/**
 * Formats a Date object or YYYY-MM-DD string into "D MMM" (e.g. "3 Oct", "15 Nov")
 */
export function formatTitleDate(date: Date | string): string {
  let d: Date;
  if (typeof date === 'string') {
    const [y, m, day] = date.split('-').map(Number);
    d = new Date(Date.UTC(y, m - 1, day));
  } else {
    d = date;
  }
  const day = d.getUTCDate();
  const monthIdx = d.getUTCMonth();
  return `${day} ${MONTH_NAMES[monthIdx]}`;
}

/**
 * Builds the full title for a date: "3in1_PWA_MyAccount | <D MMM>"
 */
export function formatFullTitle(titlePrefix: string, date: Date | string): string {
  const cleanPrefix = titlePrefix.endsWith('|') ? titlePrefix : `${titlePrefix} |`;
  return `${cleanPrefix} ${formatTitleDate(date)}`;
}

/**
 * Parses date from title string like "3in1_PWA_MyAccount | 8 Oct"
 * @param title The work item title
 * @param referenceDate Optional reference date (e.g. CreatedDate or current date) to resolve year
 */
export function parseDateFromTitle(
  title: string,
  referenceDate?: Date | string
): ParsedDateInfo | null {
  if (!title) return null;

  // Regex matches: "3in1_PWA_MyAccount | <D> <MMM>" with flexible whitespace
  const match = title.trim().match(/^3in1_PWA_MyAccount\s*\|\s*(\d{1,2})\s+([A-Za-z]{3,9})$/i);
  if (!match) {
    return null;
  }

  const dayStr = match[1];
  const monthStr = match[2].toLowerCase();

  const day = parseInt(dayStr, 10);
  const month = MONTH_MAP[monthStr];

  if (!month || isNaN(day) || day < 1 || day > 31) {
    return null;
  }

  // Determine reference year
  let refYear = new Date().getUTCFullYear();
  let refMonth = new Date().getUTCMonth() + 1;

  if (referenceDate) {
    const ref = typeof referenceDate === 'string' ? new Date(referenceDate) : referenceDate;
    if (!isNaN(ref.getTime())) {
      refYear = ref.getUTCFullYear();
      refMonth = ref.getUTCMonth() + 1;
    }
  }

  // Handle year transitions:
  // e.g. Reference date is January (month 1), but task date is December (month 12) -> task belongs to previous year
  // e.g. Reference date is December (month 12), but task date is January (month 1) -> task belongs to next year
  let resolvedYear = refYear;
  if (refMonth === 1 && month === 12) {
    resolvedYear = refYear - 1;
  } else if (refMonth === 12 && month === 1) {
    resolvedYear = refYear + 1;
  }

  // Validate days in that month & year
  const maxDays = getDaysInMonth(resolvedYear, month);
  if (day > maxDays) {
    return null;
  }

  const monthPadded = String(month).padStart(2, '0');
  const dayPadded = String(day).padStart(2, '0');
  const isoDate = `${resolvedYear}-${monthPadded}-${dayPadded}`;
  const dateObj = new Date(Date.UTC(resolvedYear, month - 1, day));
  const monthName = MONTH_NAMES[month - 1];
  const formattedTitleDate = `${day} ${monthName}`;
  const fullTitle = `3in1_PWA_MyAccount | ${formattedTitleDate}`;

  return {
    day,
    month,
    monthName,
    year: resolvedYear,
    isoDate,
    formattedTitleDate,
    fullTitle,
    dateObj,
  };
}
