# Milestone 4 Investigation Report: Enterprise Managed User (EMU) Resolution, Team Roster, and GitHub API Specifications

**Investigator**: Explorer 2 (Gen 3 Replacement)  
**Parent Orchestrator ID**: `19f092e0-2bef-4ecd-8e9f-ce470e0ff4c6`  
**Working Directory**: `/Users/yashsomani/Desktop/Asure Bord Project/.agents/teamwork_preview_explorer_m4_2_gen3`  
**Target Application**: `/Users/yashsomani/Desktop/Asure Bord Project/new-app`  
**Guardrail Mode**: Strict R3 (Zero Mutation / Strictly Read-Only)  

---

## 1. Observation

### 1.1 Enterprise Managed User (EMU) Resolution Logic in Codebase

#### Implementation Location & Logic
- **File**: `new-app/src/domain/services/github-service.ts` (lines 48–55)
```typescript
export function deriveGitHubUsernameFromEmail(email: string, suffix: string = '_bflghec'): string {
  if (!email) return '';
  const match = email.match(/<([^>]+)>/);
  const cleanEmail = match ? match[1] : email;
  const localPart = cleanEmail.split('@')[0].trim().toLowerCase();
  const hyphenated = localPart.replace(/\./g, '-');
  return `${hyphenated}${suffix}`;
}
```
- **File**: `new-app/src/infrastructure/github/github-client.ts` (lines 37–65)
  - Default suffix configuration (line 38):
    `return this.options.userSuffix !== undefined ? this.options.userSuffix : (process.env.GITHUB_USER_SUFFIX ?? '_bflghec');`
  - In `resolveUserByEmail(email, customSuffix)`:
    - Normalizes email (`toLowerCase().trim()`).
    - Checks in-memory cache `emailCache`.
    - **Step 1 (Primary)**: Deterministic EMU derivation via `deriveGitHubUsernameFromEmail(normalizedEmail, suffix)`. When suffix is present, it returns immediately without an HTTP call, logging:
      `[WARN] Derived GitHub login '${derived}' for email '${email}' from a naming convention (suffix='${suffix}'); identity has NOT been verified.`
    - **Step 2 (Fallback if suffix empty)**: Calls `GET /search/users?q=${encodeURIComponent(normalizedEmail)}+in:email`.
    - **Step 3 (Fallback if user search empty)**: Calls `GET /search/commits?q=author-email:${encodeURIComponent(normalizedEmail)}&sort=author-date&order=desc`.
- **Configuration sources**:
  - `new-app/people.json` (line 10): `"githubUserSuffix": "_bflghec"`
  - `new-app/.env` (line 24): `GITHUB_USER_SUFFIX="_bflghec"`
  - `new-app/src/container.ts` (line 82): `get userSuffix() { return config.githubUserSuffix ?? process.env.GITHUB_USER_SUFFIX ?? '_bflghec'; }`

#### Verified Unit Test Examples (`new-app/tests/unit/github-service.test.ts:14-27`)
- `yash.somani@bajajfinserv.in` -> `yash-somani_bflghec`
- `mukul.ramteke@bajajfinserv.in` -> `mukul-ramteke_bflghec`
- `ajinkya.lendikar@bajajfinserv.in` -> `ajinkya-lendikar_bflghec`
- `vishal.shinde17@bajajfinserv.in` -> `vishal-shinde17_bflghec`
- `pankaj.chaure3@bajajfinserv.in` -> `pankaj-chaure3_bflghec`
- `Yash Somani <yash.somani@bajajfinserv.in>` -> `yash-somani_bflghec` (handles display name brackets)
- `  Mukul.Ramteke@BajajFinserv.in  ` -> `mukul-ramteke_bflghec` (handles case & whitespace)

---

### 1.2 Team Roster File (`people.json`) Specification & Matching

#### Content & Schema (`new-app/people.json:1-31`)
```json
{
  "organization": "BFLDevOpsOrg",
  "project": "3in1_Agile_Projects",
  "workItemType": "3in1 Task",
  "titlePrefix": "3in1_PWA_MyAccount |",
  "startTime": "09:30",
  "timezone": "Asia/Kolkata",
  "thursdayMode": "CURRENT",
  "githubOrg": "3in1-AppFrontEnd",
  "githubUserSuffix": "_bflghec",
  "people": [
    {
      "key": "yash_somani",
      "name": "Yash Somani",
      "assignedTo": "yash.somani@bajajfinserv.in",
      "pod": "108_My Account Part 2",
      "role": "Dev On-Role",
      "titlePrefix": "3in1_PWA_MyAccount |",
      "githubRepositories": [],
      "githubBranches": [],
      "enabled": true
    }
  ],
  "schedulerEnabled": false,
  "scheduleTime": "09:30",
  "schedulerAutoStart": false,
  "autoClose": false,
  "autoCloseStartTime": "18:15",
  "autoCloseEndTime": "18:45"
}
```

