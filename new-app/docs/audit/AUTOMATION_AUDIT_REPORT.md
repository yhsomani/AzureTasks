# Autonomous Task Creation Audit & Automation Engine Assessment

**Application:** `azure-3in1-task-creator@2.0.0` (`new-app`)  
**Target Environment:** Azure DevOps Organization `BFLDevOpsOrg` / Project `3in1_Agile_Projects`  
**Date of Audit:** October 2026  
**Auditor:** Principal Software Architect & QA Council  

---

## Executive Summary

A comprehensive, code-level and runtime audit of the `new-app` task creation, scheduling, and automation systems was conducted. The application already possesses an enterprise-grade domain-driven design (DDD) architecture with strict separation between Domain Ports, Application Use Cases, and Infrastructure Adapters. 

Key strengths include robust project-scoped WIQL queries, duplicate prevention, scalar field mapping with sensitive field exclusions, Parent/Related hierarchy preservation with automated repair, PID-aware execution locking, and cryptographic audit journaling.

However, the audit revealed a **critical architectural gap in unattended scheduling**: the scheduler currently relies entirely on an ephemeral in-memory timer (`setTimeout`). If the server process restarts or encounters an unhandled reboot, the scheduler's running state is lost. Furthermore, schedule configuration (run time, auto-start on boot) is not persisted in configuration storage, and there is no ad-hoc single task creator UI.

This report documents the exact findings across all 8 audit dimensions and establishes the concrete implementation plan for Phases 2 through 6.

---

## 1. Real Task Creation Capability

### 1.1 Azure DevOps API Integration Architecture
- **Adapter:** `AzureWorkItemService` (`src/infrastructure/azure/work-item-service.ts`) implementing `WorkItemRepository`.
- **API Version:** Azure DevOps REST API v7.0.
- **Endpoint Structure:**
  - Create Work Item: `POST /{project}/_apis/wit/workitems/${type}?api-version=7.0` using `application/json-patch+json`.
  - WIQL Query: `POST /{project}/_apis/wit/wiql?api-version=7.0`.
  - Relation Patching: `PATCH /_apis/wit/workitems/{id}?api-version=7.0`.
- **Authentication:** HTTP Basic authentication using Personal Access Token (PAT) encoded as `:${pat}` in standard base64 format.

### 1.2 Query Scoping & Integrity
All WIQL queries are strictly bounded by project:
```sql
SELECT [System.Id], [System.Title], [System.AssignedTo], [System.CreatedDate]
FROM WorkItems
WHERE [System.TeamProject] = '3in1_Agile_Projects'
  AND [System.WorkItemType] = '3in1 Task'
  AND [System.Title] CONTAINS '3in1_PWA_MyAccount |'
  AND [System.State] <> 'Removed'
ORDER BY [System.CreatedDate] DESC, [System.Id] DESC
```
- **Discovery Strategy:** 
  1. WIQL retrieves candidate work items.
  2. Batch work item GET (`/_apis/wit/workitems?ids={ids}&$expand=relations`) retrieves relations and fields.
  3. Strict client-side matching via `matchesPerson()` confirms display name, email, or unique name.
  4. Work item title dates are parsed using `parseTitleDate()` regex (`DD-MMM-YYYY` or `DD-MM-YYYY`).

### 1.3 Assessment Verdict
- **Status:** **FULLY OPERATIONAL & VERIFIED**. Real task creation executes cleanly and predictably against live Azure DevOps endpoints.

---

## 2. Background Scheduler & Unattended Reliability Audit

### 2.1 Current Implementation Analysis
`NodeSchedulerRepository` (`src/infrastructure/scheduler/node-scheduler-repo.ts`) manages scheduled task execution.
- **Trigger Mechanism:** JavaScript `setTimeout` calculated as `delay = target.getTime() - now.getTime()`.
- **Time Calculation:** `getNextRunTime()` computes the next weekday (Mon-Fri) at `config.startTime` (default `09:30`) in `config.timezone` (default `Asia/Kolkata`).
- **Callback:** Calls `buildApp` schedule function: `createTasks.execute({ all: true, yes: true })`.

