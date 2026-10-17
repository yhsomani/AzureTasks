import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const page = readFileSync(new URL('../../src/presentation/web/public/index.html', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../../src/presentation/web/public/styles.css', import.meta.url), 'utf8');

describe('settings design and security disclosures', () => {
  it('provides a clear first-use path, editable connection details and credential boundaries', () => {
    expect(page).toContain('id="settingsSetupGuide"');
    expect(page).toContain('id="settingsSecurityNotice"');
    expect(page).toContain('Never paste credentials into logs');
    expect(page).not.toContain('Token is stored securely in server .env');
  });
  it('associates credential and schedule inputs with usable labels and help', () => {
    expect(page).toContain('for="setPat"');
    expect(page).toContain('for="setGhToken"');
    expect(page).toContain('id="settingsTimezoneHelp"');
    expect(page).toContain('aria-describedby="settingsTimezoneHelp"');
    expect(page).toContain('autocomplete="off"');
    expect(page).toContain('id="togglePatEye" aria-label="Show Azure DevOps token"');
  });
  it('retains all existing form and integration IDs', () => {
    for (const id of ['setOrg','setProject','setTz','setStart','testConnBtn','saveSettingsBtn','setPat','savePatBtn','togglePatEye','setGhToken','setGhOrg','setGhSuffix','testGhBtn','saveGhSettingsBtn','btnRepairAll']) {
      expect(page).toContain(`id="${id}"`);
    }
  });
  it('has responsive settings layout and disclosure styling', () => {
    expect(styles).toContain('.settings-setup');
    expect(styles).toContain('.settings-security');
    expect(styles).toContain('.settings-credential-row');
  });
});