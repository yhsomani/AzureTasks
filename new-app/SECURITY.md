# Security Policy and Implementation Guide

## Security Overview
This document outlines the security controls, policies, and environment protection mechanisms implemented in Azure 3in1 Task Creator.

---

## Rate Limiting
To prevent abuse, resource exhaustion, and brute-force attacks, the Express API incorporates tiered rate limiting via `express-rate-limit`:

- **General Limiter**: Applies to general read and informational API endpoints (e.g. status, logs).
- **Strict Limiter**: Enforces tighter thresholds on resource-intensive or state-modifying routes.
- **Auth Limiter**: Throttles sensitive authentication and token configuration requests to mitigate credential testing.
- **Bulk Operations**: Dedicated limiter for high-volume tasks such as multi-user task creation, EOD closures, and repair sweeps.

---

## Environment Security
Protecting secrets and preventing credentials from leaking into source control is critical:

- **`.env.example`**: Provides a template of required configuration variables without containing real secrets.
- **`.gitignore`**: Enforces strict exclusion of `.env`, `.env.local`, and credential files.
- **Secret Validation**: On server startup, `validateEnvironmentSecrets` scans process configuration for dummy/placeholder keys or improperly exposed tokens.
- **Pre-commit Checks**: Pre-commit hooks (`scripts/pre-commit-env-check.sh`) verify that no `.env` or secret files are staged before commits are created.

---

## Testing
Security mechanisms and isolation contracts are verified automatically via automated test suites:

- **Run all tests**:
  ```bash
  npm test
  ```
- **Run security integration tests**:
  ```bash
  npx vitest run tests/security-integration.test.ts
  ```

---

## Troubleshooting

### Problem: Requests receiving HTTP 429 Too Many Requests
- **Solution**: The client has exceeded the threshold configured on the endpoint's rate limiter. Wait for the retry window to reset or adjust rate limiting parameters in `rate-limiter.ts` if legitimate bulk load requires higher capacity.

### Problem: Server startup fails with secret validation error
- **Solution**: Check your environment variables or local `.env` file. Ensure real secrets are not set to default dummy values and verify that required Azure DevOps PAT or tokens are properly formatted.

### Problem: Pre-commit hook blocks commit
- **Solution**: The pre-commit hook detected `.env` or sensitive files staged for commit. Unstage the files using `git reset HEAD .env` and ensure sensitive data is not tracked in the repository.
