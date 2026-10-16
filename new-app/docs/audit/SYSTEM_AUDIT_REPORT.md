# System audit — current application

This is a historical, source-based audit of the maintained `new-app/` implementation, not a substitute for tests on the latest commit or for a live Azure DevOps verification.

## Architecture and runtime

The TypeScript codebase separates web/API presentation, application use cases, pure domain rules, and infrastructure adapters. The browser UI is a vanilla JavaScript SPA in `src/presentation/web/public/`; the API is in `src/presentation/api/`.

## Key user journeys to inspect

1. Configure an Azure DevOps connection and validate member assignments.
2. Inspect coverage in Task Explorer without mutating remote work items.
3. Preview a creation plan with the configured date window, person, and prefix.
4. Review a confirmation, execute the intended scope, and inspect partial failures.
5. Diagnose results in Audit Log and operational logs.
6. Enable unattended scheduling only after validating manual operation.

## Previously identified usability and reliability risks

| Risk | Expected control | Verification |
|---|---|---|
| Slow Azure DevOps requests block navigation | Independent, cancel-safe loading states and clear progress | Browser and network-throttle test required |
| Empty results confused with query failure | Separate empty/error/loading states | Browser test required |
| Repeated execute click | Disable and guard mutations while in progress | Integration and browser test required |
| Duplicate task creation | Server-side person/date checks and reconciliation | Automated regression and tenant review required |
| Incomplete relation copying | Journal each result and expose repair action | Automated test required |
| Exposed task mutation endpoints | Configure API authentication and HTTPS | Deployment audit required |
| TLS bypass | Never disable certificate verification | Verify environment and startup commands |

## Security correction

A previous revision of this report recommended setting `NODE_TLS_REJECT_UNAUTHORIZED=0` to work around corporate proxy errors. **That recommendation was unsafe and is withdrawn.** Install and trust the appropriate corporate CA certificate using supported Node.js/TLS configuration; investigate proxy or certificate-chain errors directly. No unverified claim is made that Azure connectivity was fixed by the bypass.

## Work remaining

- Audit real browser journeys with keyboard and screen-reader checks.
- Capture fresh test/build evidence on the current revision.
- Verify tenant-specific data, permissions, calendar behaviors, and unattended scheduling under controlled conditions.
- Address usability issues with focused, regression-tested changes before declaring the redesign complete.
