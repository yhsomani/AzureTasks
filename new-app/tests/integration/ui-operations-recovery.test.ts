import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { runInNewContext } from 'node:vm';

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
  it('uses explicit confirmation for Explorer single-cell creation and closes the modal only after success', () => {
    const start = js.indexOf('async function createSingleCellTask(');
    const end = js.indexOf('/* ------------------------------------------------------------- inspect modals */', start);
    const create = js.slice(start, end);
    expect(create).toContain('window.confirm(');
    expect(create).toContain('confirm: true');
    expect(create).toContain("api.post('/tasks/adhoc'");
    expect(create).toContain('pendingExplorerCreation');
    expect(create).toContain('return false');
    expect(js).toContain("if (await createSingleCellTask(person.key, cell.dateIso, person.name, cell.formattedDate))");
    expect(js).toContain("t.isEligibleForCreation === true");
  });

  it('requires confirmation and a real work-item ID before announcing Explorer creation', async () => {
    const ctx = {
      document: { querySelector: () => null, querySelectorAll: () => [], addEventListener: () => {} },
      location: { hash: '#explorer' }, window: { confirm: () => false }, console, setTimeout,
    };
    runInNewContext(js, ctx);
    const result = await runInNewContext(`(async () => {
      const calls = [];
      toast = (message, status) => calls.push({ message, status });
      let writes = 0;
      api.post = async (path, body) => {
        writes++;
        calls.push({ path, body });
        return { task: { id: 901 } };
      };
      refreshExplorer = async () => {};
      runPlanPreview = async () => {};
      const cancelled = await createSingleCellTask('p1', '2026-11-02', 'Person', '2 Nov');
      const before = writes;
      window.confirm = () => true;
      const created = await createSingleCellTask('p1', '2026-11-02', 'Person', '2 Nov');
      const confirmedBody = calls.find(c => c.body)?.body;
      api.post = async () => { throw new Error('Azure offline'); };
      const failed = await createSingleCellTask('p1', '2026-11-03', 'Person', '3 Nov');
      return { cancelled, before, created, confirmedBody, failed,
        announcedFailure: calls.some(c => c.status === 'err' && c.message.includes('Azure offline')) };
    })()`, ctx);
    expect(result.cancelled).toBe(false);
    expect(result.before).toBe(0);
    expect(result.created).toBe(true);
    expect(result.confirmedBody.confirm).toBe(true);
    expect(result.confirmedBody.personKey).toBe('p1');
    expect(result.failed).toBe(false);
    expect(result.announcedFailure).toBe(true);
  });

  it('never reports partial EOD closure as a complete success or enables execution after a failed preview', async () => {
    const ctx = {
      document: { querySelector: () => null, querySelectorAll: () => [], addEventListener: () => {} },
      location: { hash: '#scheduler' }, window: { confirm: () => true },
      console, setTimeout,
    };
    runInNewContext(js, ctx);
    const output = await runInNewContext(`(async () => {
      const messages = [];
      toast = (message, status) => messages.push({ message, status });
      showModal = () => {};
      refreshDashboard = () => {};
      api.post = async () => ({ totalFound: 2, totalClosed: 1, totalFailed: 1,
        totalAlreadyClosed: 0, results: [] });
      await triggerEodClosure(true);
      const readyAfterPartialPreview = state.eodPreviewReadyAt;
      state.eodPreviewReadyAt = Date.now();
      await triggerEodClosure(false);
      return { messages, readyAfterPartialPreview };
    })()`, ctx);
    expect(output.readyAfterPartialPreview).toBe(0);
    expect(output.messages.filter((m: any) => m.status === 'warn')).toHaveLength(2);
    expect(output.messages.some((m: any) => m.message.includes('Successfully closed'))).toBe(false);
  });

  it('refreshes saved configuration from the server instead of a stale GET cache', () => {
    for (const fn of ['async function saveSettings()', 'async function saveGhSettings()', 'async function savePat()']) {
      const start = js.indexOf(fn);
      const end = js.indexOf('\nasync function ', start + fn.length);
      const body = js.slice(start, end < 0 ? undefined : end);
      expect(body).toContain("api.invalidateCache('/config')");
    }
  });

  it('preserves operational actions and provides dedicated manual EOD close triggers', () => {
    for(const id of ['schedRunNowBtn','schedToggle','schedSaveConfigBtn','eodPreviewBtn','eodRunNowBtn','eodSaveConfigBtn','closeTodayTasksBtn','dashboardCloseTodayBtn','plannerCloseTodayBtn','journalRepairBtn','exportCsv','exportJson']) expect(html).toContain(`id="${id}"`);
  });
});