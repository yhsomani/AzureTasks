/**
 * Environment Variable Validation and Security
 * Ensures sensitive data is not exposed and validates environment configuration
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { logger } from '../../infrastructure/logging/logger.js';

/**
 * Sensitive patterns that indicate real secrets (not placeholder values)
 */
const SENSITIVE_PATTERNS = {
  // Azure DevOps PAT: typically starts with letters and is quite long
  AZURE_DEVOPS_PAT: /^[a-zA-Z0-9]{40,}$/,
  // GitHub Token: personal access tokens start with ghp_ or github_pat_
  GITHUB_TOKEN: /^(ghp_|github_pat_)[a-zA-Z0-9]{36,}$/,
  // Auth tokens: typically long alphanumeric strings
  API_AUTH_TOKEN: /^[a-zA-Z0-9\-_.]{20,}$/,
};

/**
 * Dummy/placeholder patterns that are safe (examples)
 */
const DUMMY_PATTERNS = [
  /^(YOUR_|your_|xxx|XXX|replaceme|REPLACE_ME|change_me|CHANGE_ME|example|EXAMPLE|placeholder|PLACEHOLDER|dummy|DUMMY|secret|SECRET|\*+).*$/i,
  /^(https?:\/\/|\/path\/to|\/Users\/|C:\\).*$/,
  /^(false|true|0|1|yes|no)$/i,
];

/**
 * Check if a value looks like a real secret or a placeholder
 */
function isRealSecret(variableName: string, value: string | undefined): boolean {
  if (!value || value.trim() === '') {
    return false;
  }

  // Check if it matches a dummy pattern
  if (DUMMY_PATTERNS.some(pattern => pattern.test(value))) {
    return false;
  }

  // Check if it matches a sensitive pattern
  const pattern = SENSITIVE_PATTERNS[variableName as keyof typeof SENSITIVE_PATTERNS];
  if (pattern && pattern.test(value)) {
    return true;
  }

  return false;
}

/**
 * Validate that .env file contains only example/placeholder values in development
 */
