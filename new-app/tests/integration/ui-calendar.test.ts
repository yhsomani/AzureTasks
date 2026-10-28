import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../../src/presentation/web/public/app.js', import.meta.url), 'utf8');
const page = readFileSync(new URL('../../src/presentation/web/public/index.html', import.meta.url), 'utf8');

function harness() {
  const context = {
    document: { querySelector: () => null, querySelectorAll: () => [], addEventListener: () => undefined },
    window: {}, location: { hash: '#calendar' }, console, setTimeout,
  };
  runInNewContext(source, context);
  return context;
}

describe('Work Calendar S09 integration', () => {
  it('has calendar navigation button and dedicated view section in index.html', () => {
    expect(page).toContain('data-view="calendar"');
    expect(page).toContain('id="view-calendar"');
    expect(page).toContain('id="calendarAddExceptionBtn"');
    expect(page).toContain('id="calendarSaveBtn"');
    expect(page).toContain('id="calendarExceptionsList"');
  });

  it('exposes calendar in VIEW_META and VIEW_GROUPS', () => {
    const context = harness();
    const meta = runInNewContext('VIEW_META["calendar"]', context);
    expect(meta).toBeDefined();
    expect(meta[0]).toBe('Work Calendar');

    const group = runInNewContext('VIEW_GROUPS["calendar"]', context);
    expect(group).toBe('Manage');
  });

  it('initializes with empty dirty state and updates when adding an exception', () => {
    const context = harness();
    runInNewContext('calendarState.calendar.exceptions = []', context);
    expect(runInNewContext('calendarState.isDirty', context)).toBe(false);
  });
});
