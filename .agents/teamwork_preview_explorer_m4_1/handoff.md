# Handoff Report — Explorer 1 (Milestone 4: Live Read-Only GitHub API Connectivity & PR Activity Retrieval)

## 1. Observation

### 1.1 HTTP Client & Dependency Analysis
- **File**: `/Users/yashsomani/Desktop/Asure Bord Project/new-app/package.json`
  - Dependencies (lines 48-52):
    ```json
    "dependencies": {
      "cors": "^2.8.6",
      "dotenv": "^18.0.6",
      "express": "^5.2.1"
    }
    ```
  - Direct observation: Zero third-party HTTP client libraries (no `@octokit/rest`, no `axios`, no `got`, no `node-fetch`).
- **File**: `/Users/yashsomani/Desktop/Asure Bord Project/new-app/src/infrastructure/github/github-client.ts`
  - Line 20, 26-27:
    ```typescript
    private readonly fetchFn: typeof fetch;
    ...
    this.fetchFn = options.fetchFn || globalThis.fetch;
    ```
  - Lines 330-349 (`request<T>`):
    ```typescript
    private async request<T>(endpoint: string, init: RequestInit = {}): Promise<T> {
      const url = `${this.apiUrl}${endpoint}`;
      const headers: Record<string, string> = {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'Azure-DevOps-Task-Creator',
        ...(init.headers as Record<string, string> || {}),
      };

      if (this.token) {
        headers.Authorization = `Bearer ${this.token}`;
      }

      const res = await this.fetchFn(url, { ...init, headers });
      if (!res.ok) {
        const errorBody = await res.text().catch(() => '');
        throw new Error(`GitHub API error ${res.status} (${res.statusText}): ${errorBody.slice(0, 200)}`);
      }

      return (await res.json()) as T;
    }
    ```
  - The implementation uses Node.js 22 built-in `globalThis.fetch` (backed by Undici).

### 1.2 Strict Zero-Mutation Guardrails (R3)
- In `src/infrastructure/github/github-client.ts`:
  - Methods implemented:
    1. `resolveUserByEmail` (lines 48-106): Issues GET requests to `/search/users?q=...` (line 70) and `/search/commits?q=...` (line 87).
    2. `getUserPullRequests` (lines 111-186): Issues GET requests to `/search/issues?q=...` (line 144).
    3. `getUserCommitsForDate` (lines 193-254): Issues GET requests to `/repos/${repo}/commits?${params.toString()}` (line 235).
    4. `getPrDeliverablesForDate` (lines 261-313): Invokes `getUserPullRequests` and `getUserCommitsForDate`, then formats read-only HTML strings.
  - Verbatim inspection: Zero `POST`, `PUT`, `PATCH`, or `DELETE` HTTP methods are defined or invoked anywhere in `GitHubClient`. All remote GitHub operations are strictly read-only GET queries.

### 1.3 TLS Certificate Configuration & Critical Process-Level Discovery
- **Certificate file**: `/Users/yashsomani/Desktop/Asure Bord Project/new-app/certs/zscaler.pem`
  - Size: 1732 bytes.
  - Certificate Subject / Issuer: `Zscaler Root CA`, San Jose, California (`support@zscaler.com`), Valid through May 6, 2042.
- **TLS Safety Assertion**: `/Users/yashsomani/Desktop/Asure Bord Project/new-app/src/infrastructure/security/tls-safety.ts`
  - Lines 6-13:
    ```typescript
    export function assertTlsSafety(environment: NodeJS.ProcessEnv = process.env): void {
      if (environment.ALLOW_INSECURE_TLS?.trim().toLowerCase() === 'true' ||
          environment.NODE_TLS_REJECT_UNAUTHORIZED?.trim() === '0') {
        throw new Error(
          'TLS certificate verification must remain enabled. Remove ALLOW_INSECURE_TLS=true ' +
          'and NODE_TLS_REJECT_UNAUTHORIZED=0; configure a trusted CA via NODE_EXTRA_CA_CERTS.'
        );
      }
    }
    ```
