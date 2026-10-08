# Azure DevOps 3in1 Multi-Person Task Auto-Creation Utility

A production-grade TypeScript / Node.js automation utility designed to automatically create daily copies of Azure DevOps `3in1 Task` work items for **one, multiple, or all configured team members**.

Each person is treated as an **independent task stream** with their own source task, latest date, duplicate protection, task history, and assignment.

---

## Key Features & Business Rules

1. **Multi-Person Support & Person Isolation**:
   - Supports creating tasks for:
     - Single person: `--person "Rahul"` or `--person person1`
     - Multiple selected people: `--person "Rahul,Priya"`
     - All configured people: `--all`
   - **Independent Streams**: Person A's source task, latest date, duplicates, and failure/success status never leak or affect Person B.
   - Distinct people can have tasks with identical titles on the same date (e.g. `3in1_PWA_MyAccount | 9 Oct` for Rahul and Priya).

2. **Person-Level Source Task Discovery & Gap Filling**:
   - For each person, searches project `3in1_Agile_Projects` for `3in1 Task` items matching `3in1_PWA_MyAccount | <D MMM>` assigned to that person.
   - Evaluates the **chronologically latest task** as template based on the embedded date.
   - **Separation of Source Selection from Date Planning**: If a person has a future-dated task (e.g. 16 Oct), it does NOT hide or skip earlier missing working dates in the rolling window. Missing dates (e.g. 13 Oct) are detected and filled!
   - Supports per-person source task overrides in `people.json` via `"sourceTaskId": 12345`.

3. **Rolling Creation Window (`today` → `next Thursday`)**:
   - Evaluates every working day from today through the upcoming Thursday.
   - **Configurable Thursday Mode**:
     - `CURRENT` (default): A run on Thursday ends today.
     - `FOLLOWING`: A run on Thursday includes the following Thursday.
   - Saturday and Sunday are **always skipped** and never created or scheduled.

4. **Authoritative Duplicate Prevention**:
   - Duplicate key: `AssignedTo + Date + TitlePrefix + Project + WorkItemType`.
   - Before creating any task for a person on a date, verifies that Azure DevOps does not already have a matching task assigned to that person.
   - Distinguishes `DUPLICATE_ALREADY_EXISTS` (1 existing task) and `MULTIPLE_EXISTING_TASKS` (>1 existing tasks).

5. **Field Copy Policy with Mandatory Overrides**:
   - Copies user-editable fields: Description, Acceptance Criteria, Priority, Tags, Area Path, Iteration Path, Original Estimate, and custom project fields (`Custom.*`).
   - Excludes internal system audit fields (`System.Id`, `System.Rev`, `System.CreatedDate`, `System.CreatedBy`, `System.ChangedDate`, `System.Watermark`, etc.).
   - Resets historical progress: `CompletedWork` is reset so historical effort is not duplicated into fresh daily tasks.
   - Mandatory Overrides:
     - **Title**: `3in1_PWA_MyAccount | <D MMM>` (never contains person name)
     - **Assigned To**: Explicitly set to the person's identity (`System.AssignedTo`)
     - **State**: Always set to `New`
     - **Start Date / Time**: Set to assigned date at `09:30 AM` (`Microsoft.VSTS.Scheduling.StartDate`)
     - **Close**: Left open for manual completion (never auto-closed).

6. **Two-Phase Relationship Copying with Child Protection**:
   - **Phase 1**: Creates the new work item with fields.
   - **Phase 2**: Recreates supported relationships: Parent User Story (`Hierarchy-Reverse`), `Related`, Predecessor/Successor, Hyperlinks, Artifact links.
   - **Child Hierarchy Protection**: Forward child relationships (`Hierarchy-Forward`) are strictly **excluded** from copying. Azure DevOps only permits a child to have one parent; re-linking would steal the child from the source work item.
   - Excludes binary file attachments (`AttachedFile`) by default to avoid storage bloat.
   - Partial link failures are isolated and never delete the created task.

