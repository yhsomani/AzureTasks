# Scope: Milestone 4 — Live Read-Only GitHub API Connectivity & PR Activity Retrieval

## Architecture
- Target directory: `/Users/yashsomani/Desktop/Asure Bord Project/new-app`
- GitHub API client module(s) (e.g. in `src/github/` or `src/services/`)
- Configuration: `.env` (`GITHUB_TOKEN`, `GITHUB_ORG="3in1-AppFrontEnd"`, `GITHUB_USER_SUFFIX="_bflghec"`, `NODE_EXTRA_CA_CERTS="/Users/yashsomani/Desktop/Asure Bord Project/new-app/certs/zscaler.pem"`)
- Team roster mapping: `people.json`
- CLI command: `npm start -- close-today --dry-run --all`

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | GitHub Org Validation | Live HTTP GET /orgs/3in1-AppFrontEnd via GitHub REST API v3 using GITHUB_TOKEN | M4 | DISPATCH |
| 2 | Repository Querying | Retrieve public/internal repository listings (GET /orgs/3in1-AppFrontEnd/repos?per_page=10) | M4 | DISPATCH |
| 3 | EMU Resolution | Deterministic EMU login resolution (e.g. yash.somani@bajajfinserv.in -> yash-somani_bflghec) & user lookup | M4 | DISPATCH |
| 4 | PR Activity Search | Search PR activity authored by team members in 3in1-AppFrontEnd (GET /search/issues?q=type:pr+org:3in1-AppFrontEnd...) | M4 | DISPATCH |
| 5 | EOD Task Closure Dry-Run | npm start -- close-today --dry-run --all: PR deliverables fetched & formatted into HTML, zero remote mutations | M4 | DISPATCH |
| 6 | Mutation Audit Verification | Verify zero records created, modified, or deleted on GitHub or Azure DevOps during all operations | M4 | DISPATCH |

## Milestones & Work Items
| # | Name | Scope | Dependencies | Status |
|---|------|-------|--------------|--------|
| M4.1 | Org Connection Validation | Validate GET /orgs/3in1-AppFrontEnd | none | PLANNED |
| M4.2 | Repository Querying | Validate GET /orgs/3in1-AppFrontEnd/repos | M4.1 | PLANNED |
| M4.3 | EMU Resolution & Lookup | Test resolution and user lookup | M4.1 | PLANNED |
| M4.4 | PR Activity Search | Query PRs authored by team members | M4.2, M4.3 | PLANNED |
| M4.5 | EOD Task Closure Dry-Run | Execute dry-run closure simulation | M4.4 | PLANNED |
| M4.6 | Mutation Audit Verification | Attest 100% read-only integrity | M4.5 | PLANNED |

## Interface Contracts
- Input config: GITHUB_TOKEN, GITHUB_ORG, GITHUB_USER_SUFFIX, NODE_EXTRA_CA_CERTS
- Input roster: people.json
- Output verification: Live API status codes (200 OK), real repository names/counts, verified EMU usernames, retrieved PR metadata, CLI dry-run logs showing zero writes.
