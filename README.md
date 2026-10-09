# Azure DevOps 3in1 Task Creator

Two codebases live here:

| Path | What it is | Status |
|---|---|---|
| [`new-app/`](new-app/) | Production rebuild — hexagonal/DDD, TypeScript (ESM, Node ≥ 22), Express 5, dependency-free SPA, CLI + scheduler | ✅ Active. 76 tests green, build clean |
| [`Legacy/`](Legacy/) | The original implementation, preserved and independently runnable | 🗄️ Reference only |

`new-app/` has **zero runtime dependency** on `Legacy/`.

## Quick start (new app)

```bash
cd new-app
npm install
cp .env.example .env      # set AZURE_DEVOPS_PAT (Work Items: Read & Write)
npm run dev               # web dashboard at http://localhost:3000
npm run dev -- plan       # dry run
npm run dev -- run --all --yes
npm test
```

Full setup, configuration, deployment, and rollback: [`new-app/README.md`](new-app/README.md).

## Quick start (legacy)

```bash
cd Legacy
npm install
npm run ui        # or: npm start / npm run dry-run
```

## Documentation

- **New app** — [`new-app/docs/`](new-app/docs/):
  [Architecture](new-app/docs/ARCHITECTURE.md) ·
  [Feature parity](new-app/docs/FEATURE_PARITY.md) ·
  [Workflows](new-app/docs/WORKFLOWS.md) ·
  [Design system](new-app/docs/DESIGN_SYSTEM.md) ·
  [Test results](new-app/docs/TEST_RESULTS.md) ·
  [Council review](new-app/docs/COUNCIL_REVIEW.md) ·
  [Production readiness](new-app/docs/PRODUCTION_READINESS.md) ·
  [Legacy recovery](new-app/docs/LEGACY_RECOVERY.md)
- **Audit of the original** — [`Docs/`](Docs/):
  executive summary, comprehensive audit, specialist findings.

## History

- `f819fa8` — legacy preserved
- `1ddbcb7` — greenfield rebuild
- `5184b4b` — real relation repair
- `2361532` — UI label fix