7. **Concurrency & Network Resilience**:
   - **Execution Lock**: Local file lock (`.task-creator.lock`) with PID and stale lock detection prevents simultaneous runs.
   - **Uncertain Create Reconciliation**: If network fails during a create POST request, automatically queries Azure DevOps by `Assignee + Title` to recover the created work item ID before retrying, preventing accidental duplicates.
   - **Execution Journal & Repair**: Local journal (`.task-journal.json`) records runs and enables `--repair` to re-apply incomplete relations.
   - Zero credential leakage: PAT is scrubbed across all logs, errors, and URLs.
   - Enterprise corporate proxy SSL support.

---

## Architecture Overview

```
azure-3in1-task-creator/
├── src/
│   ├── index.ts                      # CLI entry point, argument parsing, secret loading
│   ├── config/
│   │   ├── config.ts                 # App configuration schema & people.json loader
│   │   └── constants.ts              # System field exclusions & relation types
│   ├── azure/
│   │   ├── types.ts                  # Azure DevOps REST API interfaces
│   │   ├── client.ts                 # HTTP client with Basic Auth, retries & PAT scrubbing
│   │   ├── wiql-service.ts           # WIQL queries for task search & duplicate check
│   │   └── work-item-service.ts      # Work item batch retrieval, creation, and reconciliation
│   ├── people/
│   │   └── person-service.ts         # Identity normalization, assignee matching, selection
│   ├── date/
│   │   ├── types.ts                  # Date models and planned task types
│   │   ├── parser.ts                 # Date parsing (<D MMM>, leap years, rollover)
│   │   └── date-engine.ts            # Window planning, weekend filtering, next Thursday
│   ├── task/
│   │   ├── task-discovery.ts         # Person-level source discovery & independent streams
│   │   ├── duplicate-detector.ts     # Assignee-scoped duplicate detection
│   │   ├── field-copy.ts             # Field filtering, AssignedTo override, Title, State
│   │   ├── relation-copy.ts          # Relation filtering & child hierarchy protection
│   │   ├── journal.ts                # Non-authoritative execution journal
│   │   └── task-orchestrator.ts      # Multi-person orchestrator & Section 29 reporting
│   └── utils/
│       ├── lock.ts                   # Concurrency execution lock with PID check
│       ├── logger.ts                 # Colorized logger with automatic credential scrubbing
│       ├── prompt.ts                 # Secure CLI masked input and confirmation prompt
│       └── retry.ts                  # Exponential backoff with jitter and Retry-After
├── tests/
│   ├── date-engine.test.ts           # Exhaustive date engine & gap tests
│   ├── date-parser.test.ts           # Date parser and leap year tests
│   ├── person-service.test.ts        # Assignee matching and selection tests
│   ├── duplicate-detector.test.ts    # Multi-person duplicate isolation tests
│   ├── task-discovery.test.ts        # Per-person source discovery tests
│   ├── field-copy.test.ts            # Field copying and AssignedTo override tests
│   ├── relation-copy.test.ts         # Relation copying & child link protection tests
│   ├── lock-and-journal.test.ts      # Execution lock and journal recovery tests
│   └── task-orchestrator.test.ts     # Multi-person orchestrator simulation tests
│   └── task-orchestrator.test.ts     # Multi-person scenario, dry-run, and isolation tests
├── people.json                       # Configured team members
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```

---

## Configuration

### 1. People Configuration (`people.json`)
Configure your team members in `people.json`:

```json
{
  "people": [
    {
      "name": "Yash Somani",
      "assignedTo": "yash.somani@bajajfinserv.in"
    },
    {
      "name": "Rahul Sharma",
      "assignedTo": "rahul.sharma@bajajfinserv.in",
      "sourceTaskId": 10594120
    }
  ]
}
```

### 2. PAT Configuration (`.env`)
Create `.env` file (which is git-ignored):
```ini
AZURE_DEVOPS_PAT=your_azure_devops_pat_here
```

---

## Usage Modes

### 1. Interactive Web Studio UI & Dashboard (Default Mode)
Simply run:
```bash
npm start
```
Or explicitly:
```bash
npm run ui
```
Open **`http://localhost:3000`** in any web browser.

**Web Studio Features**:
- **In-App PAT Management**: Securely input and rotate your Azure DevOps PAT directly from the Web Studio without modifying `.env` or terminal environment variables.
- **Automated Daily Scheduler**: Built-in toggle to run automated daily task replication at 09:30 AM IST every weekday.
- **Connection Health Indicator**: Live verification of Azure DevOps PAT, organization, and project.
- **Interactive Task Matrix**: Visual grid of working dates vs team members showing:
  - `✓ #10594120`: Task already exists (with direct link to Azure DevOps)
  - `+ Create (09:30)`: Planned task for upcoming working day
  - `Weekend`: Saturday/Sunday automatically skipped
  - `No Source`: Member has no template task
