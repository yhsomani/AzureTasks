# 3in1 Task Studio

The **single supported application** in this repository is [`new-app/`](new-app/), an Azure DevOps task planning, creation, exploration, and automation studio.

## Getting started

Requires Node.js 22 or newer.

```bash
cd new-app
npm ci
cp .env.example .env
# Set a newly issued AZURE_DEVOPS_PAT with the minimum required scope.
# Keep .env local and never commit or share access tokens.
npm run dev
```

Open http://localhost:3000 to access the dashboard. For a non-mutating planning preview use `npm run dev -- plan`. Run automated tasks only after reviewing the planned changes.

## Quality checks

```bash
cd new-app
npm run typecheck
npm run lint
npm test
npm run build
```

CI runs these checks for the supported application.

## Documentation

- [Product direction and feature decisions](new-app/docs/PRODUCT_DIRECTION.md)
- [Setup, commands, deployment, and security](new-app/README.md)
- [Current product requirements](new-app/PRD.md)
- [UI redesign audit and user journeys](new-app/docs/UX_REDESIGN.md)
- [Feature inventory and navigation](new-app/docs/FEATURE_INVENTORY.md)
- [Architecture](new-app/docs/ARCHITECTURE.md)
- [Workflows](new-app/docs/WORKFLOWS.md)
- [Design system](new-app/docs/DESIGN_SYSTEM.md)
- [Test evidence](new-app/docs/TEST_RESULTS.md)
- [Production readiness](new-app/docs/PRODUCTION_READINESS.md)

Source code, configuration templates, tests, and active documentation are maintained under `new-app/`. Previous implementations and their standalone audits are not part of the supported repository layout.

## Security

**Rotate any PAT or GitHub token shared in a chat, log, screenshot, or public repository.** Configure TLS using trusted certificate authorities, not `NODE_TLS_REJECT_UNAUTHORIZED=0`. Restrict web/API access with `API_AUTH_TOKEN` and HTTPS or an authenticating proxy. Do not run unattended work-item mutations until credentials, identities, and selected tasks have been verified.

## Release verification

Current release evidence and outstanding production acceptance checks are tracked in [Release acceptance ledger](new-app/docs/RELEASE_VERIFICATION.md). GitHub Actions passing does not establish live Azure DevOps validation.
