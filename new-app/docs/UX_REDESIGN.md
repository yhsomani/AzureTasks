# Journey-first UI redesign — audit, decisions, and verification

**Scope:** `new-app/` only. **Audit date:** 2026-10-16. **Evidence level:** repository source inspected, static contract tests and dependency-free navigation runtime tests executed in CI; actual interactive browser and Azure DevOps tenant-specific verification remain separate gates.

## Product intent and users

This application helps configured developers and team operators inspect daily 3in1 assignments, plan missing Azure DevOps work items, execute intentional creation, review work, and manage scheduled automation. The redesign prioritizes **knowing what will change before modifying remote work items** and **knowing where to go next**. Existing API contracts, ten view IDs, domain rules, identity mapping, journal, scheduler and saved data formats remain unchanged.

## Initial audit — prioritized issues

| Priority | Journey / screen | Source-based finding | Consequence | Resolution |
|---|---|---|---|---|
| Critical | Dashboard → New run | Global action navigated to Planner and immediately opened creation confirmation | Creation could be proposed without a fresh preview | Global action now only opens Planner as **Review plan** |
| Critical | Planner team selector | Zero selected keys were serialized as an undefined list (which means all enabled users) | Deselect All could unintentionally target everyone | Explicit zero-member gate; no preview or execution |
| Critical | Planner matrix cell | Single-day action posted `/tasks/execute` with `asOf` (the start of a rolling window) | Could create multiple dates instead of just the cell date | Single-cell action opens the one-off task dialog pre-filled for its date/member |
| High | Planner preview | Stale `pendingPlan` could survive selection changes or an API error | User could confirm stale scope | Preview signature + request version; confirmation requires a matching fresh plan |
| High | Dashboard | `data-view-link` buttons had no navigation event handler | “Open planner” / “View all” appeared clickable but did nothing | Central click delegation for context links |
| High | Sidebar | Ten flat routes without task-oriented groups | Users could not distinguish browsing from mutating tasks | Five labeled navigation groups, breadcrumb, active-page announcement |
| High | Responsive shell | Menu opened by toggling a CSS class, but there was no backdrop or consistent dismissal | Obscured content and unclear navigation state on mobile | Backdrop, Escape, ARIA expanded state and automatic close after navigation |
| High | Ad-hoc completion | Called `refreshPlanner()`, which is not declared | Successful task creation could throw while refreshing UI | Calls existing `runPlanPreview()` |
| High | Scheduler / journal | Run-now and relationship repair directly wrote to Azure without additional confirmation | Easy accidental mutation | Explicit confirmation; EOD shortcut opens dry-run first |
| Medium | Matrix | Inspection cells were clickable table cells rather than keyboard-operable controls | Keyboard-only users could not inspect them | Buttons inside table cells with focus treatment |
| Medium | Dialogs | Focus was not contained within open dialogs | Tab navigation could escape to the application below | Tab / Shift+Tab focus wrapping |
| Medium | Overall visual language | Inconsistent labels, many emoji headings, dense action rows and weak information hierarchy | Competing visual priorities | Restrained shell styling, grouped actions, task-sequence guidance |
| Medium | Mobile content | Dense tables and topbar controls competed at narrow widths | Horizontal overflow / truncated actions | Narrow-breakpoint wrapping and scoped table scrolling |

**Not independently verified:** true performance improvement, complete end-to-end Azure task creation, scheduler restart persistence, a11y conformance or a visual pixel-by-pixel browser review. Historical documents are not proof of those on this revision.

## Information architecture

```
3in1 Task Studio
├── Overview
│   ├── Dashboard         — health, current plan and recent activity
│   └── My work           — personal assignments
├── Explore work
│   ├── Task explorer     — coverage, existing / missing / duplicate tasks
│   └── Daily burndown    — monthly workloads and effort
├── Create & automate
│   ├── Plan & create     — select → preview → inspect → confirm
│   └── Scheduler         — recurring automation and EOD workflow
├── Manage
│   ├── Team              — assignees, roles, per-member source/prefix
│   └── Settings          — Azure / GitHub / credentials
└── Monitor
    ├── Audit log         — action records and repair
    └── Live logs         — operational telemetry
```

**Navigation contract:** Every listed destination preserves its existing `#hash`, `data-view`, and `#view-...` identifier. Back / forward navigation, direct hashes, keyboard operation, Escape dismissal and small screens must continue to work. Invalid routes return to Dashboard.

## Key user journeys and safe state transitions

### First-time setup

`Dashboard → Team → Settings → connection validation → Task Explorer`

Expected: missing credentials are surfaced as an error state. No creation request is sent as part of setup.

### Missing daily assignments

`Task Explorer (filter date/member) → Planner (choose eligible members) → plan preview → inspect matrix/list → Review & confirm → execution → Audit log`

Expected: zero selected members blocks all calls to creation APIs; a fresh preview is required; a failed preview disables confirmation; partial failures are displayed and logged; pressing a date cell opens one-off creation rather than rolling-window creation.

### One-off work item

