// Browser-based user journey regression test with intentionally synthetic fixtures.
// No real Azure DevOps credentials or mutation endpoints are used.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const port = 3189;
const origin = 'http://127.0.0.1:' + port;
const auth = { username: 'admin', password: 'ci-ui-e2e' };
const member = { key: 'sample', name: 'Sample Developer', assignedTo: 'sample@example.invalid', enabled: true, role: 'Developer' };
const dates = Array.from({ length: 14 }, (_, index) => {
  const date = new Date(Date.UTC(2026, 9, 12 + index));
  return {
    dateIso: date.toISOString().slice(0, 10),
    formattedDate: `${date.getUTCDate()} Oct`,
    dayOfWeek: date.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }),
    isWeekend: date.getUTCDay() === 0 || date.getUTCDay() === 6,
  };
});
const summary = {
  totalSelectedUsers: 1, totalWorkingDates: 10, expectedCombinations: 10,
  existingCombinations: 0, missingCombinations: 10, duplicateCombinations: 0,
  overallCoveragePercent: 0, stateCounts: { New: 0, Active: 0, Closed: 0, Resolved: 0 },
  totalCompletedWork: null, totalRemainingWork: null,
};
const explorer = {
  users: [member], dates, detailedTasks: [], warnings: [], summary,
  dateRange: { startDate: '2026-10-12', endDate: '2026-10-25' },
  matrix: [{
    person: member,
    stats: { createdCount: 0, totalWorkingDays: 10, coveragePercent: 0, missingCount: 10, duplicateCount: 0, totalCompletedWork: null, unrecordedCompletedWorkTasks: 0, stateCounts: summary.stateCounts },
    cells: Object.fromEntries(dates.map(date => [date.dateIso, { ...date, status: date.isWeekend ? 'WEEKEND' : 'MISSING', tasks: [], isEligibleForCreation: false }])),
  }],
};
const fixtures = {
  '/api/status': { connected: false, organization: 'ExampleOrg', project: 'ExampleProject' },
  '/api/config': { organization: 'ExampleOrg', project: 'ExampleProject', timezone: 'Asia/Kolkata', thursdayMode: 'CURRENT', people: [member] },
  '/api/scheduler': { running: false, autoCloseEnabled: false, autoStart: false, timezone: 'Asia/Kolkata', startTime: '09:30' },
  '/api/explorer': explorer,
  '/api/journal': { entries: [], totalEntries: 0, incompleteEntriesCount: 0 },
};
const plan = {
  todayIso: '2026-10-16',
  nextThursdayIso: '2026-10-22',
  personPlans: [{
    person: member, status: 'READY',
    sourceTask: null,
    plannedDates: [{ isoDate: '2026-10-16', formattedTitleDate: '16 Oct', fullTitle: 'Sample Task | 16 Oct', status: 'PLANNED' }],
  }],
};
const views = ['dashboard', 'mywork', 'explorer', 'burndown', 'planner', 'scheduler', 'people', 'settings', 'journal', 'logs'];
const server = spawn(process.execPath, ['dist/index.js', 'serve'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port), NODE_ENV: 'production', API_AUTH_TOKEN: auth.password, API_AUTH_USER: auth.username, API_VIEWER_USER: 'auditor', API_VIEWER_TOKEN: 'ci-viewer-test', AZURE_DEVOPS_PAT: '', GITHUB_TOKEN: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', buffer => { serverLog += String(buffer).slice(-1500); });
server.stderr.on('data', buffer => { serverLog += String(buffer).slice(-1500); });
let browser;
let page;
const pageErrors = [];
const mutationRequests = [];
const eodCalls = [];

async function waitForServer() {
  for (let attempt = 0; attempt < 45; attempt++) {
    if (server.exitCode !== null) throw new Error('Server exited early: ' + serverLog);
    try {
      const response = await fetch(origin + '/api/health');
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('Server did not become healthy: ' + serverLog);
}

async function attachFixtures(pageInstance) {
  await pageInstance.route('**/api/**', async route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/logs/stream' || pathname === '/api/health' || pathname === '/api/session') return route.continue();
    if (pathname === '/api/config/people' && request.method() === 'POST') {
      // Settings-only synthetic fixture: no external Azure DevOps writes.
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { saved: true } }) });
    }
    if (pathname === '/api/tasks/plan') {
      const payload = JSON.parse(request.postData() || '{}');
      const scoped = (payload.personKeys || []).length > 0;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: scoped ? plan : { ...plan, personPlans: [] } }) });
    }
    if (pathname === '/api/tasks/close-today') {
      const body = JSON.parse(request.postData() || '{}');
      eodCalls.push(body);
      if (body.dryRun !== true) mutationRequests.push({ pathname, body });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { totalFound: 0, totalClosed: 0, totalAlreadyClosed: 0, totalFailed: 0, results: [] } }) });
    }
    if (request.method() !== 'GET') {
      mutationRequests.push({ pathname, body: request.postData() });
      return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'Mutation prohibited in browser test' }) });
    }
    const fixture = fixtures[pathname] ?? { entries: [], logs: [], totalEntries: 0 };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: fixture }) });
  });
}

