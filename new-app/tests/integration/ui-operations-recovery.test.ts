import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const html = readFileSync(new URL('../../src/presentation/web/public/index.html', import.meta.url), 'utf8');
const js = readFileSync(new URL('../../src/presentation/web/public/app.js', import.meta.url), 'utf8');

describe('operations and recovery UI trust', () => {
  it('distinguishes audit empty, loading, and request failure', () => {
    expect(html).toContain('id="journalResultStatus"');
    const a = js.indexOf('async function refreshJournal()');
    const b = js.indexOf('/* ---------------------------------------------------------------- scheduler */', a);
    const journal = js.slice(a,b);
    expect(journal).toContain('No audit records');
    expect(journal).toContain('Unable to load audit records');
    expect(journal).toContain('role: \'status\'');
  });
  it('labels unattended creation and closure as remote side effects', () => {
    expect(html).toContain('id="schedulerSafetyNotice"');
    expect(html).toContain('id="eodSafetyNotice"');
    expect(html).toContain('remote Azure DevOps work items');
  });
  it('does not announce every log line as a screen-reader live region', () => {
    expect(html).not.toContain('id="logStream" aria-live="polite"');
    expect(html).toContain('id="logStatus"');
  });
  it('preserves operational actions', () => {
    for(const id of ['schedRunNowBtn','schedToggle','schedSaveConfigBtn','eodPreviewBtn','eodRunNowBtn','eodSaveConfigBtn','journalRepairBtn','exportCsv','exportJson']) expect(html).toContain(`id="${id}"`);
  });
});