- **Crucial Runtime Discovery (Environment Variable Loading Timing)**:
  - When `node` executes without `NODE_EXTRA_CA_CERTS` exported before the binary starts:
    ```
    TypeError: fetch failed
      [cause]: Error: unable to get local issuer certificate
        code: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY'
    ```
  - When `dotenv.config()` loads `.env` within JavaScript code, `process.env.NODE_EXTRA_CA_CERTS` is populated, but Node.js's C++ TLS subsystem (and Undici) initializes its root CA store at process boot. Setting `NODE_EXTRA_CA_CERTS` inside `.env` alone is **ineffective** for the running process.
  - When invoked with `NODE_EXTRA_CA_CERTS="/Users/yashsomani/Desktop/Asure Bord Project/new-app/certs/zscaler.pem"` exported or prefixed to the command:
    - `fetch("https://api.github.com/zen")` succeeds: `"Non-blocking is better than blocking."`
    - All live GitHub REST queries succeed with HTTP 200.

### 1.4 Environment Configuration & Secret Management
- **File**: `/Users/yashsomani/Desktop/Asure Bord Project/new-app/.env`
  - Line 23: `GITHUB_TOKEN="***REDACTED***"`
  - Line 24: `GITHUB_USER_SUFFIX="_bflghec"`
  - Line 25: `GITHUB_ORG="3in1-AppFrontEnd"`
  - Line 27: `NODE_EXTRA_CA_CERTS="/Users/yashsomani/Desktop/Asure Bord Project/new-app/certs/zscaler.pem"`
- **Container Wiring**: `/Users/yashsomani/Desktop/Asure Bord Project/new-app/src/container.ts`
  - Lines 61-63:
    ```typescript
    const ghToken = (config.githubToken || process.env.GITHUB_TOKEN || process.env.GH_PAT)?.trim() || '';
    if (ghToken) logger.registerSecret(ghToken);
    ```
  - Secret scrubbing is enforced; tokens are redacted from all console, file, and SSE streams.
  - Lines 78-83:
    ```typescript
    const githubClient = new GitHubClient({
      get token() { return config.githubToken || process.env.GITHUB_TOKEN || process.env.GH_PAT; },
      get org() { return config.githubOrg || process.env.GITHUB_ORG; },
      apiUrl: config.githubApiUrl,
      get userSuffix() { return config.githubUserSuffix ?? process.env.GITHUB_USER_SUFFIX ?? '_bflghec'; },
    });
    ```

### 1.5 Rate Limiting & Error Boundaries
- **Rate Limit Headers & Quotas**:
  - Live query to `GET /rate_limit`:
    - Core API limit: 5000 requests/hour (`remaining: 4996`)
    - Search API limit: 30 requests/minute (`remaining: 29`)
- **Error Boundaries in `src/infrastructure/github/github-client.ts`**:
  - Lines 147-155:
    - Throws if `data.incomplete_results === true` ("GitHub reported incomplete search results; work evidence cannot be trusted.").
    - Throws if `total_count > 1000` ("GitHub date-scoped search exceeds the 1000-result API cap; narrow the repository scope.").
  - Lines 179-185:
    - Explicit non-masking of errors: `GitHub PR lookup failed for '${username}': ${reason}`. Rate limit or auth errors are never treated as "zero PRs" to prevent false closure approvals.
  - Lines 203-204:
    - Combos cap: `if (combos > 20) throw new Error('Too many GitHub repository/branch combinations (maximum 20).');`

### 1.6 Live Read-Only Query Evidence
- **Organization Validation**:
  - `GET /orgs/3in1-AppFrontEnd` -> HTTP 200 OK.
  - `login`: `3in1-AppFrontEnd`, `id`: `205879836`, `public_repos`: `0`, `total_private_repos`: `282`.