try {
  await waitForServer();
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1366, height: 850 }, httpCredentials: auth });
  page = await context.newPage();
  page.on('pageerror', err => pageErrors.push(err.message));
  await attachFixtures(page);
  await page.goto(origin + '/#dashboard', { waitUntil: 'domcontentloaded' });
  await page.locator('.nav-item.active').waitFor();

  // All existing destinations must be navigable in a real browser, not just VM stubs.
  for (const view of views) {
    await page.locator('.nav-item[data-view="' + view + '"]').click();
    assert.equal(await page.locator('#view-' + view).evaluate(node => node.classList.contains('active')), true, 'visible view: ' + view);
    assert.equal(await page.locator('.nav-item[data-view="' + view + '"]').getAttribute('aria-current'), 'page', 'current page: ' + view);
    assert.equal(new URL(page.url()).hash, '#' + view, 'hash route: ' + view);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no page-wide overflow: ' + view);
  }

  await page.locator('#themeToggle').click();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  assert.equal(await page.locator('#themeToggle').getAttribute('aria-label'), 'Switch to dark theme');
  await page.locator('#themeToggle').click();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');

  await page.locator('#consoleBtn').click();
  await page.locator('#executionDrawer.open').waitFor();
  assert.equal(await page.locator('#btnCloseDrawer').evaluate(node => node === document.activeElement), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#consoleBtn').evaluate(node => node === document.activeElement), true);

  // Verify real keyboard operability, input labeling, and token visibility without
  // entering any credentials or sending a settings mutation.
  await page.locator('.nav-item[data-view="settings"]').click();
  assert.equal(await page.locator('#setTz').getAttribute('aria-describedby'), 'settingsTimezoneHelp');
  assert.equal(await page.locator('#setPat').getAttribute('type'), 'password');
  await page.locator('#togglePatEye').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#setPat').getAttribute('type'), 'text');
  assert.equal(await page.locator('#togglePatEye').getAttribute('aria-label'), 'Hide Azure DevOps token');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#setPat').getAttribute('type'), 'password');
  assert.equal(await page.locator('#togglePatEye').getAttribute('aria-label'), 'Show Azure DevOps token');
  assert.equal(mutationRequests.length, 0);

  await page.locator('.nav-item[data-view="explorer"]').click();
  await page.locator('#explorerDeselectAllBtn').click();
  await page.locator('#explorerUserPills button.user-pill[aria-pressed="false"]').waitFor();
  assert.match(await page.locator('#explorerMatrixWrap').textContent(), /Select at least one team member/);
  await page.locator('#explorerSelectAllBtn').click();
  await page.locator('#explorerUserPills button.user-pill[aria-pressed="true"]').waitFor();

  await page.locator('.nav-item[data-view="planner"]').click();
  const memberButton = page.locator('#personPicker button.person-chip');
  await memberButton.waitFor();
  assert.equal(await memberButton.getAttribute('aria-pressed'), 'true');
  await memberButton.focus();
  await page.keyboard.press('Enter');
  await page.locator('#personPicker button.person-chip[aria-pressed="false"]').waitFor();
  assert.equal(await page.locator('#executeBtn').isDisabled(), true, 'no selected members must disable batch creation');
  assert.match(await page.locator('#plannerMembersTag').textContent(), /No members selected/);
  assert.equal(mutationRequests.length, 0, 'navigating, previewing, and deselecting must not mutate work items');

  // Re-select with keyboard; a fresh scoped preview unlocks review, not direct execution.
  await page.locator('#personPicker button.person-chip').focus();
  await page.keyboard.press('Enter');
  await page.locator('#executeBtn:not([disabled])').waitFor();
  await page.locator('#executeBtn').click();
  await page.locator('#confirmModal.open').waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#confirmModal').evaluate(node => node.classList.contains('open')), false);
  assert.equal(mutationRequests.length, 0, 'cancelling review must never submit a mutation');

  // A separate scheduler workflow must preview closure before any EOD mutation.
  await page.locator('.nav-item[data-view="scheduler"]').click();
  await page.locator('#eodRunNowBtn').click();
  await page.locator('#eodModal.open').waitFor();
  assert.ok(eodCalls.length > 0);
  assert.ok(eodCalls.every(call => call.dryRun === true), 'EOD shortcut must always preview');
  await page.keyboard.press('Escape');

  await page.locator('.nav-item[data-view="dashboard"]').click();
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/ui-dashboard-desktop.png', fullPage: true });

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, httpCredentials: auth });
  const mobilePage = await mobile.newPage();
  mobilePage.on('pageerror', err => pageErrors.push(err.message));
  await attachFixtures(mobilePage);
  await mobilePage.goto(origin + '/#dashboard', { waitUntil: 'domcontentloaded' });
  await mobilePage.locator('#menuBtn').click();
  assert.equal(await mobilePage.locator('#menuBtn').getAttribute('aria-expanded'), 'true');
  await mobilePage.locator('#navBackdrop').click({ position: { x: 350, y: 200 } });
  assert.equal(await mobilePage.locator('#menuBtn').getAttribute('aria-expanded'), 'false');
  await mobilePage.locator('#menuBtn').click();
  await mobilePage.locator('.nav-item[data-view="planner"]').click();
  assert.equal(await mobilePage.locator('#view-planner').evaluate(node => node.classList.contains('active')), true);
  await mobilePage.screenshot({ path: 'artifacts/ui-planner-mobile.png', fullPage: true });

  // Exercise the additional release-gate viewport widths without creating
  // remote Azure work items. The 390px mobile case above checks navigation.
  for (const width of [375, 768, 1024]) {
    const responsive = await browser.newContext({
      viewport: { width, height: 850 }, httpCredentials: auth,
    });
    const screen = await responsive.newPage();
    screen.on('pageerror', error => pageErrors.push(error.message));
    await attachFixtures(screen);
    await screen.goto(origin + '/#dashboard', { waitUntil: 'domcontentloaded' });
    await screen.locator('#view-dashboard.active').waitFor();
    assert.equal(await screen.locator('main').count(), 1, 'main landmark at ' + width + 'px');
    assert.equal(await screen.locator('.skip-link').count(), 1, 'skip-navigation landmark at ' + width + 'px');
    const viewportWidth = await screen.evaluate(() => window.innerWidth);
    assert.equal(viewportWidth, width, 'responsive viewport width');
    for (const view of views) {
      if (width <= 860) await screen.locator('#menuBtn').click();
      await screen.locator('.nav-item[data-view="' + view + '"]').click();
      assert.ok(await screen.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `no page-wide overflow: ${view} at ${width}px`);
      if (view === 'explorer') {
        await screen.locator('#explorerMatrixWrap .matrix-table').waitFor();
        assert.ok(await screen.locator('#explorerMatrixWrap').evaluate(node => node.scrollWidth > node.clientWidth), `dense matrix scrolls locally at ${width}px`);
      }
    }
    if (width <= 860) await screen.locator('#menuBtn').click();
    await screen.locator('.nav-item[data-view="dashboard"]').click();
    await screen.screenshot({ path: `artifacts/ui-dashboard-${width}px.png`, fullPage: true });
    await responsive.close();
  }
  // Log in with the actual viewer credential against the real /api/session
  // response while Azure data remains entirely synthetic/read-only.
  const viewerContext = await browser.newContext({
    viewport: { width: 1366, height: 850 },
    httpCredentials: { username: 'auditor', password: 'ci-viewer-test' },
  });
  const viewerPage = await viewerContext.newPage();
  viewerPage.on('pageerror', err => pageErrors.push(err.message));
  await attachFixtures(viewerPage);
  await viewerPage.goto(origin + '/#people', { waitUntil: 'domcontentloaded' });
  await viewerPage.locator('#viewerModeNotice').waitFor();
  assert.match(await viewerPage.locator('#viewerModeNotice').textContent(), /Read-only viewer/);
  assert.equal(await viewerPage.locator('#addPersonBtn').isDisabled(), true);
  assert.equal(await viewerPage.locator('#savePeopleBtn').isDisabled(), true);
  await viewerPage.locator('.nav-item[data-view="scheduler"]').click();
  assert.equal(await viewerPage.locator('#schedRunNowBtn').isDisabled(), true);
  assert.equal(await viewerPage.locator('#schedToggle').isDisabled(), true);
  await viewerContext.close();

  assert.deepEqual(mutationRequests, [], 'test must not submit any remote writes');
  assert.deepEqual(pageErrors, [], 'browser errors: ' + pageErrors.join('; '));
  console.log('Browser UI journeys passed: 10 routes, keyboard planner controls, preview protection, EOD and mobile drawer.');
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
