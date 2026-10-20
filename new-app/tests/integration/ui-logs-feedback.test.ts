import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const base = new URL('../../src/presentation/web/public/', import.meta.url);
const html = readFileSync(new URL('index.html', base), 'utf8');
const js = readFileSync(new URL('app.js', base), 'utf8');
const css = readFileSync(new URL('styles.css', base), 'utf8');

describe('Web SPA Live Logs, Feedback & Toast Durability (Milestone 4)', () => {
  it('includes log toolbar with level select, search input, and clear button in HTML', () => {
    expect(html).toContain('id="logLevelFilter"');
    expect(html).toContain('id="logSearchInput"');
    expect(html).toContain('id="btnClearLogs"');
    expect(html).toContain('id="drawerLevelFilter"');
    expect(html).toContain('id="btnClearDrawerLogs"');
  });

  it('provides styles for toast messages and close button', () => {
    expect(css).toContain('.toast-close');
    expect(css).toContain('.toast-msg');
  });

  it('accurately explains recorded work hours preservation in EOD modal callout', () => {
    expect(html).toContain('Existing recorded Completed and Remaining work hours in Azure DevOps are preserved');
    expect(html).not.toContain('Completed work is set to 8h and Remaining work to 0h');
  });

  it('implements sticky scroll threshold check for log stream and drawer', () => {
    expect(js).toContain('term.scrollHeight - term.scrollTop - term.clientHeight < 40');
    expect(js).toContain('drawerBody.scrollHeight - drawerBody.scrollTop - drawerBody.clientHeight < 40');
  });

  it('implements logBuffer and renders filtered log entries based on level and search query', () => {
    expect(js).toContain('function renderLogStream()');
    expect(js).toContain('function renderDrawerLogs()');
    expect(js).toContain('logBuffer.entries.filter');
  });

  it('extends toast duration for errors to 8000ms with interactive close dismiss button', () => {
    expect(js).toContain("type === 'err' ? 8000 : 4000");
    expect(js).toContain("closeBtn.className = 'toast-close'");
    expect(js).toContain("closeBtn.addEventListener('click', dismiss)");
  });

  it('wires up event listeners for live logs and execution drawer controls', () => {
    expect(js).toContain("$('#logLevelFilter')?.addEventListener('change'");
    expect(js).toContain("$('#logSearchInput')?.addEventListener('input'");
    expect(js).toContain("$('#btnClearLogs')?.addEventListener('click'");
    expect(js).toContain("$('#drawerLevelFilter')?.addEventListener('change'");
    expect(js).toContain("$('#btnClearDrawerLogs')?.addEventListener('click'");
  });
});