#### Team Member Matching Logic
- **File**: `new-app/src/domain/entities/person.ts` (lines 67–89)
  - `matchesPerson(assignedToVal, person)` extracts identity from Azure DevOps `System.AssignedTo`:
    - Checks `uniqueName` against `person.assignedTo.toLowerCase().trim()`.
    - If `uniqueName` is missing, checks `displayName` against `person.name` or `person.assignedTo`.
- **File**: `new-app/src/application/use-cases/close-daily-tasks.ts` (lines 213–232)
  - Checks if `person.githubUsername` is explicitly configured.
  - If undefined, resolves via `this.githubClient.resolveUserByEmail(person.assignedTo, activeConfig.githubUserSuffix)`.
  - Maps to `githubUser` (`yash-somani_bflghec`).

---

### 1.3 Live GitHub API Endpoint Verifications (Strict Read-Only GET)

All live operations were executed with `Authorization: Bearer GITHUB_TOKEN` and `--cacert new-app/certs/zscaler.pem`.

#### Endpoint 1: `GET /orgs/3in1-AppFrontEnd`
- **Command**:
  ```bash
  curl -s -i --cacert "certs/zscaler.pem" \
    -H "Accept: application/vnd.github.v3+json" \
    -H "Authorization: Bearer $GITHUB_TOKEN" \
    https://api.github.com/orgs/3in1-AppFrontEnd
  ```
- **Observed Response**:
  - Status: `HTTP/1.1 200 OK`
  - `X-OAuth-Scopes`: `read:org, read:user, repo, user:email`
  - `X-RateLimit-Limit`: `5000`, `X-RateLimit-Remaining`: `4992`
  - Body payload:
    - `login`: `"3in1-AppFrontEnd"`
    - `id`: `205879836`
    - `name`: `"3in1-AppFrontEnd"`
    - `description`: `"3in1-AppFrontEnd App Team"`
    - `type`: `"Organization"`
    - `total_private_repos`: `282`
    - `owned_private_repos`: `297`
    - `plan`: `{"name":"enterprise", "space":976562499, "private_repos":999999, "filled_seats":2207, "seats":0}`

#### Endpoint 2: `GET /orgs/3in1-AppFrontEnd/repos?per_page=10`
- **Command**:
  ```bash
  curl -s --cacert "certs/zscaler.pem" \
    -H "Accept: application/vnd.github.v3+json" \
    -H "Authorization: Bearer $GITHUB_TOKEN" \
    "https://api.github.com/orgs/3in1-AppFrontEnd/repos?per_page=10"
  ```
- **Observed Response**:
  - Status: `HTTP/1.1 200 OK`
  - Returns 10 private repositories, each with default branch `develop`:
    1. `3in1_PWA_B2B_Test` (private: true, default_branch: develop)
    2. `3in1_PWA_Consent_Revocation` (private: true, default_branch: develop)
    3. `3in1_PWA_SME` (private: true, default_branch: develop)
    4. `3in1_PWA_BL` (private: true, default_branch: develop)
    5. `3in1_PWA_BL_Secured` (private: true, default_branch: develop)
    6. `3in1_PWA_PROFLOAN` (private: true, default_branch: develop)
    7. `3in1_PWA_MEF-IEF` (private: true, default_branch: develop)
    8. `3in1_PWA_CART` (private: true, default_branch: develop)
    9. `3in1_PWA_MyOrder` (private: true, default_branch: develop)
    10. `3in1_PWA_SCE` (private: true, default_branch: develop)

#### Endpoint 3: `GET /users/{username}` vs `GET /search/users?q=...`
- **Command A (`GET /users/yash-somani_bflghec`)**:
  ```bash
  curl -s -i --cacert "certs/zscaler.pem" \
    -H "Accept: application/vnd.github.v3+json" \
    -H "Authorization: Bearer $GITHUB_TOKEN" \
    https://api.github.com/users/yash-somani_bflghec
  ```
  - Status: `HTTP/1.1 200 OK`
  - `login`: `"yash-somani_bflghec"`
  - `id`: `241695772`
  - `name`: `"Yash Somani"`
  - `email`: `"yash.somani@bajajfinserv.in"`
  - `user_view_type`: `"private"`
  - `plan`: `{"name":"emu_user", "space":976562499, "collaborators":0, "private_repos":10000}`