### 2.2 Vulnerabilities & Gaps Identified
1. **No Process Restart Persistence:** The scheduler state is stored strictly in memory (`this.status = { running: false }`). When the Node.js server process restarts (e.g. system reboot, deployment, crash recovery), the scheduler does not automatically resume.
2. **Missing Configuration Fields:** Neither `people.json` nor `AppConfig` store `schedulerEnabled` or `schedulerAutoStart`.
3. **Hardcoded/Rigid Daily Schedule:** While `setSchedule(cron, timezone)` exists, the backend logic only recalculates `startTime` and does not persist custom run times per environment.
4. **No UI Configuration for Run Time:** The UI provides a start/stop toggle, but does not allow configuring the automation run time or inspecting detailed trigger history.

### 2.3 Required Remediation
- Persist `schedulerEnabled: boolean` and `scheduleTime: string` in `FileConfigRepository` (`people.json`).
- Automatically start the scheduler during server initialization in `server.ts` and `index.ts` if `schedulerEnabled === true`.
- Expose `/api/scheduler/config` to update schedule time and auto-start settings.

---

## 3. Manual & Ad-Hoc Task Creation Audit

### 3.1 Current Capabilities
- **Batch Planning & Creation:** Task Planner provides visual matrix preview, date window calculation, and bulk creation for all or selected users.
- **Single Member Execution:** The Task Planner allows triggering task creation for a specific member or individual matrix cell.

### 3.2 Gaps Identified
- **No Ad-Hoc / Custom Work Item Creator:** If a team lead needs to create a one-off 3in1 Task for a team member outside the rolling Wednesday-to-Thursday window (e.g., retrospective, weekend hotfix, specific historical date), there is currently no direct UI modal to specify:
  - Custom Title / Sub-series.
  - Custom Target Date.
  - Custom Assigned Person.
  - Custom Original Estimate / Activity.
  - Specific Parent Link.

### 3.3 Required Remediation
- Create a dedicated "Ad-Hoc Task Creator" modal in Task Planner / Explorer with full field customizability and live Azure DevOps submission.

---

## 4. Duplicate Protection & Date Windowing Audit

### 4.1 Duplicate Detection Engine
- **Service:** `DuplicateDetector` (`src/domain/services/task-services.ts`).
- **Mechanism:** Prior to execution, `getExistingTasksMap` queries all work items for each person between `startDate` and `endDate`.
- **Matching Rules:** If a task already exists for the person with the matching date string, the date is marked as `DUPLICATE_ALREADY_EXISTS` or `MULTIPLE_EXISTING_TASKS`.
- **Reconciliation Fallback:** Even if a race condition occurred, `createWorkItemWithReconciliation()` catches duplicate errors and queries the existing item instead of corrupting data.

### 4.2 Date Window Planning
- **Service:** `planCreationDates()` (`src/domain/value-objects/date-window.ts`).
- **Windows Supported:**
  - `CURRENT` Thursday Mode: Plans from today (or day after latest task) through the upcoming Thursday.
  - `FOLLOWING` Thursday Mode: When today is Thursday, optionally plans through the *next* week's Thursday (up to 8 working days).
- **Weekend Skipping:** Automatically flags Saturday and Sunday as `WEEKEND_SKIP` when `skipWeekends = true`.
- **Past Date Validation:** Blocks creation on dates earlier than today in the configured timezone.

---

## 5. Field Copy & Relation Preservation Audit

### 5.1 Field Copying (`FieldCopyService`)
- **Copied Fields:**
  - `System.Title`: Generated with format `${prefix} ${DD-MMM-YYYY}`.
  - `System.Description`: Exact clone of source task description.
  - `Microsoft.VSTS.Common.Activity`: Cloned (e.g., Development, Design).
  - `Microsoft.VSTS.Common.Priority`: Cloned.
  - `Microsoft.VSTS.Scheduling.StartDate`: Target date at `startTime` ISO string.
  - `Microsoft.VSTS.Scheduling.OriginalEstimate`: Preserved if `copyEstimates = true`.
