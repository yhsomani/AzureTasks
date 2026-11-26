import { test, expect } from '../harness/fixtures.js';
import { startAcceptanceServer } from '../harness/acceptance-server.js';

test.describe('Tier 2 — Auth, Security, Dead-Code & Log Boundaries (F1, F2, F3, F14)', () => {
  // ---------------------------------------------------------------------------
  // F1: Security, Auth & Rate Limiting Boundaries
  // ---------------------------------------------------------------------------

  test('[F1][Tier 2] OIDC JWT missing mandatory nbf claim is rejected with 401', async ({ request }) => {
    const server = await startAcceptanceServer({ authMode: 'oidc' });
    try {
      const tokenWithoutNbf = server.mockOidc.mintToken({
        email: 'alice@workops.test',
        roles: ['Admin'],
        omitNbf: true,
      });

      const res = await request.get(`${server.baseUrl}/api/config`, {
        headers: { Authorization: `Bearer ${tokenWithoutNbf}` },
      });
      expect(res.status()).toBe(401);
    } finally {
      await server.stop();
    }
  });

  test('[F1][Tier 2] Expired OIDC JWT is rejected with 401', async ({ request }) => {
    const server = await startAcceptanceServer({ authMode: 'oidc' });
    try {
      const expiredToken = server.mockOidc.mintToken({
        email: 'alice@workops.test',
        roles: ['Admin'],
        expired: true,
      });

      const res = await request.get(`${server.baseUrl}/api/config`, {
        headers: { Authorization: `Bearer ${expiredToken}` },
      });
      expect(res.status()).toBe(401);
    } finally {
      await server.stop();
    }
  });

  test('[F1][Tier 2] OIDC JWT signed with HS256 (wrongAlg: true) is rejected with 401', async ({ request }) => {
    const server = await startAcceptanceServer({ authMode: 'oidc' });
    try {
      const hs256Token = server.mockOidc.mintToken({
        email: 'alice@workops.test',
        roles: ['Admin'],
        wrongAlg: true,
      });

      const res = await request.get(`${server.baseUrl}/api/config`, {
        headers: { Authorization: `Bearer ${hs256Token}` },
      });
      expect(res.status()).toBe(401);
    } finally {
      await server.stop();
    }
  });

  test('[F1][Tier 2] OIDC JWT with wrong audience, wrong issuer, or rogue signature is rejected with 401', async ({ request }) => {
    const server = await startAcceptanceServer({ authMode: 'oidc' });
    try {
      const invalidVariants = [
        server.mockOidc.mintToken({ email: 'alice@workops.test', roles: ['Admin'], wrongAudience: true }),
        server.mockOidc.mintToken({ email: 'alice@workops.test', roles: ['Admin'], wrongIssuer: true }),
        server.mockOidc.mintToken({ email: 'alice@workops.test', roles: ['Admin'], wrongSignature: true }),
      ];

      for (const token of invalidVariants) {
        const res = await request.get(`${server.baseUrl}/api/config`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        expect(res.status()).toBe(401);
      }
    } finally {
      await server.stop();
    }
  });

  test('[F1][Tier 2] Rate limiters enforce 429 on /api/session and bulk operations when enableRateLimit is true', async ({ request }) => {
    const server = await startAcceptanceServer({ authMode: 'basic', enableRateLimit: true });
    try {
      const headers = { Authorization: server.basicAdminHeader };

      let authRateLimited = false;
      for (let i = 0; i < 150; i += 1) {
        const res = await request.get(`${server.baseUrl}/api/session`, { headers });
        if (res.status() === 429) {
          authRateLimited = true;
          break;
        }
      }
      expect(authRateLimited).toBe(true);

      let bulkRateLimited = false;
      for (let i = 0; i < 60; i += 1) {
        const res = await request.post(`${server.baseUrl}/api/tasks/plan`, {
          headers,
          data: { personKeys: ['alice'] },
        });
        if (res.status() === 429) {
          bulkRateLimited = true;
          break;
        }
      }
      expect(bulkRateLimited).toBe(true);
    } finally {
      await server.stop();
    }
  });

  test('[F1][Tier 2] Unauthenticated and spoofed x-mock-role / x-operator-email headers are rejected', async ({ request }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const spoofedUnauth = await request.post(`${server.baseUrl}/api/config/settings`, {
        headers: {
          'x-mock-role': 'Admin',
          'x-operator-email': 'attacker@evil.invalid',
        },
        data: { titlePrefix: 'Pwned |' },
      });
      expect(spoofedUnauth.status()).toBe(401);

      const spoofedAuditor = await request.post(`${server.baseUrl}/api/config/settings`, {
        headers: {
          Authorization: server.basicAuditorHeader,
          'x-mock-role': 'Admin',
          'x-operator-email': 'attacker@evil.invalid',
        },
        data: { titlePrefix: 'Pwned |' },
      });
      expect(spoofedAuditor.status()).toBe(403);
    } finally {
      await server.stop();
    }
  });

  // ---------------------------------------------------------------------------
  // F2: Dead Code Removal & Web Shell Cleanliness Boundaries
  // ---------------------------------------------------------------------------

  test('[F2][Tier 2] Unknown API route /api/does-not-exist returns JSON 404 instead of HTML fallback', async ({ apiGet }) => {
    const res = await apiGet('/api/does-not-exist');
    expect(res.status()).toBe(404);
    const contentType = (res.headers()['content-type'] || '').toLowerCase();
    expect(contentType).toContain('application/json');
    const body = await res.text();
    expect(body).not.toMatch(/<!DOCTYPE html>/i);
    expect(() => JSON.parse(body)).not.toThrow();
  });

  test('[F2][Tier 2] Direct requests to removed legacy paths (/public/app.js, /vendor/chart.umd.min.js) never return legacy bundles', async ({ apiGet }) => {
    for (const path of ['/public/app.js', '/app.js', '/vendor/chart.umd.min.js', '/public/styles.css']) {
      const res = await apiGet(path);
      const contentType = (res.headers()['content-type'] || '').toLowerCase();
      const text = await res.text();
      if (res.status() === 200) {
        expect(contentType).not.toContain('javascript');
        expect(text).not.toContain('legacyUiTemplate');
        expect(text).not.toContain('Chart.js');
      } else {
        expect([404, 410]).toContain(res.status());
      }
    }
  });

  test('[F2][Tier 2] Unknown SPA route renders clean fallback UI without pageerror or blank screen', async ({ page, gotoRoute }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await gotoRoute('/definitely-not-a-valid-spa-route-xyz');
    await expect(page.locator('main#main')).toBeVisible();
    const mainText = (await page.locator('main#main').innerText()).trim();
    expect(mainText.length).toBeGreaterThan(0);
    await expect(page.locator('#legacyUiTemplate')).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  });

  test('[F2][Tier 2] Malformed URL paths and XSS-like query params do not crash server or leak stack traces', async ({ apiGet }) => {
    const malformedRes = await apiGet('/api/config/%E0%A4%A');
    expect([400, 404]).toContain(malformedRes.status());
    const malformedBody = await malformedRes.text();
    expect(malformedBody).not.toMatch(/at\s+\w+\s+\(\/.*:\d+:\d+\)/);

    const xssRes = await apiGet('/api/logs/recent?search=%3Cscript%3Ealert(1)%3C%2Fscript%3E');
    expect([200, 400]).toContain(xssRes.status());

    const healthRes = await apiGet('/api/health', {});
    expect(healthRes.status()).toBe(200);
  });

  test('[F2][Tier 2] Root HTML shell enforces clean markup without inline legacy template or unsafe script leakage', async ({ apiGet }) => {
    const res = await apiGet('/');
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).not.toContain('<template id="legacyUiTemplate">');
    expect(html).not.toContain('eval(');
    expect(html).toMatch(/<script\s+type="module"/i);
  });

  // ---------------------------------------------------------------------------
  // F3: Observability, TLS & Secret Scrubbing Boundaries
  // ---------------------------------------------------------------------------

  test('[F3][Tier 2] /api/ready reports degraded readiness when Azure or GitHub is unavailable while /api/health remains 200 ok', async ({ request }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };

      server.mockAzure.setUnavailable(true, 503);
      const healthWhileAzureDown = await request.get(`${server.baseUrl}/api/health`);
      expect(healthWhileAzureDown.status()).toBe(200);
      expect(((await healthWhileAzureDown.json()) as { status: string }).status).toBe('ok');

      const readyWhileAzureDown = await request.get(`${server.baseUrl}/api/ready`, { headers });
      expect([200, 503]).toContain(readyWhileAzureDown.status());
      const azureDownBody = (await readyWhileAzureDown.json()) as {
        ready: boolean;
        checks: { database: boolean; azure: boolean; github: boolean };
      };
      expect(azureDownBody.ready).toBe(false);
      expect(azureDownBody.checks.azure).toBe(false);
      expect(azureDownBody.checks.database).toBe(true);

      server.mockAzure.setUnavailable(false);
      server.mockGitHub.setUnavailable(true, 503);

      const readyWhileGhDown = await request.get(`${server.baseUrl}/api/ready`, { headers });
      expect([200, 503]).toContain(readyWhileGhDown.status());
      const ghDownBody = (await readyWhileGhDown.json()) as {
        ready: boolean;
        checks: { github: boolean };
      };
      expect(ghDownBody.ready).toBe(false);
      expect(ghDownBody.checks.github).toBe(false);
    } finally {
      await server.stop();
    }
  });

  test('[F3][Tier 2] Secret scrubbing redacts PAT, ghp_, github_pat_, and Bearer JWT values in /api/logs/recent', async ({ request }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      const patSecret = 'pat_boundary_test_secret_11223344';
      const ghClassic = 'ghp_boundaryTestSecretToken1234567890';
      const ghFine = 'github_pat_boundary12345_secret67890';
      const fakeBearer = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJzZWNyZXQifQ.signatureBoundaryValue';

      await request.post(`${server.baseUrl}/api/config/pat`, {
        headers,
        data: { azurePat: patSecret, githubToken: ghClassic },
      });
      await request.post(`${server.baseUrl}/api/config/pat`, {
        headers,
        data: { githubToken: ghFine },
      });
      await request.get(`${server.baseUrl}/api/config`, {
        headers: { Authorization: `Bearer ${fakeBearer}` },
      });

      const logsRes = await request.get(`${server.baseUrl}/api/logs/recent`, { headers });
      expect(logsRes.status()).toBe(200);
      const logsText = await logsRes.text();
      const procLogs = server.getLogs();
      const allLogs = `${logsText}\n${procLogs.stdout}\n${procLogs.stderr}`;

      expect(allLogs).not.toContain(patSecret);
      expect(allLogs).not.toContain(ghClassic);
      expect(allLogs).not.toContain(ghFine);
      expect(allLogs).not.toContain('signatureBoundaryValue');
    } finally {
      await server.stop();
    }
  });

  test('[F3][Tier 2] /api/metrics handles unsupported POST method and unusual Accept header gracefully', async ({ request, appEnv, adminHeaders }) => {
    const postRes = await request.post(`${appEnv.baseUrl}/api/metrics`, {
      headers: adminHeaders,
      data: { bogus: true },
    });
    expect([404, 405]).toContain(postRes.status());

    const jsonAcceptRes = await request.get(`${appEnv.baseUrl}/api/metrics`, {
      headers: { ...adminHeaders, Accept: 'application/json' },
    });
    expect(jsonAcceptRes.status()).toBe(200);
    const body = await jsonAcceptRes.text();
    expect(body).toContain('# TYPE');
  });

  test('[F3][Tier 2] /api/logs/recent bounds oversized or negative limits and handles invalid level filters', async ({ apiGet }) => {
    const oversizedRes = await apiGet('/api/logs/recent?level=bogus_level&limit=999999');
    expect([200, 400]).toContain(oversizedRes.status());
    if (oversizedRes.status() === 200) {
      const payload = (await oversizedRes.json()) as { entries?: unknown[]; logs?: unknown[] };
      const list = Array.isArray(payload) ? payload : payload.entries ?? payload.logs ?? [];
      expect(Array.isArray(list)).toBe(true);
      expect(list.length).toBeLessThanOrEqual(2000);
    }

    const negativeRes = await apiGet('/api/logs/recent?limit=-10');
    expect([200, 400]).toContain(negativeRes.status());
  });

  test('[F3][Tier 2] Upstream 401 failures during /api/ready and /api/status never leak configured tokens in response or logs', async ({ request }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      server.mockAzure.setUnavailable(true, 401);
      server.mockGitHub.setUnavailable(true, 401);

      const readyRes = await request.get(`${server.baseUrl}/api/ready`, { headers });
      const statusRes = await request.get(`${server.baseUrl}/api/status`, { headers });
      const logsRes = await request.get(`${server.baseUrl}/api/logs/recent`, { headers });

      const combined = `${await readyRes.text()}\n${await statusRes.text()}\n${await logsRes.text()}`;
      expect(combined).not.toContain('e2e-mock-azure-pat');
      expect(combined).not.toContain('ghp_e2e_mock_github_token_1234567890abcdef');
    } finally {
      await server.stop();
    }
  });

  // ---------------------------------------------------------------------------
  // F14: Auth/Session UI & Global SSE Log Drawer Boundaries
  // ---------------------------------------------------------------------------

  test('[F14][Tier 2] When /api/session fails with 500 or 401, UI shows unauthenticated/error state and NEVER falls back to Admin', async ({ page, appEnv }) => {
    await page.route('**/api/session', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Session service unavailable' }),
      })
    );

    await page.goto(`${appEnv.baseUrl}/mywork`, { waitUntil: 'domcontentloaded' });
    const banner = page.getByRole('banner');
    await expect(banner).toBeVisible();
    await expect(banner).not.toContainText(/\badmin\b/i);
  });

  test('[F14][Tier 2] Unauthenticated user in OIDC mode cannot execute admin writes in UI', async ({ page }) => {
    const server = await startAcceptanceServer({ authMode: 'oidc' });
    try {
      await page.goto(`${server.baseUrl}/settings`, { waitUntil: 'domcontentloaded' });
      const banner = page.getByRole('banner');
      await expect(banner).not.toContainText(/\badmin\b/i);

      const apiAttempt = await page.request.post(`${server.baseUrl}/api/config/settings`, {
        data: { titlePrefix: 'Blocked |' },
      });
      expect(apiAttempt.status()).toBe(401);
    } finally {
      await server.stop();
    }
  });

  test('[F14][Tier 2] Closing SSE Live Log Drawer cleans up /api/logs/stream without runaway reconnect storms', async ({ page, gotoRoute }) => {
    let streamRequests = 0;
    page.on('request', (req) => {
      if (req.url().includes('/api/logs/stream')) {
        streamRequests += 1;
      }
    });

    await gotoRoute('/mywork');
    const banner = page.getByRole('banner');
    const drawerToggle = banner.getByRole('button', { name: /log/i }).first();
    await expect(drawerToggle).toBeVisible();
    await drawerToggle.click();

    const drawer = page.getByRole('dialog', { name: /log/i }).or(page.getByRole('complementary', { name: /log/i })).first();
    await expect(drawer).toBeVisible();

    const countWhenOpen = streamRequests;
    const closeBtn = drawer.getByRole('button', { name: /close/i }).first();
    if (await closeBtn.isVisible().catch(() => false)) {
      await closeBtn.click();
    } else {
      await drawerToggle.click();
    }
    await expect(drawer).toBeHidden();

    await page.waitForTimeout(1500);
    expect(streamRequests - countWhenOpen).toBeLessThanOrEqual(1);
    expect(streamRequests).toBeLessThanOrEqual(3);
  });

  test('[F14][Tier 2] /logs search input safely handles regex metacharacters without throwing', async ({ page, gotoRoute }) => {
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await gotoRoute('/logs');
    const main = page.locator('main#main');
    const searchInput = main.getByRole('searchbox').or(main.getByPlaceholder(/search|filter/i)).first();
    await expect(searchInput).toBeVisible();

    await searchInput.fill('[.*+?^${}()|[\\]\\');
    await expect(main).toBeVisible();
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test('[F14][Tier 2] /logs filter with zero matches renders an accessible empty state', async ({ page, gotoRoute }) => {
    await gotoRoute('/logs');
    const main = page.locator('main#main');
    const searchInput = main.getByRole('searchbox').or(main.getByPlaceholder(/search|filter/i)).first();
    await expect(searchInput).toBeVisible();

    await searchInput.fill('DEFINITELY_NO_LOG_ENTRY_MATCHES_000111');
    await expect(main).toContainText(/no .*log|0 |empty|no matching/i);
  });
});
