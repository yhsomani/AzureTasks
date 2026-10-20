# Scope: Milestone 3 (M3) Live Read-Only Azure DevOps API Connectivity & Data Retrieval

## Architecture & Boundaries
- Target Directory: `/Users/yashsomani/Desktop/Asure Bord Project/new-app`
- Credential Sources:
  - Environment File: `new-app/.env` (contains `AZURE_DEVOPS_PAT`, `AZURE_DEVOPS_ORG="BFLDevOpsOrg"`, `AZURE_DEVOPS_PROJECT="3in1_Agile_Projects"`, `NODE_EXTRA_CA_CERTS="/Users/yashsomani/Desktop/Asure Bord Project/new-app/certs/zscaler.pem"`)
  - Team Roster: `new-app/people.json`
- Strict Read-Only Constraint:
  - All API calls against Azure DevOps REST API v7.0 MUST be strictly read-only: HTTP GET or read-only WIQL query (`POST /_apis/wit/wiql`).
  - Zero work item creation, modification, transition, or deletion.
  - Zero remote data mutation.

## Feature Inventory (M3)
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 16 | Azure DevOps Organization & Project Connection | Live connectivity to Org: BFLDevOpsOrg, Project: 3in1_Agile_Projects (`GET /_apis/projects/3in1_Agile_Projects?api-version=7.0`) | M3 | survey |
| 17 | Work Item Schema Verification | Validates `3in1 Task` type, required fields, and state workflows (`scripts/verify-azure-schema.mjs` and `GET /3in1_Agile_Projects/_apis/wit/workitemtypes/3in1%20Task?api-version=7.0`) | M3 | survey |
| 18 | Team & Member Querying | Fetches team rosters and member identities from Azure DevOps (`GET /_apis/projects/3in1_Agile_Projects/teams?api-version=7.0` and `scripts/verify-azure-identities.mjs`) | M3 | survey |
| 19 | Iteration & Sprint Path Discovery | Queries project iteration paths and active sprints (`GET /3in1_Agile_Projects/_apis/work/teamsettings/iterations?api-version=7.0`) | M3 | survey |
| 20 | Work Item Tree & Link Hierarchy Query | WIQL tree queries and relation expansion (`$expand=relations`) without modifying any work item (`scripts/verify-azure-workitems.mjs`) | M3 | survey |
| 21 | Dry-Run Task Planning Engine | Verify task discovery and date window planning using the application CLI plan command (`npm start -- plan --all`), asserting zero remote creation | M3 | survey |
| 26-sub | Zero Mutation Audit | Verify that zero work items were created, modified, or transitioned during all queries | M3 | survey |

## Milestones / Verification Scopes
| # | Verification Sub-Scope | Script / Tool / Endpoint | Dependencies | Status |
|---|------------------------|--------------------------|--------------|--------|
| 1 | Org & Project Connection | `GET /_apis/projects/3in1_Agile_Projects?api-version=7.0` | none | IN_PROGRESS |
| 2 | Work Item Schema (`3in1 Task`) | `scripts/verify-azure-schema.mjs` & WIT API | 1 | IN_PROGRESS |
| 3 | Team & Member Identities | `scripts/verify-azure-identities.mjs` & Teams API | 1 | IN_PROGRESS |
| 4 | Iteration & Sprint Paths | Iterations API & team settings | 1 | IN_PROGRESS |
| 5 | Work Item Tree & Hierarchy | `scripts/verify-azure-workitems.mjs` & WIQL tree query | 1 | IN_PROGRESS |
| 6 | Application Plan Engine Dry-Run | `npm start -- plan --all` in `new-app` | 1, 2, 3, 4, 5 | IN_PROGRESS |
| 7 | Zero Mutation Verification | Verification of work item IDs before and after; git & audit logs | 1..6 | IN_PROGRESS |

## Interface Contracts
### Application ↔ Azure DevOps Service
- Protocol: HTTPS REST API v7.0
- Base URL: `https://dev.azure.com/BFLDevOpsOrg`
- Authentication: HTTP Basic Auth with PAT (`:AZURE_DEVOPS_PAT` in Base64)
- Read Endpoints:
  - `GET /_apis/projects/3in1_Agile_Projects?api-version=7.0`
  - `GET /3in1_Agile_Projects/_apis/wit/workitemtypes/3in1%20Task?api-version=7.0`
  - `GET /_apis/projects/3in1_Agile_Projects/teams?api-version=7.0`
  - `GET /3in1_Agile_Projects/_apis/work/teamsettings/iterations?api-version=7.0`
  - `POST /3in1_Agile_Projects/_apis/wit/wiql?api-version=7.0` (read-only query)
  - `GET /3in1_Agile_Projects/_apis/wit/workitems?ids={ids}&$expand=relations&api-version=7.0`
- Zero-Mutation Rule: Strictly no mutating calls.
