#!/usr/bin/env node
/**
 * Read-only production topology smoke test. Does not create, close, edit or
 * repair real Azure work items. Authenticated POSTs target ONLY a nonexistent
 * API route, to test the Origin guard before the 404 fallback.
 */
const raw = process.env.RELEASE_BASE_URL?.trim();
const token = process.env.API_AUTH_TOKEN?.trim();
const user = process.env.API_AUTH_USER?.trim() || 'admin';
if (!raw || !token) {
  console.error('Provide RELEASE_BASE_URL and API_AUTH_TOKEN via environment or approved secret manager.');
  process.exit(2);
}
const base = new URL(raw);
const local = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
if (base.protocol !== 'https:' && !(base.protocol === 'http:' && local && process.env.ALLOW_LOCAL_HTTP === '1')) {
  throw new Error('Release verification requires HTTPS; set ALLOW_LOCAL_HTTP=1 only for localhost staging.');
}
if (base.pathname !== '/' || base.search || base.hash || base.username || base.password) {
  throw new Error('RELEASE_BASE_URL must be an exact origin, such as https://tasks.example.com');
}
const authorization = 'Basic ' + Buffer.from(user + ':' + token).toString('base64');
async function request(path, opts = {}) {
  const response = await fetch(new URL(path, base), {
    ...opts,
    headers: { Authorization: authorization, ...opts.headers },
    redirect: 'manual',
    signal: AbortSignal.timeout(15000),
  });
  return response;
}
function check(condition, message) {
  if (!condition) throw new Error(message);
  console.log('PASS: ' + message);
}
try {
  const health = await request('/api/health');
  check(health.status === 200, 'Web process liveness returns HTTP 200');
  const healthBody = await health.json();
  check(healthBody.status === 'alive' && healthBody.dependenciesChecked === false,
    'Liveness does not fabricate backend readiness');

  const readiness = await request('/api/ready');
  check(readiness.status === 200,
    'Authenticated, read-only Azure DevOps readiness succeeds against the deployed tenant');

  const config = await request('/api/config');
  check(config.status === 200, 'Configuration can be read with operator credentials');
  const configText = await config.text();
  const parsedConfig = JSON.parse(configText);
  check(parsedConfig.success === true && Array.isArray(parsedConfig.data?.people),
    'API returns a structured configured member roster');
  check(!Object.prototype.hasOwnProperty.call(parsedConfig.data ?? {}, 'pat') &&
        !Object.prototype.hasOwnProperty.call(parsedConfig.data ?? {}, 'githubTokenRaw'),
    'Configuration API does not return raw PAT fields');

  const journal = await request('/api/journal?limit=1');
  check(journal.status === 200, 'Audit journal is readable without corruption');

  const unknownRoute = '/api/__release_origin_guard_probe_no_route__';
  const hostile = await request(unknownRoute, {
    method: 'POST',
    headers: {
      Origin: 'https://untrusted-release-probe.invalid',
      'Sec-Fetch-Site': 'cross-site',
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  check(hostile.status === 403, 'Untrusted browser Origin is rejected before routing');

  const sameOrigin = await request(unknownRoute, {
    method: 'POST',
    headers: {
      Origin: base.origin,
      'Sec-Fetch-Site': 'same-origin',
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  check(sameOrigin.status === 404, 'Authorized Origin reaches harmless unknown-route 404');

  console.log('Read-only topology checks passed. No real Azure DevOps mutation was attempted.');
  console.log('This does NOT validate work item creation, EOD writes, SSO or backup restoration.');
} catch (error) {
  console.error('FAIL: ' + (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
}