export function validateEnvironmentSecrets(): void {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const envPath = path.resolve(process.cwd(), '.env');

  // Skip validation in production or if .env doesn't exist
  if (nodeEnv === 'production' || !fs.existsSync(envPath)) {
    return;
  }

  try {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const lines = envContent.split('\n');
    const secretVariables = ['AZURE_DEVOPS_PAT', 'GITHUB_TOKEN', 'API_AUTH_TOKEN'];
    const foundSecrets: string[] = [];

    for (const line of lines) {
      if (line.startsWith('#') || !line.includes('=')) continue;

      const [key, ...valueParts] = line.split('=');
      const cleanKey = key.trim();
      const rawValue = valueParts.join('=').trim();

      // Remove quotes if present
      let value = rawValue;
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      if (secretVariables.includes(cleanKey) && isRealSecret(cleanKey, value)) {
        foundSecrets.push(cleanKey);
      }
    }

    if (foundSecrets.length > 0) {
      const secretsList = foundSecrets.join(', ');

      // Check whether .env is actually tracked by git
      let isTrackedByGit = false;
      try {
        execSync('git ls-files --error-unmatch .env', { stdio: 'pipe' });
        isTrackedByGit = true;
      } catch {
        isTrackedByGit = false;
      }

      if (isTrackedByGit) {
        logger.error(
          `⚠️  CRITICAL SECURITY ALERT: Real secrets detected in .env file: ${secretsList}\n` +
          `The .env file IS TRACKED BY GIT and will be exposed if pushed to a remote repository!\n` +
          `Immediate actions:\n` +
          `  1. IMMEDIATELY revoke these secrets in Azure DevOps / GitHub\n` +
          `  2. Stop tracking .env: git rm --cached .env\n` +
          `  3. Verify .env is added to .gitignore\n` +
          `  4. Commit the untracking changes and use .env.example as a template.`
        );
        if (nodeEnv !== 'production') {
          logger.warn('Starting in development mode despite secret exposure risk. USE CAUTION!');
        }
      } else {
        logger.info(
          `Local secrets detected in .env (${secretsList}). Verified .env is untracked in git (.gitignore active).`
        );
      }
    }
  } catch (error) {
    logger.warn(`Could not validate .env file: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Verify that .env is properly added to .gitignore
 */
export function validateGitIgnore(): void {
  const gitIgnorePath = path.resolve(process.cwd(), '.gitignore');

  if (!fs.existsSync(gitIgnorePath)) {
    logger.warn('No .gitignore file found. Consider creating one to protect secrets.');
    return;
  }

  try {
    const gitIgnoreContent = fs.readFileSync(gitIgnorePath, 'utf8');
    if (!gitIgnoreContent.includes('.env')) {
      logger.error(
        '⚠️  SECURITY ALERT: .env file is NOT in .gitignore!\n' +
        'Add the following line to .gitignore:\n' +
        '  .env\n' +
        'Then run: git rm --cached .env && git commit -m "Remove .env from tracking"'
      );
    }
  } catch (error) {
    logger.warn(`Could not validate .gitignore: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Create .env.example if it doesn't exist or is outdated
 */
export function ensureEnvExample(): void {
  const examplePath = path.resolve(process.cwd(), '.env.example');
  const envPath = path.resolve(process.cwd(), '.env');

  if (fs.existsSync(examplePath) && fs.existsSync(envPath)) {
    // Example already exists, don't overwrite
    return;
  }

  const exampleContent = `# Azure DevOps Configuration
# Required for all operations - obtain from https://dev.azure.com/{org}/_usersSettings/tokens
AZURE_DEVOPS_PAT=your-personal-access-token-here
AZURE_DEVOPS_ORG=your-organization-name
AZURE_DEVOPS_PROJECT=your-project-name
AZURE_DEVOPS_TIMEZONE=UTC

# GitHub Configuration (optional - for PR-based evidence)
# Obtain from https://github.com/settings/tokens
GITHUB_TOKEN=your-github-token-here
GITHUB_ORG=your-github-org
GITHUB_USER_SUFFIX=_suffix

# Server Configuration
PORT=3000
NODE_ENV=development
LOG_LEVEL=info

# Task Configuration
WORK_ITEM_TYPE=3in1 Task
TASK_SERIES=your-task-series
TITLE_PREFIX="Task |"
START_TIME=09:30
THURSDAY_MODE=CURRENT
SKIP_WEEKENDS=true
DEFAULT_STATE=New

# Auto-closure Configuration (be careful with this!)
AUTO_CLOSE=false
AUTO_CLOSE_START_TIME=18:15
AUTO_CLOSE_END_TIME=18:45

# Retry Configuration
MAX_RETRIES=3
INITIAL_RETRY_DELAY_MS=1000

# AI Configuration
DEFAULT_GENAI_ENABLED=No

# Network Configuration
LISTEN_HOST=127.0.0.1

# TLS Certificate (if behind corporate proxy)
# NODE_EXTRA_CA_CERTS=/path/to/corporate-ca.pem

# HTTP Basic Authentication (required for production)
# Generate a strong random token with: openssl rand -base64 32
# API_AUTH_TOKEN=your-strong-random-secret-here
# API_AUTH_USER=admin

# Cross-origin Configuration (if needed)
# CORS_ORIGIN=https://trusted-origin.example.com
# PUBLIC_ORIGIN=https://your-domain.example.com

# Read-only Viewer Access (optional)
# API_VIEWER_USER=auditor
# API_VIEWER_TOKEN=separate-strong-random-secret-here

# Secret Storage Mode (development only!)
# SECRET_STORAGE_MODE=local-file
`;

  try {
    if (!fs.existsSync(examplePath)) {
      fs.writeFileSync(examplePath, exampleContent, 'utf8');
      logger.info('Created .env.example template for environment configuration');
    }
  } catch (error) {
    logger.warn(`Could not create .env.example: ${error instanceof Error ? error.message : String(error)}`);
  }
}
