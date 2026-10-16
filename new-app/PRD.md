# Historical requirements and implementation checklist (not the current product contract)

> This file records an earlier automation-centric development brief. Checked items are historical implementation assertions, not proof of real Azure DevOps tenant behavior. The current target product direction and acceptance gates are in [Product Direction](docs/PRODUCT_DIRECTION.md) and [Security](docs/SECURITY.md). The actual deployment must be verified separately; automated browser fixtures do not constitute live tenant validation.

## Previous PRD: Autonomous Task Creation Audit, Persistent Automation & End-to-End Verification

## Overview
Transform the `new-app` task creation and automation engine into an enterprise-grade, unattended, highly resilient, and fully verifiable Azure DevOps automation platform. Ensure robust duplicate protection, relation/hierarchy preservation, multi-user rules, persistent background scheduling across server restarts, custom schedules, and intuitive UI controls.

---

## Phase Checklist

### Phase 1: Complete Feature & Automation Audit
- [x] 1.1 Audit real task creation capability: WIQL discovery, scalar copying, exclusion filters, relation preservation, duplicate checking.
- [x] 1.2 Audit background scheduler: inspect current in-memory setTimeout, identify restart vulnerabilities, analyze trigger reliability and timezone calculations.
- [x] 1.3 Audit manual & ad-hoc task creation: evaluate UI controls, single-person vs batch, date overrides, custom title/field handling.
- [x] 1.4 Audit duplicate protection & date windowing: test behavior across date boundaries, holidays, weekends, multi-day spans, Thursday shift modes.
- [x] 1.5 Audit field copy & relation preservation: inspect Parent, Related, Predecessor/Successor link copying, estimate preservation, iteration path consistency.
- [x] 1.6 Audit error handling & network resilience: check PAT expiry, Azure DevOps 429 rate limits, socket disconnects, partial batch recovery.
- [x] 1.7 Audit concurrency locks & multi-instance safety: verify FileLockRepository behavior against race conditions and crash recovery.
- [x] 1.8 Audit audit trail & observability: verify journal logging, verification hashes, export formats (CSV/JSON), real-time SSE stream.
- [x] 1.9 Document findings in `docs/audit/AUTOMATION_AUDIT_REPORT.md`.

### Phase 2: Persistent & Unattended Automation Scheduler
- [x] 2.1 Design & implement persistent scheduler state (autoStart on boot, enabled flag, custom schedule time/cron, timezone, last run metadata) stored in config repository.
- [x] 2.2 Wire automatic scheduler boot in `server.ts` and `index.ts`: when server starts or restarts, if scheduler was enabled, resume automatically.
- [x] 2.3 Implement configurable schedule time (e.g., custom daily time or cron rather than hardcoded 09:30).
- [x] 2.4 Add API endpoints and UI controls to update schedule configuration, toggle persistent state, view next run, and trigger manual "Run Now".
- [x] 2.5 Ensure graceful shutdown and lock release during server restarts without corrupting state.

### Phase 3: Multi-User Automation & Creation Rules
- [x] 3.1 Support per-person schedule rules (enable/disable automated creation per person, custom source task ID per person, individual start/stop days).
- [x] 3.2 Implement team-level vs individual execution controls in Task Planner and Scheduler.
- [x] 3.3 Verify and support Thursday Mode toggle per run/schedule (CURRENT vs FOLLOWING) and custom date window overrides.

### Phase 4: Task Creation Safety, Integrity & Recovery
- [x] 4.1 Strict duplicate prevention: ensure WIQL queries always detect existing items with same prefix, person, and target date.
- [x] 4.2 Validate relation copying resilience: parent links, child links, related links, with automated repair capability.
- [x] 4.3 Add retry backoff for Azure DevOps transient HTTP 429/503 errors and clear error telemetry on auth/PAT failures.
- [x] 4.4 Provide ad-hoc task creation endpoint & UI modal for custom single-task generation if needed.

### Phase 5: User Interface & Operational Controls
- [x] 5.1 Dashboard Automation Widget: live scheduler status card with next run countdown, persistent toggle, run time picker, and trigger button.
- [x] 5.2 Settings / Automation panel: configure automated run time, timezone, auto-start on boot, notification preferences.
- [x] 5.3 Task Planner enhancements: clear visual indicators for automated vs manual assignments, direct execution per cell or batch.
- [x] 5.4 Universal task links: maintain clickable Azure DevOps links across all newly added or modified views.

### Phase 6: End-to-End Execution, Validation & Reporting
- [x] 6.1 Automated test suite expansion: unit & integration tests for persistent scheduler, config updates, and ad-hoc creator.
- [ ] 6.2 Live API & E2E verification: tenant-specific plan generation, scheduler persistence across actual server restart, journal audit logging. **Pending independent verification.**
- [x] 6.3 Update `docs/TEST_RESULTS.md` with verification proofs.
- [x] 6.4 Generate comprehensive final delivery report and complete the Ralph Loop.

### Phase 7: Dynamic Team Member Task Fetching & Multi-POD Prefix Resolution
- [x] 7.1 Fix WIQL queries in `work-item-service.ts` (`findLatestTaskForPerson`, `getExistingTasksForPerson`, `findCandidateTasks`) to filter by `System.AssignedTo` instead of global `titlePrefix` filter.
- [x] 7.2 Upgrade `parseTitleDate` in `task.ts` to flexibly parse dates from multi-segment titles (`Prefix | Date | Details`) and varied POD prefixes (`3in1_PWA_MyAccount`, `3in1_PWA_FD_Services`, `Your_Relation`, etc.).
- [x] 7.3 Support per-person `titlePrefix` in `PersonConfig`, with auto-detection from their latest source task in Azure DevOps.
- [x] 7.4 Update `planTasks` and `createTasks` to use member-specific title prefixes so newly added members have their tasks generated and tracked according to their POD convention.
- [x] 7.5 Update Team Management UI to support optional Title Prefix field.
- [ ] 7.6 Verify with automated unit/integration tests and live Azure DevOps queries for all configured team members. **Live query evidence unavailable in this review.**