- **Repository Listing**:
  - `GET /orgs/3in1-AppFrontEnd/repos?per_page=10` -> HTTP 200 OK.
  - Returned 10 repositories, all `private: true`, including `3in1_PWA_B2B_Test`, `3in1_PWA_Consent_Revocation`, `3in1_PWA_SME`, `3in1_PWA_BL`, `3in1_PWA_BL_Secured`, `3in1_PWA_PROFLOAN`, `3in1_PWA_MEF-IEF`, `3in1_PWA_CART`, `3in1_PWA_MyOrder`, `3in1_PWA_SCE`.
- **EMU Resolution**:
  - `yash.somani@bajajfinserv.in` -> derived deterministically as `yash-somani_bflghec`.
- **Pull Request Activity**:
  - `GET /search/issues?q=type:pr+author:yash-somani_bflghec+org:3in1-AppFrontEnd` -> HTTP 200 OK.
  - Retrieved active PR `#2842`: `title`: `"Feature.yash s/bug fix/ad branch"`, `state`: `"open"`, `createdAt`: `"2026-10-16T18:20:31Z"`, `repo`: `"3in1_PWA_MYACCOUNT"`.
- **Date Deliverables Formatting**:
  - Date `2026-10-16` (Asia/Kolkata): 1 PR found, rich HTML description generated with repo code badge `[3in1_PWA_MYACCOUNT]` and status `Active`.
  - Date `2026-10-17` (Asia/Kolkata): 0 PRs found, outputs honest disclaimers ("No matching Pull Requests were found. This does not establish whether other work was completed.").

### 1.7 Test Suite Execution
- Command: `NODE_EXTRA_CA_CERTS="/Users/yashsomani/Desktop/Asure Bord Project/new-app/certs/zscaler.pem" npx vitest run tests/unit/github-client.test.ts tests/unit/github-service.test.ts`
- Results:
  - `tests/unit/github-service.test.ts`: 9 tests passed.
  - `tests/unit/github-client.test.ts`: 17 tests passed.
  - Total: 26 passed across 2 test files (duration 475ms).

---

## 2. Logic Chain

1. **HTTP Client Architecture**: Inspection of `package.json` confirms no Octokit or Axios packages exist. Tracing `src/infrastructure/github/github-client.ts` shows `fetchFn` defaults to `globalThis.fetch`. Thus, the application utilizes native Node.js 22 fetch without external HTTP libraries.
2. **Zero-Mutation Enforcement**: Tracing all methods in `src/infrastructure/github/github-client.ts` (`resolveUserByEmail`, `getUserPullRequests`, `getUserCommitsForDate`, `getPrDeliverablesForDate`, `request`) reveals that every outgoing HTTP call uses the `GET` method. There are no mutation endpoints or HTTP write verbs. Thus, the client is structurally incapable of mutating remote GitHub data, satisfying R3 guardrails.
3. **TLS Certificate Dependency**: Direct execution demonstrated that native `fetch` fails with `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` due to the corporate Zscaler proxy. Node's TLS root store is established at initial process startup; setting `NODE_EXTRA_CA_CERTS` in `.env` is loaded by `dotenv` too late to affect Node's C++ crypto initialization. When `NODE_EXTRA_CA_CERTS="/Users/yashsomani/Desktop/Asure Bord Project/new-app/certs/zscaler.pem"` is set in the process environment before Node launches, all TLS connections to `api.github.com` succeed.
4. **Environment and Credential Hierarchy**: Credentials flow from `.env` via `GITHUB_TOKEN` (with fallback to `GH_PAT`), `GITHUB_ORG`, and `GITHUB_USER_SUFFIX`. Dynamic getters in `src/container.ts` bind these to `GitHubClient`, while `logger.registerSecret` prevents token leakage across logs and SSE endpoints.
5. **Rate Limiting & Integrity**: Search endpoints are subject to GitHub's 30 req/min search quota. `GitHubClient` implements strict validation: partial results (`incomplete_results: true`), pagination limits, and API errors immediately throw rather than reporting zero results, ensuring that temporary outages or rate limits cannot be misconstrued as lack of team work.
6. **Live Data Consistency**: Live tests using real credentials confirmed successful authentication against `3in1-AppFrontEnd`, verified repo lists, verified deterministic EMU username resolution, and fetched real author PR activity (`#2842`), matching all contract expectations in `SCOPE.md`.