`Planner → Create ad-hoc / one matrix cell → assignee/date/source fields → Create Task → results`

Expected: only the specified date and member are submitted to the ad-hoc endpoint; duplicate bypass remains opt-in; UI refresh uses defined functions.

### Unattended automation

`Scheduler → inspect schedule/member scope → enable or run with confirmation → Logs → Audit log`

Expected: an accidental click does not silently enable or run unattended mutations. EOD closure is previewed first and requires an explicit execute action.

### Troubleshooting

`Dashboard connection status → Settings → Logs → Audit log → optional confirmed repair`

Expected: errors are distinguishable from empty results, and repair actions are explicitly confirmed.

## Design system and reusable shell

- **Palette:** retain Azure-blue semantic primary action; neutral, low-noise surfaces; consistent danger/warning/success indicators. Dark/light token definitions stay in `styles.css`.
- **Typography:** existing system font stack, readable body text, clearly separated breadcrumb / heading / helper text.
- **Spacing:** consistent card padding and viewport-responsive content gutters; use existing reusable `.card`, `.btn`, `.grid` and `.field` controls.
- **Navigation:** `.nav-group` and `.nav-group-label`; active item uses both a color treatment and a persistent inset indicator; `aria-current=page` provides semantic state.
- **Actions:** one clear page-level primary action; non-destructive previews precede remote mutations.
- **Responsive:** 860px sidebar drawer breakpoint, 600px compact page and toolbar layouts; overlay dismissed via backdrop or Escape.
- **Accessibility:** visible keyboard focus, semantic buttons for interactive coverage cells, modal focus containment, a skip link and polite toast announcements.
- **Loading/error/empty:** protected Planner state displays updating, no-selection, preview-failure and no-pending outcomes without enabling mutation.

## Implementation tracker

| Area | Code change | Static/runtime coverage | Live/browser evidence |
|---|---|---|---|
| Shared navigation & breadcrumb | Implemented | VM harness + Chromium across ten routes | Browser CI passed (synthetic fixture) |
| Dashboard guidance and contextual links | Implemented | UI shell contract tests | Not run locally |
| Planner safe preview / scoped creation | Implemented | VM race regression + Chromium keyboard/cancellation tests | Browser CI passed; live Azure not exercised |
| Task Explorer inspection controls | Implemented | CI contract tests and Explorer selection browser journey | Browser CI passed; screen-reader review outstanding |
| My Work / Burndown | Existing views preserved + shared responsive shell | Existing regression tests | Visual review outstanding |
| Team / Settings | Existing forms retained + shared shell | Existing regression tests | Field-by-field browser review outstanding |
| Scheduler / EOD | Confirmation & preview-first entry | CI UI shell contracts | Live operation not exercised |
| Audit / Logs | Confirmed repair + navigation | Existing tests / static checks | Live stream verification outstanding |
| Modals / responsive | Focus wrap and backdrop | Chromium mobile open/close and Escape test | Browser CI passed; device and screen-reader review outstanding |
| Server-delivered UI | CI smoke implemented | Authenticated HTTP shell, protected route (401), JavaScript syntax and build | Passed in GitHub Actions; real-browser review outstanding |

## Manual acceptance scenarios

1. Follow every sidebar route by click, hash URL, Back and Forward. Confirm correct title, active item, location, visible section and keyboard focus.
2. At 375px, 768px and desktop width: open/close navigation via menu, backdrop, Escape; inspect all tables and dialogs.
3. With no Azure PAT, simulate network failures: screens must show an error, not a fabricated success or an empty success.
4. Planner: Deselect All, try preview/confirm, then reselect one member and vary date/window mid-preview; verify stale plan is never executable.
5. Planner: click one matrix date and inspect the one-off dialog's member/date. Do not run a multi-day batch through that cell.
6. Create a plan with zero eligible tasks; verify the create action is disabled.
7. Submit a deliberately invalid task request and confirm it surfaces a failure without claiming creation.
8. Keyboard-only: skip link, all nav routes, inspect buttons, dialog focus loop, Escape restoration, and disabled controls.
9. Scheduler: cancel enable/run and ensure no write call occurs. EOD shortcut must preview before closing.
10. Open console/logs; confirm stream reconnection and audit export; run relationship repair only against safe test work items.

## Remaining limitations and follow-up

A complete visual redesign of every individual form/table, screen-reader certification, real Azure DevOps mutation verification, and production performance comparisons remain **unverified**. Targeted real-Chromium journeys, desktop/mobile synthetic-fixture screenshots, and keyboard navigation smoke tests now run in CI in this repository-only session. The initial delivery focuses on high-impact journey coherence and mutation safety rather than rewriting functional business logic. Before declaring production readiness, complete the manual acceptance scenarios above and review CI on the final commit.

**Credentials:** do not reuse any PAT or GitHub token previously posted in chat. Rotate exposed values, keep secrets outside version control, and retain TLS verification.

## Verification evidence — October 16, 2026

