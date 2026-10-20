## 2026-10-19T18:32:32Z

You are the Worker agent for Milestone 2: Core Task Engine, Explorer Timezones & Cloud Resilience.
Your working directory is: `/Users/yashsomani/Desktop/Asure Bord Project/.agents/teamwork_preview_worker_m2_replace`
Target codebase directory: `/Users/yashsomani/Desktop/Asure Bord Project/new-app`

Authoritative references:
- ORIGINAL_REQUEST.md: `/Users/yashsomani/Desktop/Asure Bord Project/.agents/ORIGINAL_REQUEST.md` (read this first!)
- Scope: `/Users/yashsomani/Desktop/Asure Bord Project/.agents/teamwork_preview_sub_orch_m2_enhancement/SCOPE.md`
- Explorer Handoff: `/Users/yashsomani/Desktop/Asure Bord Project/.agents/teamwork_preview_explorer_m2_1/handoff.md`
- Explorer Blueprint: `/Users/yashsomani/Desktop/Asure Bord Project/.agents/teamwork_preview_explorer_m2_1/analysis.md`

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. An auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Your Mission:
Implement the 5 target enhancements and corresponding automated unit/integration tests with production quality, following the Explorer's blueprint:

1. `validateSourceTaskOwnership` Identity Matching Refactoring:
   - In `src/domain/entities/task.ts`, refactor `validateSourceTaskOwnership` to accept `Person | PersonConfig | string` for the assigned target, delegating assignee validation to `matchesPerson(fields['System.AssignedTo'], targetPerson)` from `src/domain/entities/person.ts` when a person object is provided (or constructing a minimal `{ assignedTo, name: assignedTo }` config when a string is passed, or handling both). Ensure that if Azure provides only `displayName`, or if `assignedTo` is an email while the item has display name, it matches correctly.
   - Update call sites in `src/application/use-cases/create-tasks.ts` (line 324) and `src/infrastructure/azure/work-item-service.ts` (lines 209, 344) to pass the `Person` entity. Keep backward compatibility for string callers.

2. Timezone-Aware Recorded Date Extraction in Explorer:
   - In `src/application/use-cases/explore-tasks.ts`, import `extractWorkItemRecordedDate` from `../../domain/entities/task.js`.
   - Replace lines 331–339 (the raw `.split('T')[0]` extraction) with `extractWorkItemRecordedDate(item, timezone)`. Ensure timezone-aware extraction prevents workday date shifting across UTC midnight boundaries (e.g. Asia/Kolkata).

3. Resilient EOD Process Rule Custom Field Casing:
   - In `src/application/use-cases/close-daily-tasks.ts` (lines 312–335), inspect existing keys on `item.fields` to determine whether the tenant uses `Custom.ActualStartDate` or `Custom.ActualStartdate`, and `Custom.ActualEndDate` or `Custom.ActualEnddate`. Use the matching casing when constructing `ruleOps` for `TF401320` rule recovery. Also add a fallback retry with the alternate casing if the patch operation fails due to schema/rule errors.

4. GitHub Client Timeout & Exponential Backoff Resilience:
   - In `src/infrastructure/github/github-client.ts`, add `timeout` (default 30,000ms) and `maxRetries` (default 3) to `GitHubClientOptions`.
   - Update `request` to create an `AbortController` with `setTimeout` and ensure `clearTimeout` is called in `finally`.
   - Implement exponential backoff retry loop with jitter for transient errors on read-only queries: HTTP 429, HTTP 403 (when rate limit headers indicate throttling: `x-ratelimit-remaining === '0'`, `retry-after`), and HTTP 5xx. Parse `retry-after` or `x-ratelimit-reset` headers when available. Ensure mock fetch compatibility (using optional chaining `res.headers?.get?.(...)`).

5. Azure Orphan Task Discovery & Repair:
   - In `src/application/use-cases/repair-relations.ts`, implement `detectOrphanTasks(candidateTasks: WorkItem[])` which filters tasks matching the series pattern that have no parent relation (`System.LinkTypes.Hierarchy-Reverse`).
   - Implement `repairOrphanTasks(orphans: OrphanTaskItem[], referenceSourceTask: WorkItem)` which applies parent linking from the reference source task to the orphans and verifies read-back.
   - Support optional `LockRepository` in constructor, and inject it in `src/container.ts`.

6. Comprehensive Automated Tests:
   - Write comprehensive unit tests in `tests/unit/task-entities.test.ts` (testing `validateSourceTaskOwnership` with displayName-only, email-only, and object identities).
   - Add unit tests in `tests/unit/explore-tasks.test.ts` verifying timezone date extraction across UTC midnight boundaries (e.g. 20:00 UTC with Asia/Kolkata).
   - Add unit tests in `tests/unit/close-daily-tasks.test.ts` verifying both PascalCase (`Custom.ActualStartDate`) and lowercase (`Custom.ActualStartdate`) process rule recovery.
   - Add unit tests in `tests/unit/github-client.test.ts` verifying request timeout, 429 retry with Retry-After backoff, and 500 server error retries.
   - Add unit tests in `tests/unit/repair-relations.test.ts` verifying orphan task detection and repair.

Verification Requirements (MUST RUN ALL AND INCLUDE RESULTS IN HANDOFF):
- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`

Deliverables:
- Write detailed change log to `/Users/yashsomani/Desktop/Asure Bord Project/.agents/teamwork_preview_worker_m2_replace/changes.md`.
- Write your handoff report to `/Users/yashsomani/Desktop/Asure Bord Project/.agents/teamwork_preview_worker_m2_replace/handoff.md`.
- Send completion message to caller via send_message.
