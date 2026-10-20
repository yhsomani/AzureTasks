# Scope: Milestone 2 — Core Task Engine, Explorer Timezones & Cloud Resilience

## Mission & Boundaries
- Goal: Enhance the core domain and application layer with robust identity matching, timezone-aware date extraction, resilient custom field casing for EOD rule recovery, GitHub client timeout/retry resilience, and orphan task detection in relation repair.
- Boundaries: Must maintain strict zero-mutation guardrails, zero dummy/facade implementations, and pass all quality gates (`npm run typecheck`, `npm run typecheck:tests`, `npm run lint`, `npm test`, `npm run build`).

## Work Items
1. **Source Task Ownership Identity Matching**:
   - Refactor `validateSourceTaskOwnership` in `src/domain/entities/task.ts` to utilize domain-standard `matchesPerson(fields['System.AssignedTo'], person)` from `person.ts`, eliminating false ownership rejections when Azure provides displayName without uniqueName.
   - Update callers in `src/application/use-cases/create-tasks.ts` to pass the `Person` entity.
2. **Timezone-Aware Recorded Date Extraction in Explorer**:
   - Refactor `src/application/use-cases/explore-tasks.ts` to replace raw `.split('T')[0]` UTC string extraction with `extractWorkItemRecordedDate(item, timezone)` to prevent date shifting across UTC midnight boundaries in non-UTC timezones (e.g. Asia/Kolkata).
3. **Resilient EOD Process Rule Field Casing**:
   - In `src/application/use-cases/close-daily-tasks.ts`, inspect candidate work item fields for `Custom.ActualStartDate` vs `Custom.ActualStartdate` and `Custom.ActualEndDate` vs `Custom.ActualEnddate`, using the matching casing during `TF401320` rule recovery.
4. **GitHub Client Timeout & Backoff Resilience**:
   - In `src/infrastructure/github/github-client.ts`, add request timeout via `AbortController` (30s default) and exponential backoff retry loop for transient HTTP 429, 403 (rate limited), and 5xx errors on read-only queries with rate-limit reset handling.
5. **Azure Orphan Task Discovery in Relation Repair**:
   - In `src/application/use-cases/repair-relations.ts`, add support to identify and report orphan tasks (tasks matching the series pattern that have no parent link) from candidate tasks.
6. **Automated Unit & Integration Tests**:
   - Write comprehensive unit and integration tests covering all above enhancements and verify clean typecheck, lint, test, and build passes.

## Execution Pattern
Direct iteration loop:
Explorer -> Worker -> Reviewers (2) -> Challengers (2) -> Forensic Auditor -> Gate
Strict pass criteria: All review APPROVE, all challengers APPROVE, Auditor CLEAN.

## Status & Gate Verdict
- **Status**: DONE
- **Gate Result**: PASS (Reviewer 1 APPROVE, Reviewer 2 APPROVE, Challenger 1 APPROVE, Challenger 2 APPROVE, Forensic Auditor CLEAN)
- **Quality Gates**: `npm run typecheck` (0 errors), `npm run typecheck:tests` (0 errors), `npm run lint` (0 errors), `npm test` (36 files, 468 tests passed), `npm run build` (clean build).

