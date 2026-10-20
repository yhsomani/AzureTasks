# BRIEFING — 2026-10-19T05:42:00Z

## Mission
Investigate Live Integration Architecture & Mutation Guardrails for Azure DevOps and GitHub in new-app/.

## 🔒 My Identity
- Archetype: explorer
- Roles: explorer, investigator, synthesist
- Working directory: /Users/yashsomani/Desktop/Asure Bord Project/.agents/teamwork_preview_explorer_survey_2
- Original parent: 55cbdb1e-cff2-4f60-8270-269b48e38f3e
- Milestone: live_integration_architecture_and_mutation_guardrails

## 🔒 Key Constraints
- Read-only investigation — do NOT implement
- DO NOT execute any mutating calls!
- DO NOT create, modify, close, or delete any work items, PRs, comments, or remote records.
- DO NOT modify source code files.

## Current Parent
- Conversation ID: 55cbdb1e-cff2-4f60-8270-269b48e38f3e
- Updated: 2026-10-19T05:42:00Z

## Investigation State
- **Explored paths**:
  - `new-app/.env`, `.env.example`, `people.json`
  - `src/infrastructure/azure/client.ts`, `work-item-service.ts`
  - `src/infrastructure/github/github-client.ts`, `src/domain/services/github-service.ts`
  - `src/infrastructure/config/file-config-repo.ts`, `src/container.ts`, `src/index.ts`
  - `src/application/use-cases/*` (`create-tasks`, `close-daily-tasks`, `plan-tasks`, `explore-tasks`, `get-status`, `repair-relations`)
  - `src/presentation/api/routes.ts`, `server.ts`
  - `scripts/verify-azure-*.mjs`, `scripts/staging-readonly-verify.mjs`
- **Key findings**:
  - Azure DevOps targets Org: `BFLDevOpsOrg`, Project: `3in1_Agile_Projects`. Uses PAT via Basic Auth.
  - Azure DevOps endpoints for validation, WIQL queries, work item retrieval with `$expand=relations`.
  - 4 external mutation points in Azure DevOps: Work item creation, relation copying, task closure/patching, ad-hoc creation.
  - GitHub targets Org: `3in1-AppFrontEnd`. Uses Bearer token.
  - GitHub integration is 100% read-only in code (search users, commits, PR issues). Zero GitHub mutation methods exist.
  - Guardrails: `dryRun` flags in `create-tasks` and `close-daily-tasks`, plan-only use cases, HTTP Basic viewer role (`API_VIEWER_USER`), scheduler disabled by default in `people.json`.
- **Unexplored areas**: None. Ready to formulate handoff.md.

## Key Decisions Made
- Fully documented all WIQL queries, API endpoints, credential mechanisms, and mutation hazards.
- Formulated exact safe read-only queries/scripts for live testing without any remote modifications.

## Artifact Index
- handoff.md — Comprehensive live integration & mutation guardrail report
