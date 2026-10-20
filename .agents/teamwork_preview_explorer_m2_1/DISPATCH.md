## 2026-10-19T06:00:30Z
You are Explorer 1 for Milestone 2 (M2): Codebase Health, Typecheck, Lint & Baseline Test Suite Audit.
Your identity: explorer_m2_1 (archetype: teamwork_preview_explorer).
Your working directory: /Users/yashsomani/Desktop/Asure Bord Project/.agents/teamwork_preview_explorer_m2_1

MANDATORY: Read the original user request first:
/Users/yashsomani/Desktop/Asure Bord Project/.agents/ORIGINAL_REQUEST.md

Additional context:
- /Users/yashsomani/Desktop/Asure Bord Project/PROJECT.md
- /Users/yashsomani/Desktop/Asure Bord Project/.agents/teamwork_preview_sub_orch_m2/SCOPE.md
- /Users/yashsomani/Desktop/Asure Bord Project/.agents/teamwork_preview_explorer_survey_3/handoff.md

Your Investigation Objective:
Investigate the TypeScript, ESLint, production build, and script syntax configurations in new-app/:
1. TypeScript:
   - Inspect tsconfig.json, compilerOptions, include/exclude rules (notice whether tests/ is excluded and src/ included).
   - Check how npm run typecheck is configured in package.json (tsc --noEmit).
2. ESLint:
   - Inspect eslint configuration files (.eslintrc*, eslint.config.*, package.json eslintConfig).
   - Check what npm run lint does (eslint "src/**/*.ts") and analyze why tests/ is or isn't linted by default, and what happens if tests/**/*.ts is linted.
3. Production Build:
   - Inspect how npm run build is configured (tsc or bundler), output dir (dist/), tsconfig.json outDir.
4. Syntax Checks & Security:
   - Inspect src/presentation/web/public/app.js (static frontend entrypoint).
   - Inspect all preflight scripts in scripts/ (e.g., check-node-version.cjs, preflight-azure-devops.mjs, verify-azure-schema.mjs, etc.).
   - Check dependency configuration for npm audit.

Write a thorough exploration report to /Users/yashsomani/Desktop/Asure Bord Project/.agents/teamwork_preview_explorer_m2_1/handoff.md with your findings, exact file references, and recommendations for the worker execution phase.
Send a completion message back to parent when done.

## 2026-10-19T17:53:45Z
You are an Explorer agent for Milestone 2: Core Task Engine, Explorer Timezones & Cloud Resilience.
Your working directory is: /Users/yashsomani/Desktop/Asure Bord Project/.agents/teamwork_preview_explorer_m2_1
Target codebase directory: /Users/yashsomani/Desktop/Asure Bord Project/new-app

Authoritative references:
- ORIGINAL_REQUEST.md: /Users/yashsomani/Desktop/Asure Bord Project/.agents/ORIGINAL_REQUEST.md
- Milestone 2 Scope: /Users/yashsomani/Desktop/Asure Bord Project/.agents/teamwork_preview_sub_orch_m2_enhancement/SCOPE.md
- Survey report: /Users/yashsomani/Desktop/Asure Bord Project/.agents/teamwork_preview_explorer_survey_enhancement_2/handoff.md

Your Mission:
Conduct a detailed, code-level technical investigation of the target files for Milestone 2, formulate exact implementation blueprints, and produce an actionable handoff report for the Worker. You must NOT write or modify implementation code.

Target Areas to Investigate:
1. `src/domain/entities/task.ts` and `src/domain/entities/person.ts`:
   - Inspect `validateSourceTaskOwnership` in `task.ts` (lines ~407-415) and `matchesPerson` in `person.ts`.
   - Determine how `validateSourceTaskOwnership` should be refactored to take `Person` (or `PersonConfig`) and use `matchesPerson(fields['System.AssignedTo'], person)`.
   - Identify all callers in `src/application/use-cases/create-tasks.ts` and unit/integration tests that call `validateSourceTaskOwnership`, specifying the exact signature changes and call site updates needed.
2. `src/application/use-cases/explore-tasks.ts`:
   - Inspect recorded date extraction in `explore-tasks.ts` (lines ~331-339) where raw `.split('T')[0]` is used.
   - Contrast with `extractWorkItemRecordedDate(item, timezone)` from `src/domain/entities/task.ts`.
   - Detail how to integrate `extractWorkItemRecordedDate` cleanly in `explore-tasks.ts` with timezone handling so tasks on UTC boundaries (e.g. IST) are accurately grouped.
3. `src/application/use-cases/close-daily-tasks.ts`:
   - Inspect `TF401320` process template rule error recovery (lines ~312-335) where `Custom.ActualStartdate` and `Custom.ActualEnddate` are hardcoded.
   - Detail how to detect existing casing on `item.fields` (e.g. `Custom.ActualStartDate` vs `Custom.ActualStartdate`, `Custom.ActualEndDate` vs `Custom.ActualEnddate`) or provide appropriate recovery patch operations matching the tenant's schema.
4. `src/infrastructure/github/github-client.ts`:
   - Inspect `request` method (lines ~436-455). Compare with `src/infrastructure/azure/client.ts` timeout and retry logic.
   - Detail how to add request timeout using `AbortController` (30s default) with `clearTimeout` in `finally`.
   - Detail how to implement bounded exponential backoff retries (e.g. 3 attempts) for HTTP 429, 403 (with rate-limit headers: `x-ratelimit-remaining === '0'`, `x-ratelimit-reset`, `retry-after`), and 5xx errors for read-only requests.
5. `src/application/use-cases/repair-relations.ts`:
   - Inspect current repair logic which only processes `journal.getUnfinishedRelations()`.
   - Design an orphan task detection mechanism: querying candidate work items (e.g. from Azure or candidate lists matching the series pattern) that lack a parent relation (`System.LinkTypes.Hierarchy-Reverse`), and reporting/repairing them.
6. Test impact and verification:
   - Identify all affected test files in `tests/unit/` and `tests/integration/`.
   - Plan new unit and integration tests to verify each of these 5 enhancements.
