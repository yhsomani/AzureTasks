export interface MockCalendarDay {
  date: string; // YYYY-MM-DD
  isWorkingDay: boolean;
  holidayName?: string;
}

export interface MockCalendarConfig {
  timezone: string;
  cycleAnchorDay: number; // 4 = Thursday
  workingDaysOfWeek: number[]; // [1, 2, 3, 4, 5] = Mon-Fri
  holidays: Record<string, string>; // '2026-10-16': 'Diwali'
}

export const SEED_CALENDAR_CONFIG: MockCalendarConfig = {
  timezone: 'Asia/Kolkata',
  cycleAnchorDay: 4, // Thursday
  workingDaysOfWeek: [1, 2, 3, 4, 5],
  holidays: {
    '2026-01-01': "New Year's Day",
    '2026-01-26': 'Republic Day',
    '2026-08-15': 'Independence Day',
    '2026-10-02': 'Gandhi Jayanti',
    '2026-10-20': 'Dussehra',
    '2026-11-09': 'Diwali',
    '2026-12-25': 'Christmas Day',
  },
};
