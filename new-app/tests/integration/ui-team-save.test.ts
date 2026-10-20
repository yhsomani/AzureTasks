import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const source = readFileSync(new URL('../../src/presentation/web/public/app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../../src/presentation/web/public/index.html', import.meta.url), 'utf8');

describe('team management trust and editing controls', () => {
  it('does not force users back into an all-team scope after saving', () => {
    const a = source.indexOf('async function savePeople()');
    const b = source.indexOf('function openAddPersonModal(', a);
    const save = source.slice(a, b);
    expect(save).not.toContain('state.selectedKeys.add(p.key)');
    expect(save).not.toContain('state.selectedExplorerKeys.add(p.key)');
    expect(save).toContain('state.pendingPlanSignature = null');
  });
  it('never claims Azure tasks were synchronized when only team settings were saved', () => {
    const a = source.indexOf('async function savePeople()');
    const b = source.indexOf('function openAddPersonModal(', a);
    const save = source.slice(a, b);
    expect(save).not.toContain('Tasks synchronized across all views');
    expect(save).toContain('Team configuration saved');
  });
  it('immediately saves Add Member and updates dirty state without requiring manual multi-step save', () => {
    const a = source.indexOf('async function savePersonFromModal()');
    const b = source.indexOf('/* ---------------------------------------------------------------- audit log */', a);
    const add = source.slice(a, b);
    expect(add).toContain("api.post('/config/people'");
    expect(add).toContain('updateTeamDirtyState(false)');
  });

  it('provides an explicit pending changes indicator with save feedback', () => {
    expect(html).toContain('id="teamSaveStatus"');
    expect(html).toContain('id="savePeopleBtn"');
    expect(source).toContain('function updateTeamDirtyState(');
    expect(source).toContain('state.teamDirty');
  });
});