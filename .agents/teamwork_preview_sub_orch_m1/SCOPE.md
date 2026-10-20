# Scope: M1 - Architecture & Operational Boundaries Verification

## Overview
Milestone 1 is a comprehensive, non-mutating verification and documentation of the architectural reality, domain layering, client UI controls, REST endpoints, and security/operational guardrails of the `new-app` codebase located at `/Users/yashsomani/Desktop/Asure Bord Project/new-app`.

## Feature & Verification Scope
| # | Feature / Area | Scope Description | Verification Target |
|---|---|---|---|
| 1 | Architecture & Framework Reality | Confirm Node.js 22 (ESM), Express 5.2.1, vanilla SPA; confirm zero Next.js/React runtime dependencies; contrast with prompt description. | `package.json`, imports, entry points |
| 2 | Hexagonal / DDD Layering | Verify domain/ (entities, value objects, domain services, ports), application/ (7 use cases), infrastructure/ (adapters), presentation/ (Express routes, middleware, SPA). | `src/domain`, `src/application`, `src/infrastructure`, `src/presentation` |
| 3 | UI Views & Client Controls | Verify 10 distinct UI view sections, 6 modals, and 1 slide-out execution drawer. | `src/presentation/web/public/index.html`, `styles.css`, `app.js` |
| 4 | Complete REST API Endpoints Map | Verify all 19 endpoints in routes.ts with HTTP method, path, role requirement, and mutation guardrail status. | `src/presentation/api/routes.ts` |
| 5 | Operational Boundaries & Security Controls | Verify single-host exclusive lock (.execution-lock.json, PID check), atomic file writes, strict TLS enforcement, automated secret scrubbing, Basic Auth roles, anti-CSRF headers, localhost binding. | `src/infrastructure/`, middleware, server setup |

## Non-Mutation Guarantee
Zero modification to application source code or operational files. Verification is strictly read-only and analytical.
