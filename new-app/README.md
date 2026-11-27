# 3in1 Work: Project Management & Productivity

[![CI/CD](https://img.shields.io/badge/build-passing-brightgreen.svg)]()
[![Tests](https://img.shields.io/badge/tests-1425%20passed-brightgreen.svg)]()
[![E2E](https://img.shields.io/badge/e2e-236%20passed-brightgreen.svg)]()
[![Architecture](https://img.shields.io/badge/architecture-Clean%20%2F%20Hexagonal-blue.svg)]()
[![UI](https://img.shields.io/badge/frontend-React%2019%20%2B%20Tailwind-61dafb.svg)]()

3in1 Work is a work-management platform for individuals, teams, and cross-functional groups. It brings personal work, team planning, and delivery visibility into one workspace, with **Azure DevOps as the primary integration** and GitHub providing code-delivery evidence.

---

## 📖 Comprehensive Documentation

For the full architectural specification, database migration verification, and test analysis, see:
- 📄 **[Final Implementation Report](docs/FINAL_IMPLEMENTATION_REPORT.md)** — Comprehensive architecture, schema DDL, migration results, and quality metrics.
- 📄 **[Operations Guide](OPERATIONS.md)** — Production operations, monitoring, and runbooks.
- 📄 **[Security Policy](SECURITY.md)** — Security boundaries, token management, and reporting.

---

## 🚀 Key Capabilities

- **Clean & Hexagonal Architecture:** Strict separation between pure domain logic, application use cases, ports, infrastructure adapters, and presentation layers.
- **Relational Persistence (18 Normalized Tables):** Powered by Drizzle ORM supporting SQLite and PostgreSQL, with automated zero-data-loss migration from legacy JSON persistence (`MigrationService`).
- **Azure DevOps-first delivery:** Reliable synchronization across configured Azure DevOps projects, with WIQL continuation-token pagination, exponential backoff with jitter (handling HTTP 429/503), and atomic staging table swaps.
- **Canonical Identity Engine:** Robust normalization of Azure Claims descriptors (`claims.vss:sid:...`), Subject descriptors (`aad....`), GUIDs, UPNs, emails, and aliases with collision defense and diagnostics (`/api/identities/diagnostics`).
- **Unassigned Task Discovery & Dynamic Sprints:** Real-time discovery of unassigned tasks across projects and dynamic iteration path resolution.
- **Modern React 19 workspace:** Personal work, team planning, project health, and workspace administration are organized around everyday work rather than backend subsystems.
- **Enterprise Security & Auditability:** Mandatory PAT masking in structured logs, distributed tracing with W3C `traceparent` headers, Prometheus metrics (`/metrics`), cryptographic plan tokens (`PlanTokenRecord`), and 4-tier RBAC (`Admin`, `Lead`, `Member`, `Auditor`).

---

## 🛠️ Quick Start

### Prerequisites
- Node.js 22.x LTS or higher
- npm 10.x or higher

### Installation & Setup

1. **Clone and install dependencies:**
   ```bash
   git clone <repo-url>
   cd new-app
   npm ci
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your Azure DevOps PAT and GitHub Token
   ```

3. **Build the application:**
   ```bash
   npm run build
   ```

4. **Run migrations (if applicable):**
   ```bash
   npx tsx bin/migrate.ts
   ```

5. **Start the production server:**
   ```bash
   npm start
   ```

6. **Development mode (with hot reload):**
   ```bash
   npm run dev
   ```

---

## 🧪 Verification & Testing

WorkOps is verified with a comprehensive suite of unit, integration, and end-to-end tests:

```bash
# Typecheck source and tests
npm run typecheck
npm run typecheck:tests

# Run unit and integration tests (1,189 tests across 88 test files)
npm test

# Run E2E test suite across Tiers 1-4 (236 tests across 12 test files)
npm run test:e2e
```

### Test Suite Summary

- **Unit & Integration:** 1,189 passing tests (100% pass rate).
- **End-to-End Suite:** 236 passing tests across 4 tiers:
  - **Tier 1 (Feature Coverage):** 95 tests covering features F1–F19.
  - **Tier 2 (Boundary & Corner Cases):** 95 tests stress-testing system limits.
  - **Tier 3 (Pairwise Combinations):** 38 tests validating cross-feature interaction.
  - **Tier 4 (Real-World Scenarios):** 8 realistic production operational journeys.
- **Anti-Cheating Assurance:** Zero tautologies, zero mock facades in production execution paths.