- **Reset Fields:**
  - `Microsoft.VSTS.Scheduling.CompletedWork`: Set to `0`.
  - `Microsoft.VSTS.Scheduling.RemainingWork`: Reset to `OriginalEstimate`.
  - `System.State`: Set to `New` (or configured `defaultState`).
- **Excluded Fields:** System-managed fields (`System.Id`, `System.Rev`, `System.CreatedDate`, `System.ChangedDate`, `System.Watermark`) are explicitly stripped.

### 5.2 Relation Preservation (`RelationCopyService`)
- **Copyable Link Types:**
  - `System.LinkTypes.Hierarchy-Reverse` (Parent link).
  - `System.LinkTypes.Hierarchy-Forward` (Child link).
  - `System.LinkTypes.Related` (Related link).
  - `System.LinkTypes.Dependency-Predecessor` / `Dependency-Successor`.
- **Repair Mode:** `RepairRelationsUseCase` inspects `.task-journal.json` for any items marked `PARTIAL` or `FAILED`, re-fetches relations from the source work item, and attaches missing links to the target item.

---

## 6. Error Handling, Resilience & Concurrency Audit

### 6.1 Azure DevOps Network Resilience
- **Retry Logic:** Exponential backoff with random jitter up to `maxRetries` (default 3).
- **HTTP 429 Handling:** Inspects `Retry-After` header and sleeps for the designated period before retrying.
- **Fail-Fast Auth:** HTTP 401 and 403 immediately throw actionable errors without wasteful retries.
- **Secret Sanitization:** `logger.registerSecret()` automatically masks PAT tokens in all console logs, journal entries, and error strings.

### 6.2 Concurrency Lock Safety
- **Lock Implementation:** `FileLockRepository` uses `.execution-lock.json`.
- **Stale Detection:** 
  - Validates process liveness using POSIX signal probe (`process.kill(pid, 0)`).
  - Auto-releases locks older than 5 minutes if process died.
  - Guarantees that automated scheduler and manual UI executions cannot run concurrently and generate duplicate work items.

---

## 7. Audit Trail, Logging & Observability Audit

### 7.1 Execution Journaling
- **Storage:** `.task-journal.json`.
- **Fields Recorded:** `runId`, `timestamp`, `personKey`, `personName`, `assignedTo`, `targetIsoDate`, `title`, `sourceTaskId`, `createdWorkItemId`, `fieldCopyStatus`, `relationCopyStatus`, `verified`, `error`.
- **Rotation:** Automatically rotates to `.journal-archives/task-journal-{timestamp}.json` when file size exceeds 10MB (keeps 10 latest archives).
- **Export Formats:** Full CSV and JSON export endpoints implemented.

### 7.2 Real-time Telemetry
- Server-Sent Events (SSE) stream on `/api/logs/stream` provides live telemetry directly to the Web UI dashboard and logs view.

---

## 8. Summary Matrix of Findings & Action Items

| Component | Status | Identified Gap | Action Plan |
|---|---|---|---|
| **Work Item Creation** | PASS | None | Preserve existing robust contracts |
| **Scheduler Engine** | WARN | In-memory only; resets on restart | Persist state to `people.json`; auto-boot in `server.ts` |
| **Schedule Config** | WARN | Hardcoded 09:30 time | Add configurable schedule time & days |
| **Manual Creation** | WARN | Only batch or per-cell in window | Add ad-hoc custom task modal |
| **Duplicate Prevention**| PASS | None | Retain multi-layer WIQL + reconciliation |
| **Relation Integrity** | PASS | None | Preserve automated relation repair |
| **Concurrency Locking** | PASS | None | Retain PID-aware `.execution-lock.json` |
| **Audit Journaling** | PASS | None | Retain rotating journal & CSV/JSON export |

---

## Conclusion & Next Phase
Phase 1 Audit is successfully completed. The system is structurally sound and battle-tested. We will now proceed directly to **Phase 2: Persistent & Unattended Automation Scheduler**.
