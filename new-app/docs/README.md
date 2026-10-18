# Documentation and evidence guide

The only supported application is `new-app/`. Use this index to avoid mistaking historical audit reports or design plans for a successful production verification.

## Authoritative current references

1. [Application setup, API, CLI and operational commands](../README.md)
2. [Release verification and go/no-go evidence ledger](RELEASE_VERIFICATION.md)
3. [Features and navigation responsibilities](FEATURE_INVENTORY.md)
4. [Architecture and domain boundaries](ARCHITECTURE.md)
5. [Workflows and recovery behavior](WORKFLOWS.md)
6. [Security and role limits](SECURITY.md)
7. [Design system](DESIGN_SYSTEM.md)

## Historical references — research, not release proof

`../PRD.md`, `PRODUCT_AUDIT.md`, `PRODUCT_DIRECTION.md`,
`PRODUCTION_READINESS.md`, `COUNCIL_REVIEW.md`, `TEST_RESULTS.md`,
`SCENARIOS_VERIFIED.md`, `UX_REDESIGN.md`, files under `audit/`, and
`superpowers/plans/` describe earlier requirements, audit observations,
migration decisions and individual CI snapshots. Keep them for traceability;
do **not** mark a current feature complete solely from a historical checkbox.

## Product journey

```
Application
├── Observe
│   ├── Dashboard → connection/readiness → real coverage or explicit error
│   ├── My Work → member selection → current Azure work items
│   ├── Explorer → period/member coverage → inspect → confirmed creation
│   └── Burndown → recorded effort only → missing hours distinguished
├── Plan and Create
│   ├── Select members → preview source / dates / duplicate gaps
│   ├── Confirm in UI and API → Azure create → relation copy
│   └── Remote read-back → audit record / partial recovery warning
├── Automate (opt-in)
│   ├── Configure schedule → persist → enable timer
│   └── EOD preview → authorized current-day closure through Azure rules
├── Administer
│   ├── Team → validated identity, independent task source and GitHub scope
│   └── Settings → organization/project, external secrets, opt-in policies
└── Recover and Verify
    ├── Journal → archived evidence → relation repair
    ├── Logs → inspect failures and scheduled attempts
    └── Release ledger → automated checks vs production evidence
```

This describes feature interactions, not a certification that live data is
available or that any production work item has been created or closed safely.
Operator credential rotation, HTTPS/proxy, backup restoration, tenant write
tests, enterprise SSO/RBAC and exact deployment sign-off remain external
release gates.