- **Command B (`GET /search/users?q=yash.somani%40bajajfinserv.in+in:email`)**:
  ```bash
  curl -s --cacert "certs/zscaler.pem" \
    -H "Accept: application/vnd.github.v3+json" \
    -H "Authorization: Bearer $GITHUB_TOKEN" \
    "https://api.github.com/search/users?q=yash.somani%40bajajfinserv.in+in:email"
  ```
  - Status: `HTTP/1.1 200 OK`
  - Result: `{"total_count":0,"incomplete_results":false,"items":[]}`
  - **Critical Finding**: GitHub's global Search Users API does NOT index private EMU corporate emails; `total_count` is 0. Direct handle lookup via `GET /users/yash-somani_bflghec` succeeds and verifies `plan.name: "emu_user"`. This empirically proves why deterministic EMU derivation in `deriveGitHubUsernameFromEmail` is required.

#### Endpoint 4: `GET /search/issues?q=type:pr+org:3in1-AppFrontEnd&sort=created&order=desc&per_page=10`
- **Command A (Org-wide recent PRs)**:
  ```bash
  curl -s --cacert "certs/zscaler.pem" \
    -H "Accept: application/vnd.github.v3+json" \
    -H "Authorization: Bearer $GITHUB_TOKEN" \
    "https://api.github.com/search/issues?q=type:pr+org:3in1-AppFrontEnd&sort=created&order=desc&per_page=10"
  ```
  - Status: `HTTP/1.1 200 OK`
  - `total_count`: `60593` PRs in organization.
  - Recent PR authors all exhibit the enterprise suffix: `komal-garg_bflghec`, `hitesh-zamad_bflghec`, `ST0856SS_bflghec`, `sujeet-dubey1_bflghec`, `ST0720RP_bflghec`, `ST0905SY_bflghec`, `sumit-koulapure_bflghec`.
- **Command B (Member-specific PR query for Yash Somani)**:
  ```bash
  curl -s --cacert "certs/zscaler.pem" \
    -H "Accept: application/vnd.github.v3+json" \
    -H "Authorization: Bearer $GITHUB_TOKEN" \
    "https://api.github.com/search/issues?q=type:pr+author:yash-somani_bflghec+org:3in1-AppFrontEnd&sort=created&order=desc&per_page=10"
  ```
  - Status: `HTTP/1.1 200 OK`
  - `total_count`: `172` PRs authored by `yash-somani_bflghec`.
  - Representative PRs retrieved:
    - PR #2842: `"Feature.yash s/bug fix/ad branch"` (repo: `3in1_PWA_MYACCOUNT`, created: `2026-10-16T18:20:31Z`)
    - PR #2838: `"Feature.yash s/bug fix/ad branch"` (repo: `3in1_PWA_MYACCOUNT`, created: `2026-10-15T11:46:18Z`)
    - PR #2835: `"Feature.yash s/bug fix/ad branch"` (repo: `3in1_PWA_MYACCOUNT`, created: `2026-10-15T09:27:45Z`)
    - PR #2831: `"Feature.yash s/bug fix/ad branch"` (repo: `3in1_PWA_MYACCOUNT`, created: `2026-10-13T20:32:16Z`)
    - PR #277: `"Add haptics implementation from web branch"` (repo: `3in1_PWA_Drawdown`, created: `2026-10-09T12:35:02Z`)

---

### 1.4 PR Query Construction in Codebase

- **File**: `new-app/src/infrastructure/github/github-client.ts` (lines 118–123, 276–288)
  - Query string construction:
    ```typescript
    const query = [
      'type:pr',
      `author:${username}`,
      org ? `org:${org}` : '',
      options.createdRange ? `created:${options.createdRange.from}..${options.createdRange.to}` : '',
    ].filter(Boolean).join(' ');
    ```
  - In `getPrDeliverablesForDate(username, targetIsoDate, timezone)`:
    - Computes 3-day UTC envelope: `{ from: utcDay(-1), to: utcDay(1) }` to guarantee no local workday PRs are missed across UTC offsets.
    - Requests `getUserPullRequests(username, { org, createdRange, exhaustive: true })`.
    - Strictly filters returned PRs by local date using `Intl.DateTimeFormat`:
      ```typescript
      const todayPrs = prs.filter(pr => {
        const localDate = this.toLocalDateIso(pr.createdAt, timezone);
        return localDate === targetIsoDate;
      });
      ```
    - Formats HTML description and summary text using `formatPrTaskDescription`.
