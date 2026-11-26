import { test, expect } from '../harness/fixtures.js';
import { startAcceptanceServer } from '../harness/acceptance-server.js';
import { assertLandmarks, assertNoHorizontalOverflow } from '../harness/a11y.js';

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function unwrapArray(payload: unknown, keys: string[]): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) {
    return payload as Array<Record<string, unknown>>;
  }
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    for (const key of keys) {
      if (Array.isArray(record[key])) {
        return record[key] as Array<Record<string, unknown>>;
      }
    }
  }
  return [];
}

function parsePrometheusMetricSum(metricsText: string, metricPrefix: string): number {
  let total = 0;
  let found = false;
  for (const rawLine of metricsText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith(metricPrefix)) {
      const parts = line.split(/\s+/);
      const num = Number(parts[parts.length - 1]);
      if (Number.isFinite(num)) {
        total += num;
        found = true;
      }
    }
  }
  return found ? total : -1;
}

test.describe('Tier 1 — Auth, Health, Dead-Code Cleanliness & Logs (F1, F2, F3, F14)', () => {
  // ---------------------------------------------------------------------------
  // F1: Security, Auth & Rate Limiting Hardening
  // ---------------------------------------------------------------------------

  test('[F1][Tier 1] Valid OIDC RS256 JWT is accepted on /api/session and protected endpoints', async ({ request }) => {
    const server = await startAcceptanceServer({ authMode: 'oidc' });
    try {
      const token = server.mockOidc.mintToken({
        sub: 'oidc-alice-1',
        email: 'alice@workops.test',
        name: 'Alice Chen',
        roles: ['Admin'],
        tenantId: 'tenant-enterprise-01',
      });

      const sessionRes = await request.get(`${server.baseUrl}/api/session`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(sessionRes.status()).toBe(200);
      const session = (await sessionRes.json()) as {
        authenticated: boolean;
        authMode: string;
        user: { email: string; name?: string; role: string } | null;
      };

      expect(session.authenticated).toBe(true);
      expect(session.authMode).toBe('oidc');
      expect(session.user).toBeTruthy();
      expect(session.user?.email).toBe('alice@workops.test');
      expect(session.user?.role).toBe('Admin');

      const configRes = await request.get(`${server.baseUrl}/api/config`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(configRes.status()).toBe(200);
    } finally {
      await server.stop();
    }
  });

  test('[F1][Tier 1] OIDC login flow /auth/login -> /oauth/authorize -> /auth/callback establishes authenticated session', async ({ page }) => {
    const server = await startAcceptanceServer({ authMode: 'oidc' });
    try {
      server.mockOidc.setNextUser({
        sub: 'oidc-alice-login',
        email: 'alice@workops.test',
        name: 'Alice Chen',
        roles: ['Admin'],
        tid: 'tenant-enterprise-01',
      });
      server.mockOidc.clearRequests();

      await page.goto(`${server.baseUrl}/auth/login`, { waitUntil: 'domcontentloaded' });

      const sessionRes = await page.request.get(`${server.baseUrl}/api/session`);
      expect(sessionRes.status()).toBe(200);
      const session = (await sessionRes.json()) as {
        authenticated: boolean;
        authMode: string;
        user: { email?: string; role?: string } | null;
      };

      expect(session.authenticated).toBe(true);
      expect(session.authMode).toBe('oidc');
      expect(session.user?.email).toBe('alice@workops.test');
      expect(session.user?.role).toBe('Admin');

      const oidcPaths = server.mockOidc.getRequests().map((r) => r.path);
      expect(oidcPaths.some((p) => p.includes('authorize'))).toBe(true);
      expect(oidcPaths.some((p) => p.includes('token'))).toBe(true);
    } finally {
      await server.stop();
    }
  });

  test('[F1][Tier 1] POST /auth/logout clears authenticated OIDC session', async ({ page }) => {
    const server = await startAcceptanceServer({ authMode: 'oidc' });
    try {
      server.mockOidc.setNextUser({
        sub: 'oidc-logout-user',
        email: 'alice@workops.test',
        name: 'Alice Chen',
        roles: ['Admin'],
        tid: 'tenant-enterprise-01',
      });

      await page.goto(`${server.baseUrl}/auth/login`, { waitUntil: 'domcontentloaded' });

      const beforeLogout = await page.request.get(`${server.baseUrl}/api/session`);
      expect(beforeLogout.status()).toBe(200);
      const beforeJson = (await beforeLogout.json()) as { authenticated: boolean };
      expect(beforeJson.authenticated).toBe(true);

      const logoutRes = await page.request.post(`${server.baseUrl}/auth/logout`);
      expect([200, 204, 302]).toContain(logoutRes.status());

      const afterLogout = await page.request.get(`${server.baseUrl}/api/session`);
      expect(afterLogout.status()).toBe(200);
      const afterJson = (await afterLogout.json()) as { authenticated: boolean; user: unknown };
      expect(afterJson.authenticated).toBe(false);
      expect(afterJson.user).toBeNull();

      const protectedRes = await page.request.get(`${server.baseUrl}/api/config`);
      expect(protectedRes.status()).toBe(401);
    } finally {
      await server.stop();
    }
  });

  test('[F1][Tier 1] RBAC role enforcement allows Admin writes while restricting Auditor to read-only', async ({ request }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const adminHeaders = { Authorization: server.basicAdminHeader };
      const auditorHeaders = { Authorization: server.basicAuditorHeader };

      const auditorSessionRes = await request.get(`${server.baseUrl}/api/session`, { headers: auditorHeaders });
      expect(auditorSessionRes.status()).toBe(200);
      const auditorSession = (await auditorSessionRes.json()) as {
        authenticated: boolean;
        user: { role: string } | null;
      };
      expect(auditorSession.authenticated).toBe(true);
      expect(auditorSession.user?.role).toBe('Auditor');

      const auditorReadConfig = await request.get(`${server.baseUrl}/api/config`, { headers: auditorHeaders });
      expect(auditorReadConfig.status()).toBe(200);

      const auditorReadJournal = await request.get(`${server.baseUrl}/api/journal`, { headers: auditorHeaders });
      expect(auditorReadJournal.status()).toBe(200);

      const auditorWriteSettings = await request.post(`${server.baseUrl}/api/config/settings`, {
        headers: auditorHeaders,
        data: { titlePrefix: 'Unauthorized |' },
      });
      expect(auditorWriteSettings.status()).toBe(403);

      const auditorWriteAdhoc = await request.post(`${server.baseUrl}/api/tasks/adhoc`, {
        headers: auditorHeaders,
        data: { personKey: 'alice', date: todayIsoDate(), title: 'Auditor Write Denied', estimatedHours: 1 },
      });
      expect(auditorWriteAdhoc.status()).toBe(403);

      const adminWriteSettings = await request.post(`${server.baseUrl}/api/config/settings`, {
        headers: adminHeaders,
        data: { titlePrefix: 'WorkOps |' },
      });
      expect(adminWriteSettings.status()).toBe(200);
    } finally {
      await server.stop();
    }
  });

  test('[F1][Tier 1] x-mock-role header is ignored when test-harness role bypass is not enabled', async ({ request }) => {
    const oidcServer = await startAcceptanceServer({ authMode: 'oidc' });
    try {
      const unauthSessionRes = await request.get(`${oidcServer.baseUrl}/api/session`, {
        headers: { 'x-mock-role': 'Admin' },
      });
      expect(unauthSessionRes.status()).toBe(200);
      const unauthSession = (await unauthSessionRes.json()) as { authenticated: boolean; user: unknown };
      expect(unauthSession.authenticated).toBe(false);
      expect(unauthSession.user).toBeNull();

      const unauthWriteRes = await request.post(`${oidcServer.baseUrl}/api/config/settings`, {
        headers: { 'x-mock-role': 'Admin' },
        data: { titlePrefix: 'Escalated |' },
      });
      expect(unauthWriteRes.status()).toBe(401);

      const auditorToken = oidcServer.mockOidc.mintToken({
        sub: 'oidc-auditor-1',
        email: 'auditor@workops.test',
        name: 'OIDC Auditor',
        roles: ['Auditor'],
      });
      const escalatedWriteRes = await request.post(`${oidcServer.baseUrl}/api/config/settings`, {
        headers: {
          Authorization: `Bearer ${auditorToken}`,
          'x-mock-role': 'Admin',
        },
        data: { titlePrefix: 'Escalated |' },
      });
      expect(escalatedWriteRes.status()).toBe(403);
    } finally {
      await oidcServer.stop();
    }
  });

  test('[F1][Tier 1] resolveOperator() derives operatorEmail from verified OIDC token instead of spoofed headers', async ({ request }) => {
    const server = await startAcceptanceServer({ authMode: 'oidc' });
    try {
      const token = server.mockOidc.mintToken({
        sub: 'oidc-alice-op',
        email: 'alice@workops.test',
        name: 'Alice Chen',
        roles: ['Admin'],
      });

      const createRes = await request.post(`${server.baseUrl}/api/tasks/adhoc`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'x-operator-email': 'spoofed-attacker@evil.invalid',
          'x-user-email': 'spoofed-attacker@evil.invalid',
        },
        data: {
          personKey: 'alice',
          date: todayIsoDate(),
          title: 'Verified Operator Identity Task',
          estimatedHours: 2,
        },
      });
      expect([200, 201]).toContain(createRes.status());

      const journalRes = await request.get(`${server.baseUrl}/api/journal`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(journalRes.status()).toBe(200);
      const entries = unwrapArray(await journalRes.json(), ['entries', 'items', 'journal', 'records']);
      const createdEntry = entries.find((e) => String(e.title || '').includes('Verified Operator Identity Task'));
      expect(createdEntry).toBeTruthy();
      expect(createdEntry?.operatorEmail).toBe('alice@workops.test');
      expect(createdEntry?.operatorEmail).not.toBe('spoofed-attacker@evil.invalid');
    } finally {
      await server.stop();
    }
  });

  // ---------------------------------------------------------------------------
  // F2: Dead Code Removal & Web Shell Cleanliness
  // ---------------------------------------------------------------------------

  test('[F2][Tier 1] Root / serves clean HTML shell without legacyUiTemplate, /app.js, or Chart.js', async ({ apiGet }) => {
    const res = await apiGet('/');
    expect(res.status()).toBe(200);
    const contentType = res.headers()['content-type'] || '';
    expect(contentType.toLowerCase()).toContain('text/html');

    const html = await res.text();
    expect(html).toMatch(/id=["']root["']/i);
    expect(html).not.toContain('legacyUiTemplate');
    expect(html).not.toContain('/app.js');
    expect(html).not.toContain('chart.umd');
    expect(html).not.toContain('/styles.css');
  });

  test('[F2][Tier 1] Legacy script and vendor requests (/app.js, /vendor/chart.umd.min.js) do not serve legacy code', async ({ apiGet }) => {
    for (const legacyPath of ['/app.js', '/vendor/chart.umd.min.js', '/vendor/chart.umd.js']) {
      const res = await apiGet(legacyPath);
      const contentType = (res.headers()['content-type'] || '').toLowerCase();
      const body = await res.text();

      if (res.status() === 200) {
        expect(contentType).not.toContain('javascript');
        expect(body).not.toContain('legacyUiTemplate');
        expect(body).not.toContain('Chart.register');
      } else {
        expect([404, 410]).toContain(res.status());
      }
    }
  });

  test('[F2][Tier 1] Compiled Tailwind CSS stylesheet loads cleanly with HTTP 200', async ({ page, gotoRoute }) => {
    const cssResponses: Array<{ url: string; status: number; contentType: string }> = [];
    page.on('response', (res) => {
      if (res.url().includes('.css') || (res.headers()['content-type'] || '').includes('text/css')) {
        cssResponses.push({
          url: res.url(),
          status: res.status(),
          contentType: res.headers()['content-type'] || '',
        });
      }
    });

    await gotoRoute('/mywork');
    await expect(page.locator('main#main')).toBeVisible();

    const stylesheetLinks = await page.locator('link[rel="stylesheet"]').count();
    expect(stylesheetLinks).toBeGreaterThan(0);
    expect(cssResponses.length).toBeGreaterThan(0);
    for (const css of cssResponses) {
      expect(css.status).toBe(200);
      expect(css.contentType.toLowerCase()).toContain('text/css');
    }
  });

  test('[F2][Tier 1] Modern SPA loads with zero console errors and zero uncaught pageerrors', async ({ page, gotoRoute }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });
    page.on('pageerror', (err) => {
      pageErrors.push(err.message);
    });

    await gotoRoute('/mywork');
    await expect(page.locator('main#main')).toBeVisible();
    await gotoRoute('/dashboard');
    await expect(page.locator('main#main')).toBeVisible();
    await gotoRoute('/logs');
    await expect(page.locator('main#main')).toBeVisible();

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('[F2][Tier 1] Clean SPA routes resolve without #legacyUiTemplate or global Chart object', async ({ page, gotoRoute }) => {
    for (const route of ['/mywork', '/dashboard', '/logs']) {
      await gotoRoute(route);
      await expect(page.locator('main#main')).toBeVisible();
      await expect(page.locator('#legacyUiTemplate')).toHaveCount(0);
      const hasLegacyChart = await page.evaluate(() => Boolean((window as unknown as Record<string, unknown>).Chart));
      expect(hasLegacyChart).toBe(false);
    }
  });

  // ---------------------------------------------------------------------------
  // F3: Observability, TLS & Secret Scrubbing
  // ---------------------------------------------------------------------------

  test('[F3][Tier 1] GET /api/health returns canonical liveness payload', async ({ apiGet }) => {
    const res = await apiGet('/api/health', {});
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      status: string;
      uptimeSeconds: number;
      timestamp: string;
    };

    expect(body.status).toBe('ok');
    expect(typeof body.uptimeSeconds).toBe('number');
    expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(typeof body.timestamp).toBe('string');
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
  });

  test('[F3][Tier 1] GET /api/ready returns deep readiness checks for database, azure, github, and scheduler', async ({ apiGet }) => {
    const res = await apiGet('/api/ready');
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      ready: boolean;
      checks: {
        database: boolean;
        azure: boolean;
        github: boolean;
        scheduler: boolean;
      };
    };

    expect(body.ready).toBe(true);
    expect(body.checks).toBeTruthy();
    expect(body.checks.database).toBe(true);
    expect(body.checks.azure).toBe(true);
    expect(body.checks.github).toBe(true);
    expect(typeof body.checks.scheduler).toBe('boolean');
  });

  test('[F3][Tier 1] GET /api/metrics returns Prometheus exposition text with dynamic request counters', async ({ request }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };

      const firstRes = await request.get(`${server.baseUrl}/api/metrics`, { headers });
      expect(firstRes.status()).toBe(200);
      const contentType = (firstRes.headers()['content-type'] || '').toLowerCase();
      expect(contentType).toContain('text/plain');
      const firstText = await firstRes.text();
      expect(firstText).toMatch(/^#\s+(HELP|TYPE)\s+/m);

      const firstHttpSum = parsePrometheusMetricSum(firstText, 'http_requests_total');

      // Execute several real API requests so request counters increment dynamically
      await request.get(`${server.baseUrl}/api/health`);
      await request.get(`${server.baseUrl}/api/config`, { headers });
      await request.get(`${server.baseUrl}/api/ready`, { headers });
      await request.get(`${server.baseUrl}/api/status`, { headers });

      const secondRes = await request.get(`${server.baseUrl}/api/metrics`, { headers });
      expect(secondRes.status()).toBe(200);
      const secondText = await secondRes.text();
      const secondHttpSum = parsePrometheusMetricSum(secondText, 'http_requests_total');

      if (firstHttpSum >= 0 && secondHttpSum >= 0) {
        expect(secondHttpSum).toBeGreaterThan(firstHttpSum);
      } else {
        // Verify at least one dynamic metric changed rather than returning a static string
        expect(secondText).not.toBe(firstText);
      }
    } finally {
      await server.stop();
    }
  });

  test('[F3][Tier 1] Single canonical /api/metrics endpoint produces valid consistent Prometheus output', async ({ apiGet }) => {
    const res1 = await apiGet('/api/metrics');
    expect(res1.status()).toBe(200);
    const text1 = await res1.text();

    const res2 = await apiGet('/api/metrics');
    expect(res2.status()).toBe(200);
    const text2 = await res2.text();

    for (const text of [text1, text2]) {
      expect(text).toContain('# TYPE');
      const dataLines = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith('#'));
      expect(dataLines.length).toBeGreaterThan(0);
      for (const line of dataLines) {
        expect(line).toMatch(/^[a-zA-Z_:][a-zA-Z0-9_:]*(\{[^}]*\})?\s+[-+]?\d+(\.\d+)?([eE][-+]?\d+)?(\s+\d+)?$/);
      }
    }
  });

  test('[F3][Tier 1] Secret scrubbing masks Azure PAT, GitHub token, and Bearer credentials in /api/logs/recent and server logs', async ({ request }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      const injectedAzurePat = 'pat_e2e_secret_azure_value_987654';
      const injectedGithubToken = 'ghp_e2e_secret_github_value_9876543210';

      await request.post(`${server.baseUrl}/api/config/pat`, {
        headers,
        data: {
          azurePat: injectedAzurePat,
          githubToken: injectedGithubToken,
        },
      });
      await request.get(`${server.baseUrl}/api/status`, { headers });

      const recentRes = await request.get(`${server.baseUrl}/api/logs/recent`, { headers });
      expect(recentRes.status()).toBe(200);
      const recentText = await recentRes.text();

      const processLogs = server.getLogs();
      const combinedLogs = `${recentText}\n${processLogs.stdout}\n${processLogs.stderr}`;

      expect(combinedLogs).not.toContain('e2e-mock-azure-pat');
      expect(combinedLogs).not.toContain('ghp_e2e_mock_github_token_1234567890abcdef');
      expect(combinedLogs).not.toContain(injectedAzurePat);
      expect(combinedLogs).not.toContain(injectedGithubToken);
    } finally {
      await server.stop();
    }
  });

  // ---------------------------------------------------------------------------
  // F14: Auth/Session UI & Global SSE Log Drawer
  // ---------------------------------------------------------------------------

  test('[F14][Tier 1] UI header renders accurate RBAC role badge for Admin and Auditor without fake admin fallback', async ({ page, gotoRoute }) => {
    await gotoRoute('/mywork', { role: 'admin' });
    await assertLandmarks(page);
    const banner = page.getByRole('banner');
    await expect(banner).toContainText(/admin/i);

    await gotoRoute('/mywork', { role: 'auditor' });
    await assertLandmarks(page);
    await expect(banner).toContainText(/auditor/i);
    await expect(banner).not.toContainText(/\badmin\b/i);
  });

  test('[F14][Tier 1] OIDC UI header displays Login control when unauthenticated and Logout + user info after login', async ({ page }) => {
    const server = await startAcceptanceServer({ authMode: 'oidc' });
    try {
      server.mockOidc.setNextUser({
        sub: 'oidc-ui-alice',
        email: 'alice@workops.test',
        name: 'Alice Chen',
        roles: ['Admin'],
        tid: 'tenant-enterprise-01',
      });

      await page.goto(`${server.baseUrl}/mywork`, { waitUntil: 'domcontentloaded' });
      const banner = page.getByRole('banner');
      const loginControl = banner
        .getByRole('link', { name: /log\s*in|sign\s*in/i })
        .or(banner.getByRole('button', { name: /log\s*in|sign\s*in/i }))
        .first();
      await expect(loginControl).toBeVisible();

      await loginControl.click();
      await page.waitForURL((url) => url.origin === server.baseUrl && !url.pathname.startsWith('/auth/'));

      await expect(banner).toContainText(/Alice Chen|alice@workops\.test|Admin/i);
      const logoutControl = banner
        .getByRole('button', { name: /log\s*out|sign\s*out/i })
        .or(banner.getByRole('link', { name: /log\s*out|sign\s*out/i }))
        .first();
      await expect(logoutControl).toBeVisible();

      await logoutControl.click();
      await expect(
        banner
          .getByRole('link', { name: /log\s*in|sign\s*in/i })
          .or(banner.getByRole('button', { name: /log\s*in|sign\s*in/i }))
          .first()
      ).toBeVisible();
    } finally {
      await server.stop();
    }
  });

  test('[F14][Tier 1] Theme switcher cycles light, dark, and system themes and updates document state', async ({ page, gotoRoute }) => {
    await gotoRoute('/mywork');
    await assertLandmarks(page);

    const banner = page.getByRole('banner');
    const themeSelect = banner.getByRole('combobox', { name: /theme/i }).first();
    const themeButton = banner.getByRole('button', { name: /theme|dark|light|system/i }).first();

    const getThemeSnapshot = () =>
      page.evaluate(() => ({
        className: document.documentElement.className,
        dataTheme: document.documentElement.getAttribute('data-theme') || '',
        colorScheme: document.documentElement.style.colorScheme || '',
      }));

    if (await themeSelect.isVisible().catch(() => false)) {
      await themeSelect.selectOption('dark');
      const darkState = await getThemeSnapshot();
      expect(`${darkState.className} ${darkState.dataTheme} ${darkState.colorScheme}`.toLowerCase()).toContain('dark');

      await themeSelect.selectOption('light');
      const lightState = await getThemeSnapshot();
      expect(`${lightState.className} ${lightState.dataTheme} ${lightState.colorScheme}`.toLowerCase()).not.toContain('dark');

      await themeSelect.selectOption('system');
    } else {
      await expect(themeButton).toBeVisible();
      const initial = await getThemeSnapshot();
      await themeButton.click();
      const afterFirstClick = await getThemeSnapshot();
      await themeButton.click();
      const afterSecondClick = await getThemeSnapshot();
      const states = [
        `${initial.className}|${initial.dataTheme}|${initial.colorScheme}`,
        `${afterFirstClick.className}|${afterFirstClick.dataTheme}|${afterFirstClick.colorScheme}`,
        `${afterSecondClick.className}|${afterSecondClick.dataTheme}|${afterSecondClick.colorScheme}`,
      ];
      expect(new Set(states).size).toBeGreaterThanOrEqual(2);
    }
  });

  test('[F14][Tier 1] Global SSE Live Log Drawer toggle opens and closes drawer with aria-expanded', async ({ page, gotoRoute }) => {
    await gotoRoute('/mywork');
    await assertLandmarks(page);

    const banner = page.getByRole('banner');
    const drawerToggle = banner.getByRole('button', { name: /log/i }).first();
    await expect(drawerToggle).toBeVisible();

    const expandedBefore = await drawerToggle.getAttribute('aria-expanded');
    if (expandedBefore !== null) {
      expect(expandedBefore).toBe('false');
    }

    await drawerToggle.click();

    const drawer = page.getByRole('dialog', { name: /log/i }).or(page.getByRole('complementary', { name: /log/i })).first();
    await expect(drawer).toBeVisible();

    const expandedDuring = await drawerToggle.getAttribute('aria-expanded');
    if (expandedDuring !== null) {
      expect(expandedDuring).toBe('true');
    }

    const closeBtn = drawer.getByRole('button', { name: /close/i }).first();
    if (await closeBtn.isVisible().catch(() => false)) {
      await closeBtn.click();
    } else {
      await drawerToggle.click();
    }
    await expect(drawer).toBeHidden();
  });

  test('[F14][Tier 1] /logs route renders recent logs with working level filter and search input', async ({ page, apiGet, gotoRoute }) => {
    await apiGet('/api/status');
    await apiGet('/api/ready');

    await gotoRoute('/logs');
    await assertLandmarks(page);
    await assertNoHorizontalOverflow(page);

    const main = page.locator('main#main');
    await expect(main).toContainText(/info|warn|error|server|health|ready|status/i);

    const levelFilter = main
      .getByRole('combobox', { name: /level/i })
      .or(main.getByLabel(/level/i))
      .first();
    if (await levelFilter.isVisible().catch(() => false)) {
      await levelFilter.selectOption({ index: 0 });
    }

    const searchInput = main.getByRole('searchbox').or(main.getByPlaceholder(/search|filter/i)).first();
    await expect(searchInput).toBeVisible();
    await searchInput.fill('NO_MATCH_EXPECTED_E2E_XYZ_987');
    await expect(main).toContainText(/no .*log|0 |empty|no matching/i);

    await searchInput.fill('');
    await expect(main).toContainText(/info|status|ready|server/i);
  });
});
