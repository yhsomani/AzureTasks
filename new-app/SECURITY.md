# Security Implementation Guide

## Overview
This document outlines the security enhancements implemented in the Azure Board Task Manager application, including rate limiting, environment variable validation, and secret management.

## Table of Contents
1. [Rate Limiting](#rate-limiting)
2. [Environment Security](#environment-security)
3. [Secret Management](#secret-management)
4. [Pre-commit Hooks](#pre-commit-hooks)
5. [Testing](#testing)

---

## Rate Limiting

### Overview
Rate limiting middleware protects the API from abuse and brute force attacks by limiting the number of requests per IP address within a specified time window.

### Implementation Details

#### Middleware Tiers

**1. General Limiter** (Applied to all endpoints)
- **Limit**: 100 requests per 15 minutes
- **Scope**: All API endpoints except health check and session
- **Status Code**: 429 (Too Many Requests)
- **Use Case**: Basic protection against excessive API usage

**2. Strict Limiter** (Applied to mutation endpoints)
- **Limit**: 30 requests per 15 minutes
- **Scope**: POST, PUT, PATCH, DELETE operations
- **Status Code**: 429 (Too Many Requests)
- **Use Case**: Additional protection for state-changing operations

**3. Auth Limiter** (Applied to authentication endpoints)
- **Limit**: 5 attempts per 15 minutes
- **Scope**: Authentication and session endpoints
- **Status Code**: 429 (Too Many Requests)
- **Use Case**: Brute force protection for login attempts

**4. Bulk Operations Limiter** (Applied to bulk endpoints)
- **Limit**: 10 requests per 1 hour
- **Scope**: Bulk and batch operation endpoints
- **Status Code**: 429 (Too Many Requests)
- **Use Case**: Prevents resource exhaustion from bulk operations

### Rate Limiting Configuration

```typescript
import { generalLimiter, strictLimiter, authLimiter, bulkOperationsLimiter } from './rate-limiter.js';

// In server.ts configure() method
this.app.use(generalLimiter);
this.app.use(strictLimiter);
this.app.use(authLimiter);
this.app.use(bulkOperationsLimiter);
```

### Rate Limit Responses

When a rate limit is exceeded, the API returns a 429 status with a safe error message:

```json
{
  "success": false,
  "error": "Too many requests from this IP, please try again later."
}
```

**Important**: Error messages are designed to NOT leak sensitive information such as:
- User credentials
- System architecture details
- Configuration information
- API keys or tokens

### Violation Logging

Rate limit violations are logged for security monitoring:

```
WARN: Rate limit violation: IP 192.168.1.1 hit rate limit on /api/create. Limit: 30 requests per 15 minutes.
ERROR: Repeated rate limit violation: IP 192.168.1.1 (5 violations in window) on /api/create. Possible abuse attempt.
```

### Customization

To adjust rate limits, modify the configuration in `src/presentation/api/rate-limiter.ts`:

```typescript
export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // Change time window
  max: 100,                   // Change request limit
  // ... other options
});
```

---

## Environment Security

### Overview
Environment variable security ensures that sensitive credentials (.env) are never accidentally committed to version control.

### .env.example Template

A comprehensive `.env.example` file is provided as a template:

- **Location**: `/.env.example`
- **Contents**: All required and optional configuration variables with descriptions
- **Purpose**: Helps new developers understand required configuration without exposing real secrets
- **Status**: Never commit real secrets to this file

### Environment Variable Categories

#### Required for Production
- `AZURE_DEVOPS_PAT` - Azure DevOps Personal Access Token
- `GITHUB_TOKEN` - GitHub Personal Access Token (optional)
- `API_AUTH_TOKEN` - HTTP Basic auth secret

#### Configuration Variables
- `PORT` - Server port (default: 3000)
- `NODE_ENV` - Environment (development/production)
- `AZURE_DEVOPS_ORG` - Azure DevOps organization
- `AZURE_DEVOPS_PROJECT` - Azure DevOps project

#### Security Variables
- `LISTEN_HOST` - Network interface (default: 127.0.0.1)
- `PUBLIC_ORIGIN` - External URL for HTTPS termination
- `CORS_ORIGIN` - Allowed cross-origin
- `API_VIEWER_TOKEN` - Read-only credential

See `.env.example` for complete documentation.

---

## Secret Management

### Environment Validation

On startup, the application validates environment configuration:

```typescript
import { validateEnvironmentSecrets, validateGitIgnore, ensureEnvExample } from './env-validation.js';

// In constructor
ensureEnvExample();
validateGitIgnore();
validateEnvironmentSecrets();
```

### Validation Checks

**1. Secret Detection**
- Detects Azure DevOps PAT tokens (40+ alphanumeric characters)
- Detects GitHub tokens (ghp_ or github_pat_ prefix)
- Detects API auth tokens (20+ alphanumeric characters)
- Distinguishes real secrets from placeholder values

**2. Placeholder Recognition**
The validator ignores these safe patterns:
- `your-*`, `YOUR_*`
- `xxx`, `XXX`
- `replace*`, `REPLACE_*`
- `example`, `EXAMPLE`
- `placeholder`, `PLACEHOLDER`
- `/path/to/*`, `https://*`
- File paths and URLs

**3. .gitignore Verification**
- Ensures `.env` is listed in `.gitignore`
- Warns if .env would be accidentally committed
- Suggests remediation steps

### Secret Exposure Warning

If real secrets are detected in `.env`:

```
⚠️  SECURITY ALERT: Real secrets detected in .env file: AZURE_DEVOPS_PAT
These secrets are tracked by git and will be exposed if committed!
Immediate actions:
  1. IMMEDIATELY revoke these secrets in Azure DevOps / GitHub
  2. Use .env.example as a template and replace with new secrets
  3. Run: git rm --cached .env && git commit --amend
  4. Verify .env is in .gitignore
```

### Best Practices

**Development Environment:**
```bash
# 1. Copy .env.example to .env
cp .env.example .env

# 2. Fill in real secrets (development credentials only!)
# Edit .env with your actual tokens

# 3. Verify .env is in .gitignore
cat .gitignore | grep ".env"

# 4. Never commit .env
git status  # Should NOT show .env as untracked or modified
```

**Production Environment:**
```bash
# NEVER use .env files in production!
# Instead, inject secrets through your deployment system:

# Kubernetes
kubectl create secret generic api-secrets \
  --from-literal=AZURE_DEVOPS_PAT=... \
  --from-literal=API_AUTH_TOKEN=...

# Docker / Cloud platforms
# Use native secret managers (AWS Secrets Manager, Azure Key Vault, etc.)

# GitHub Actions
# Use repository secrets and environment variables
```

### Secret Revocation

If secrets are accidentally committed:

```bash
# Immediate actions (in order!):

# 1. Revoke the exposed secrets immediately in Azure DevOps / GitHub
#    (This is critical - do this FIRST!)

# 2. Remove from git history
git filter-branch --tree-filter 'rm -f .env' -- --all

# Or use git-filter-repo (safer):
pip install git-filter-repo
git filter-repo --path .env --invert-paths

# 3. Force push (if only local history affected)
git push origin --force-with-lease

# 4. Generate new secrets and update deployment
```

---

## Pre-commit Hooks

### Installation

Install the pre-commit hook to prevent accidental .env commits:

```bash
# Copy hook to git
cp scripts/pre-commit-env-check.sh .git/hooks/pre-commit

# Make it executable
chmod +x .git/hooks/pre-commit
```

### Automatic Checks

The pre-commit hook:
1. Prevents `.env` file from being committed
2. Scans staged files for potential secrets
3. Warns if suspicious patterns are found
4. Requires developer confirmation to proceed

### Example Usage

```bash
# Attempting to commit .env
$ git add .env
$ git commit -m "Add env file"

ERROR: .env file is staged for commit!

The .env file contains sensitive credentials and must NEVER be committed to git.

To fix this:
  1. Run: git reset HEAD .env
  2. Verify .env is in .gitignore: echo '.env' >> .gitignore
  3. Stage .gitignore: git add .gitignore
  4. Commit: git commit -m 'Add .env to .gitignore'
```

---

## Testing

### Rate Limiting Tests

Tests verify that rate limiting middleware functions correctly:

```bash
# Run tests
npm test -- rate-limiting.test.ts

# Test coverage
npm run test:coverage
```

**Test Scenarios:**
- General limiter allows requests within limit
- Strict limiter applies to mutations only
- Auth limiter protects authentication endpoints
- Health check is exempt from rate limiting
- Error messages don't leak sensitive information
- Violations are logged with IP address

### Environment Validation Tests

Tests verify security checks work correctly:

```bash
# Run tests
npm test -- env-validation.test.ts
```

**Test Scenarios:**
- Azure DevOps PAT token detection
- GitHub token detection
- Placeholder value recognition
- .gitignore validation
- .env.example documentation
- No real secrets in .env.example
- Proper middleware integration

### Manual Testing

Test rate limiting manually:

```bash
# Start the server
npm run dev

# Make rapid requests to trigger rate limit
for i in {1..150}; do
  curl http://localhost:3000/api/test
done

# Should receive 429 responses after 100 requests
```

---

## Configuration

### Environment Variables for Rate Limiting

Currently, rate limit values are hard-coded. To make them configurable via environment variables, add to `.env.example`:

```bash
# Rate Limiting Configuration (optional)
RATE_LIMIT_GENERAL_WINDOW_MS=900000          # 15 minutes in milliseconds
RATE_LIMIT_GENERAL_MAX=100                    # Requests per window
RATE_LIMIT_STRICT_WINDOW_MS=900000            # 15 minutes in milliseconds
RATE_LIMIT_STRICT_MAX=30                      # Requests per window
RATE_LIMIT_AUTH_WINDOW_MS=900000              # 15 minutes in milliseconds
RATE_LIMIT_AUTH_MAX=5                         # Attempts per window
RATE_LIMIT_BULK_WINDOW_MS=3600000             # 1 hour in milliseconds
RATE_LIMIT_BULK_MAX=10                        # Requests per window
```

### Production Considerations

**1. Persistent Rate Limit Store**
```
Current: In-memory storage (lost on restart)
Production: Use Redis or database for persistent tracking
```

**2. Distributed Rate Limiting**
```
Multiple instances: Share rate limit state via Redis
Single instance: In-memory is sufficient
```

**3. Exempt IPs**
```
Load balancers, monitoring: May need whitelisting
Configure via environment variables
```

**4. Monitoring and Alerting**
```
Setup alerts for repeated violations
Log to external SIEM system
Monitor 429 response rates
```

---

## Troubleshooting

### Rate Limiting Issues

**Problem**: Legitimate requests are being rate-limited
**Solutions:**
- Check client IP address (proxy/load balancer?)
- Increase rate limit thresholds
- Whitelist specific IPs
- Use Redis for distributed limiting

**Problem**: Health checks failing due to rate limiting
**Solution**: Health check is automatically exempt - verify endpoint is `/api/health`

### Environment Variable Issues

**Problem**: "Real secrets detected in .env file" warning on startup
**Solutions:**
1. Revoke exposed secrets immediately
2. Generate new credentials
3. Update .env with new values
4. Restart application

**Problem**: .env file accidentally committed
**Solutions:**
1. Revoke all exposed secrets IMMEDIATELY
2. Use git-filter-repo to remove from history
3. Install pre-commit hook to prevent future commits
4. Generate new credentials

---

## References

- [express-rate-limit documentation](https://github.com/nfriedly/express-rate-limit)
- [OWASP Rate Limiting Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Nodejs_Security_Cheat_Sheet.html)
- [Git Security - Removing Sensitive Data](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository)
- [Environment Variable Best Practices](https://12factor.net/config)

---

## Support

For security concerns or questions:
1. Review this documentation
2. Check test files for implementation examples
3. Run tests to verify configuration: `npm test`
4. Check server logs for rate limit violations

Last Updated: 2026-10-26