- **Next Cycle Simulation**: 1-click preview of future rolling windows.
- **Team Management**: Add, edit, disable, or delete team members in `people.json`.
- **Live Execution Console**: Real-time terminal drawer streaming creation progress and Azure DevOps IDs.
- **Execution Journal & Repair**: Inspect past runs, export audit logs to CSV or JSON, and run 1-click relationship repair.
- **Dark & Light Mode**: Toggle themes with persistence.

---

### 2. Built-in Daily Automated Scheduler Daemon
Run the task creation utility as a persistent background daemon:
```bash
npm run daemon
```
- Automatically triggers every weekday (Mon-Fri) at 09:30 AM IST.
- Automatically skips weekends and holidays.
- Re-checks existing tasks and prevents duplicate execution if already run.
- Graceful shutdown with `Ctrl+C`.

---

### 3. CLI Usage

#### Dry-Run Simulation (Multi-Person Preview)
```bash
# Preview all configured people:
npm run dry-run -- --all

# Preview a specific person:
npm run dry-run -- --person "Yash Somani"

# Preview rolling window with FOLLOWING Thursday:
npm run dry-run -- --thursday-mode FOLLOWING
```

#### Normal Execution (Interactive Confirmation)
```bash
# Run for all configured people:
npm run create-tasks -- --all

# Run for specific people:
npm run create-tasks -- --person "Rahul Sharma,Yash Somani"
```

#### Automated / Headless Execution (CI/CD or Cron)
```bash
# Process all people without confirmation prompt:
npm run create-tasks -- --all --yes

# Repair incomplete relationships from journal:
npm run create-tasks -- --repair
```

---

### 4. Production Build & Execution
Build the self-contained production bundle with frontend assets:
```bash
npm run build
npm run start:prod
```
The application will be compiled into `dist/` with all static assets copied to `dist/ui/`, completely executable via `node dist/index.js`.

---

## Final Multi-Person Summary Format

```text
==================================================
AZURE DEVOPS 3in1 TASK CREATION SUMMARY
==================================================
Organization : BFLDevOpsOrg
Project      : 3in1_Agile_Projects
Work Item    : 3in1 Task

Window:
12 Oct 2026 → 15 Oct 2026

People processed  : 3

Tasks:
Created           : 11
Duplicates        : 1
Weekend skips     : 0
Source failures   : 0
Task failures     : 0
Relation failures : 0

--------------------------------------------------
Person A (personA@company.com)
--------------------------------------------------
Source : #1001 (9 Oct)
Created: 4
Skipped: 0
Failed : 0
  #5001     3in1_PWA_MyAccount | 12 Oct
  #5002     3in1_PWA_MyAccount | 13 Oct
  #5003     3in1_PWA_MyAccount | 14 Oct
  #5004     3in1_PWA_MyAccount | 15 Oct

--------------------------------------------------
Person B (personB@company.com)
--------------------------------------------------
Source : #2001 (8 Oct)
Created: 4
Skipped: 0
Failed : 0
  #5005     3in1_PWA_MyAccount | 12 Oct
  #5006     3in1_PWA_MyAccount | 13 Oct
  #5007     3in1_PWA_MyAccount | 14 Oct
  #5008     3in1_PWA_MyAccount | 15 Oct

--------------------------------------------------
Person C (personC@company.com)
--------------------------------------------------
Source : #3001 (12 Oct)
Created: 3
Skipped: 1
Failed : 0
  [DUPLICATE] 12 Oct - Task already exists (#3001)
  #5009     3in1_PWA_MyAccount | 13 Oct
  #5010     3in1_PWA_MyAccount | 14 Oct
  #5011     3in1_PWA_MyAccount | 15 Oct
==================================================
```

---

## Running Automated Tests

```bash
# Run all 61 tests in Vitest:
npm test

# Build compiled JavaScript:
npm run build

# TypeScript strict type checking:
npm run typecheck
```