- **Zero-Mutation Guardrails**:
  - `GitHubClient` has no HTTP write methods (`POST`, `PUT`, `PATCH`, `DELETE`). All queries are HTTP `GET` only.

---

### 1.5 CLI Dry-Run Execution Test

- **Command**:
  ```bash
  NODE_EXTRA_CA_CERTS="/Users/yashsomani/Desktop/Asure Bord Project/new-app/certs/zscaler.pem" \
    npm start -- close-today --dry-run --all
  ```
- **Observed Output**:
  ```
  > azure-3in1-task-creator@2.0.0 start
  > node dist/index.js close-today --dry-run --all

  ◇ injected env (23) from .env
  [INFO] Running EOD task closure (dryRun=true)...
  [INFO] Starting EOD task closure for date: 2026-10-19 (dryRun=true)...
  [WARN] Derived GitHub login 'yash-somani_bflghec' for email 'yash.somani@bajajfinserv.in' from a naming convention (suffix='_bflghec'); identity has NOT been verified.

  ===================================================
  EOD TASK CLOSURE PREVIEW (DRY RUN)
  ===================================================
  Target Date        : 2026-10-19 (Asia/Kolkata)
  Tasks Found        : 1
  Tasks Closed       : 1
  Already Closed     : 0
  Failed             : 0
  ---------------------------------------------------
  [SIMULATED] Yash Somani #10711155 — 3in1_PWA_MyAccount | Oct 19 (PRs: 0 today)
  ===================================================
  ```
- Result: Task #10711155 matched Yash Somani in Azure DevOps; GitHub PR query for `yash-somani_bflghec` executed; 0 PRs for today; 0 remote modifications made (100% dry run).

---

## 2. Logic Chain

1. **Step 1 (Roster to Identity Mapping)**:
   - Observation 1.2 shows that `people.json` configures `assignedTo: "yash.somani@bajajfinserv.in"`.
   - `Person` entity and `matchesPerson` in `person.ts` authoritatively match Azure DevOps work items by `uniqueName === "yash.somani@bajajfinserv.in"`.

2. **Step 2 (Identity to GitHub EMU Login)**:
   - When closing daily tasks (`close-daily-tasks.ts:213-217`), `person.githubUsername` is checked first.
   - Because `people.json` leaves `githubUsername` undefined, `githubClient.resolveUserByEmail(person.assignedTo, activeConfig.githubUserSuffix)` is invoked.
   - Observation 1.1 shows `resolveUserByEmail` checks if `suffix` is set (`_bflghec`). Because it is set, it invokes `deriveGitHubUsernameFromEmail("yash.somani@bajajfinserv.in", "_bflghec")`.
   - Local-part `yash.somani` has its dot replaced with hyphen `yash-somani`, and `_bflghec` is appended, yielding `yash-somani_bflghec`.

3. **Step 3 (Necessity of Deterministic Derivation vs Search API)**:
   - Observation 1.3 proves that calling `GET /search/users?q=yash.somani@bajajfinserv.in+in:email` returns `total_count: 0` because GitHub EMU accounts are private to the enterprise tenant.
   - In contrast, querying `GET /users/yash-somani_bflghec` returns HTTP 200 OK with `plan.name: "emu_user"` and `email: "yash.somani@bajajfinserv.in"`.
   - Therefore, deterministic derivation is essential; standard search APIs fail silently for EMU accounts.

4. **Step 4 (PR Activity Retrieval)**:
   - With the resolved login `yash-somani_bflghec`, `getUserPullRequests` constructs the issue search query: `type:pr author:yash-somani_bflghec org:3in1-AppFrontEnd created:2026-10-18..2026-10-20`.
   - Observation 1.3 confirms `yash-somani_bflghec` has 172 author PRs in `3in1-AppFrontEnd`, confirming active historical pull requests.
   - Returned PRs are filtered by `Asia/Kolkata` date in `getPrDeliverablesForDate`. If no PRs match the specific workday, `formatPrTaskDescription` outputs honest non-invented documentation (`No matching Pull Requests were found`).

5. **Step 5 (Strict Zero Mutation Guardrail Attestation)**:
   - `GitHubClient` contains zero mutating HTTP methods (only `GET`).
   - `npm start -- close-today --dry-run --all` validates the entire end-to-end flow without making any Azure DevOps PATCH calls or GitHub mutations.