---

## 3. Caveats

- **Process Environment Obligation**: Node.js does not reload C++ CA trust stores dynamically after `dotenv.config()`. All execution commands (CLI, worker tests, server scripts) MUST launch with `NODE_EXTRA_CA_CERTS="/Users/yashsomani/Desktop/Asure Bord Project/new-app/certs/zscaler.pem"` in the shell or process environment.
- **Search API Rate Limit Budget**: GitHub enforces a strict 30 queries/minute limit on the `/search/*` API endpoints. Bulk queries across large teams or rapid automated loops must space out search requests to avoid HTTP 403 secondary rate limits.
- **Single Person in Default Roster**: `people.json` currently contains one active member (`yash.somani@bajajfinserv.in` / `yash_somani`). Multi-member tests should either reference this person or supply additional team member test fixtures in read-only test invocations.

---

## 4. Conclusion

The GitHub client implementation in `new-app` is a lightweight, dependency-free architecture built on Node.js 22 native `fetch`. It strictly enforces the R3 Zero-Mutation guardrail (containing 100% GET operations and zero mutation logic). 

To ensure uninterrupted TLS connectivity through the enterprise proxy, processes invoking GitHub APIs must be executed with `NODE_EXTRA_CA_CERTS="/Users/yashsomani/Desktop/Asure Bord Project/new-app/certs/zscaler.pem"` in the environment. 

All live read-only endpoints (Organization validation, 10-repository querying, EMU username derivation, and PR activity retrieval) have been verified with live HTTP 200 responses, and the unit test suite passes 100% (26/26 tests).

---

## 5. Verification Method

To independently verify these findings, run the following commands from `/Users/yashsomani/Desktop/Asure Bord Project/new-app`:

1. **Execute Unit Test Suite**:
   ```bash
   NODE_EXTRA_CA_CERTS="/Users/yashsomani/Desktop/Asure Bord Project/new-app/certs/zscaler.pem" npx vitest run tests/unit/github-client.test.ts tests/unit/github-service.test.ts
   ```
   *Expected*: 26 passed tests (100% pass rate).

2. **Verify Live Read-Only GitHub API & Rate Limits**:
   ```bash
   NODE_EXTRA_CA_CERTS="/Users/yashsomani/Desktop/Asure Bord Project/new-app/certs/zscaler.pem" node -e '
   const dotenv = require("dotenv"); dotenv.config();
   const token = process.env.GITHUB_TOKEN;
   fetch("https://api.github.com/orgs/3in1-AppFrontEnd", {
     headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.v3+json", "User-Agent": "Azure-DevOps-Task-Creator" }
   }).then(r => r.json()).then(d => console.log("Org:", d.login, "Private repos:", d.total_private_repos));
   '
   ```
   *Expected*: `Org: 3in1-AppFrontEnd Private repos: 282`.

3. **Verify GitHubClient Live PR Querying**:
   ```bash
   NODE_EXTRA_CA_CERTS="/Users/yashsomani/Desktop/Asure Bord Project/new-app/certs/zscaler.pem" node -e '
   import("./dist/infrastructure/github/github-client.js").then(async ({ GitHubClient }) => {
     const dotenv = await import("dotenv"); dotenv.config();
     const client = new GitHubClient({ token: process.env.GITHUB_TOKEN, org: "3in1-AppFrontEnd" });
     const prs = await client.getUserPullRequests("yash-somani_bflghec", { limit: 1 });
     console.log("PR #:", prs[0]?.number, "Title:", prs[0]?.title);
   });
   '
   ```
   *Expected*: Prints live PR details (`PR #: 2842 Title: Feature.yash s/bug fix/ad branch`).

4. **Verify Zero Mutation**:
   Inspect `src/infrastructure/github/github-client.ts` to confirm no mutating methods (`POST`, `PUT`, `PATCH`, `DELETE`) are implemented in the client.