- [Feature-branch CI run #38941255114](https://github.com/yhsomani/AzureTasks/actions/runs/38941255114) finished successfully for commit `8f54d7d`: install, TypeScript typecheck, lint, test coverage, browser JavaScript syntax check, build, and authenticated HTTP shell smoke checks.
- [Merged-main CI run #38941102028](https://github.com/yhsomani/AzureTasks/actions/runs/38941102028) finished successfully on the delivered redesign merge commit.
- The follow-up navigation regression test executes `switchView('logs')` against a minimal in-memory DOM harness and also verifies that using a single-element selector reproduces the failure. This is not equivalent to Playwright/Cypress browser E2E coverage.
- **No real Azure DevOps work items were created, closed or repaired** during these checks; no PAT was needed for the CI smoke test.

## Follow-up: state isolation, real-browser checks and Explorer reliability

The next regression-focused iteration addressed three additional root causes:

1. **Dashboard–Planner shared state collision (high impact):** An asynchronous Dashboard all-team preview used `state.pendingPlan`, the same mutable slot that backed Planner confirmation. If the Dashboard request resolved later it could replace the reviewed member/date details. The Dashboard now uses `state.dashboardPlan`; an executable VM regression test reproduced the old race first, then passed after the fix.
2. **Selection accessibility and correctness (high impact):** Planner chips and Explorer filters were mouse-only labels/spans, so keyboard-only users could not reliably select their task scope. Both now use accessible `button type=button` controls and `aria-pressed`, with focus restoration after re-render. Explorer's Deselect All previously cleared the set but then silently reselected every member, and zero selected keys caused an unfiltered query. All-member fallback is now blocked in the Explorer UI, with explicit empty-selection guidance and reset metrics.
3. **Misleading empty-data success (medium impact):** A valid empty Explorer matrix rendered an ungrounded “all tasks completely up to date” claim. Empty coverage now displays a no-task-data message instead of inventing a success result.

### Automated evidence

[Browser + full-suite CI, run #38944094953](https://github.com/yhsomani/AzureTasks/actions/runs/38944094953) passed the full suite, TypeScript typecheck, lint, JavaScript syntax, build, server authentication smoke and headless Chromium tests. The browser scenarios cover all ten routes, mobile navigation with backdrop, Planner keyboard selection, no-member mutation guards, confirmation cancellation, Explorer select/deselect behavior and EOD dry-run entry. Screenshots are uploaded as a short-lived `ui-browser-screenshots` workflow artifact and use explicit synthetic fixtures.

**Remaining verification:** production tenant task creation/closure, real-role permission flows, keyboard operation across every form and table, screen-reader audit, visual design review with screenshots on multiple real devices, and performance under slow Azure DevOps responses. Automated fixture tests are **not** proof of live integrations.

## Additional UX correctness fixes: task dates and partial execution feedback

A further test-first inspection found two misleading user journeys in the existing SPA:

- **Ad-hoc task date defaults were based on UTC.** After midnight in `Asia/Kolkata`, the UTC date can still be the prior business day; defaulting a new task to that date is unsafe. The UI now derives its default date from `Intl.DateTimeFormat(..., { timeZone: cfg.timezone })` using `formatToParts`. The Planner simulation fallback also uses the configured business day rather than raw UTC.
- **Batch execution claimed success despite partial failures.** The confirmation flow used a positive success toast regardless of `totalTaskFailureCount` and `totalSourceFailureCount`. It now warns with the exact task/source failure counts and directs operators to the audit log when the API returns partial failures. A fully successful response retains the positive confirmation.

### Test coverage and outstanding gates

`tests/integration/ui-timezone-feedback.test.ts` includes a fixed UTC instant that falls on the following day in Asia/Kolkata, an ad-hoc date default contract, a VM-executed partial-failure toast assertion, and the fully-successful control case. GitHub Actions exercises these alongside the existing browser navigation and safe creation tests.

**Not verified here:** live Azure DevOps creation, business-specific holiday/calendar rules, visual review with real data, and externally stored credential rotation. Avoid assuming success based solely on a green headless-browser fixture test.

## My Work and Daily Burndown corrective redesign — October 17, 2026

- **My Work stale data:** The previous implementation could render an outdated member's response after the user selected a different person. Selection request versions now guard the post-config fetch, stale-while-revalidate updates, and final response/error updates. A VM regression test resolves responses in reverse order to detect accidental cross-member rendering.
- **Daily Burndown keyboard access:** Existing coverage cells used `onclick` on plain `<td>` elements. Actual inspection now sits on native buttons with descriptive titles and the common focus-visible styling, while the matrix data and visual status colors remain unchanged.
- **Task links:** Some My Work links pointed to `#` when the API omitted a URL. They now use the existing Azure DevOps work-item URL helper with the numeric task ID as fallback rather than displaying a knowingly broken action.

**Evidence:** `tests/integration/ui-work-views.test.ts` initially failed in CI on all three conditions; the corrected version is rerun in the same unit/integration + Chromium pipeline. Live Azure DevOps correctness and screen-reader operation must be checked separately.