---

## 3. Caveats

1. **`NODE_EXTRA_CA_CERTS` Requirement**:
   - For Node.js processes calling Azure DevOps or GitHub through the corporate proxy, `NODE_EXTRA_CA_CERTS="/Users/yashsomani/Desktop/Asure Bord Project/new-app/certs/zscaler.pem"` must be exported in the process environment prior to Node startup.
2. **Commit Evidence Configuration**:
   - In `people.json`, `githubRepositories: []` and `githubBranches: []` are currently empty for `yash_somani`. Thus, commit querying via `/repos/{repo}/commits` is bypassed, and only PR querying via `/search/issues` is performed.
3. **GitHub Search Rate Limits**:
   - Unauthenticated/authenticated search queries against `/search/issues` are subject to GitHub's search rate limit (30 requests/minute). The application's 3-day bounded date range and caching mitigate excessive searches.

---

## 4. Conclusion

1. **EMU Resolution Logic**: The deterministic formula `localPart.replace(/\./g, '-') + suffix` accurately maps corporate emails (`yash.somani@bajajfinserv.in`) to GitHub EMU logins (`yash-somani_bflghec`).
2. **Roster Structure**: `people.json` correctly defines team members, their organizational PODs, title prefixes, and fallback configurations.
3. **Endpoint Verification**: All 4 target GitHub API endpoints (`/orgs/3in1-AppFrontEnd`, `/orgs/3in1-AppFrontEnd/repos`, `/users/{username}`, `/search/issues`) are verified live with HTTP 200 responses.
4. **Read-Only Assurance**: Strict R3 zero-mutation guardrails are verified. All operations against GitHub are read-only GET queries.

---

## 5. Verification Method

To independently reproduce and verify this investigation, execute the following commands from `/Users/yashsomani/Desktop/Asure Bord Project/new-app`:

### 5.1 Automated Test Suites
```bash
cd "/Users/yashsomani/Desktop/Asure Bord Project/new-app"
NODE_EXTRA_CA_CERTS="/Users/yashsomani/Desktop/Asure Bord Project/new-app/certs/zscaler.pem" \
  npx vitest run tests/unit/github-client.test.ts tests/unit/github-service.test.ts
```
*Expected: 2 test files passed, 26 tests passed.*

```bash
NODE_EXTRA_CA_CERTS="/Users/yashsomani/Desktop/Asure Bord Project/new-app/certs/zscaler.pem" \
  npx vitest run tests/integration/close-daily-tasks.test.ts
```
*Expected: 1 test file passed, 17 tests passed.*

### 5.2 Live Read-Only GitHub API Verification
```bash
export GITHUB_TOKEN=$(grep GITHUB_TOKEN .env | cut -d '=' -f2 | tr -d '"')
export CA_CERT="/Users/yashsomani/Desktop/Asure Bord Project/new-app/certs/zscaler.pem"

# 1. Organization Validation
curl -s -i --cacert "$CA_CERT" -H "Authorization: Bearer $GITHUB_TOKEN" \
  https://api.github.com/orgs/3in1-AppFrontEnd | grep -E "HTTP/1.1 200|total_private_repos"

# 2. Repository Listing
curl -s --cacert "$CA_CERT" -H "Authorization: Bearer $GITHUB_TOKEN" \
  "https://api.github.com/orgs/3in1-AppFrontEnd/repos?per_page=10" | grep '"name":' | head -n 10

# 3. EMU User Validation
curl -s -i --cacert "$CA_CERT" -H "Authorization: Bearer $GITHUB_TOKEN" \
  https://api.github.com/users/yash-somani_bflghec | grep -E "HTTP/1.1 200|login|emu_user"

# 4. Search Issues (PRs authored by Yash Somani)
curl -s --cacert "$CA_CERT" -H "Authorization: Bearer $GITHUB_TOKEN" \
  "https://api.github.com/search/issues?q=type:pr+author:yash-somani_bflghec+org:3in1-AppFrontEnd&per_page=5" | grep -E "total_count|title"
```

### 5.3 CLI Read-Only EOD Dry-Run
```bash
NODE_EXTRA_CA_CERTS="/Users/yashsomani/Desktop/Asure Bord Project/new-app/certs/zscaler.pem" \
  npm start -- close-today --dry-run --all
```
*Expected: Exit code 0, 1 task simulated for Yash Somani (#10711155), 0 remote mutations.*
