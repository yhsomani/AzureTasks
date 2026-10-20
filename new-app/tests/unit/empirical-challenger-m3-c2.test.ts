import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger } from '../../src/infrastructure/logging/logger.js';
import { assertTlsSafety } from '../../src/infrastructure/security/tls-safety.js';
import { buildApp } from '../../src/container.js';

describe('Empirical Challenger 2: Milestone 3 Security Guardrails Stress Test', () => {

  describe('1. Secret Scrubbing — Bearer Token Edge Cases', () => {
    let testLogger: Logger;

    beforeEach(() => {
      testLogger = new Logger();
    });

    it('scrubs standard Bearer token with alphanumeric payload', () => {
      const msg = 'Authorization: Bearer mySecretToken12345';
      expect(testLogger.sanitize(msg)).toBe('Authorization: Bearer ***');
    });

    it('scrubs Bearer token with lowercase "bearer"', () => {
      const msg = 'authorization: bearer lowercaseBearerToken12345';
      expect(testLogger.sanitize(msg)).toBe('authorization: Bearer ***');
    });

    it('scrubs Bearer token with uppercase "BEARER"', () => {
      const msg = 'AUTHORIZATION: BEARER UPPERCASEBEARERTOKEN12345';
      expect(testLogger.sanitize(msg)).toBe('AUTHORIZATION: Bearer ***');
    });

    it('scrubs Bearer token with mixed case "bEaReR"', () => {
      const msg = 'auth: bEaReR MixedCaseToken12345';
      expect(testLogger.sanitize(msg)).toBe('auth: Bearer ***');
    });

    it('scrubs Bearer token with multiple spaces padding', () => {
      const msg = 'Authorization: Bearer     multiSpacedToken999';
      expect(testLogger.sanitize(msg)).toBe('Authorization: Bearer ***');
    });

    it('scrubs Bearer token separated by tabs', () => {
      const msg = 'Authorization: Bearer\ttabSeparatedToken888';
      expect(testLogger.sanitize(msg)).toBe('Authorization: Bearer ***');
    });

    it('scrubs complex JWT Bearer tokens with periods, dashes, and underscores', () => {
      const jwt = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkFsaWNlX0JvYi1UZXN0In0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
      const msg = `Received webhook with header: ${jwt} in payload`;
      expect(testLogger.sanitize(msg)).toBe('Received webhook with header: Bearer *** in payload');
    });

    it('scrubs registered secret containing Base64 special characters (+, /, =)', () => {
      const complexSecret = 'sec+ret/token==';
      testLogger.registerSecret(complexSecret);
      const msg = `Connecting with Bearer ${complexSecret} now`;
      // When registered, registerSecret registers both trimmed and `Bearer ${trimmed}`
      const sanitized = testLogger.sanitize(msg);
      expect(sanitized).not.toContain(complexSecret);
      expect(sanitized).toBe('Connecting with *** now');
    });

    it('identifies boundary behavior for unregistered Bearer token containing non-JWT base64 chars (+, /)', () => {
      // Standard JWT tokens use base64url ([A-Za-z0-9_-] and .), which is completely matched by [A-Za-z0-9_\-.]
      // Unregistered tokens with '+' or '/' or '=' stop matching at '+'
      const unregisteredToken = 'Bearer unreg_jwt_part1.part2-part3';
      expect(testLogger.sanitize(unregisteredToken)).toBe('Bearer ***');

      const nonUrlBase64 = 'Bearer tokenPrefix+extra/suffix==';
      const result = testLogger.sanitize(nonUrlBase64);
      // Demonstrates that unregistered token stops at '+'
      expect(result).toBe('Bearer ***+extra/suffix==');
    });

    it('scrubs Bearer token embedded in JSON formatted string', () => {
      const json = JSON.stringify({
        headers: {
          Authorization: 'Bearer testToken1234567890abcdef',
        },
      });
      const sanitized = testLogger.sanitize(json);
      expect(sanitized).not.toContain('testToken1234567890abcdef');
      expect(sanitized).toContain('Bearer ***');
    });

    it('scrubs Bearer token embedded in URL query string', () => {
      const rawUrl = 'https://service.internal/oauth?token=Bearer mySecretToken12345&state=ok';
      expect(testLogger.sanitize(rawUrl)).toBe('https://service.internal/oauth?token=Bearer ***&state=ok');
    });
  });

  describe('2. Secret Scrubbing — GitHub Classic & Fine-Grained PATs', () => {
    let testLogger: Logger;

    beforeEach(() => {
      testLogger = new Logger();
    });

    it('scrubs classic GitHub PAT (ghp_ + 36 characters)', () => {
      const pat = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8';
      expect(pat.length).toBe(40);
      const msg = `Cloning repository with token ${pat} from origin`;
      expect(testLogger.sanitize(msg)).toBe('Cloning repository with token *** from origin');
    });

    it('scrubs classic GitHub PAT embedded in git remote URL', () => {
      const pat = 'ghp_' + '0123456789abcdefghijklmnopqrstuvwxyz';
      const url = `https://${pat}@github.com/3in1-AppFrontEnd/repo.git`;
      expect(testLogger.sanitize(url)).toBe('https://***@github.com/3in1-AppFrontEnd/repo.git');
    });

    it('scrubs classic GitHub PAT in JSON payload', () => {
      const pat = 'ghp_' + 'Z9Y8X7W6V5U4T3S2R1Q0P9O8N7M6L5K4J3I2';
      const json = JSON.stringify({ pat, action: 'sync' });
      expect(testLogger.sanitize(json)).toBe(JSON.stringify({ pat: '***', action: 'sync' }));
    });

    it('scrubs classic GitHub PAT in simulated error stack trace', () => {
      const pat = 'ghp_' + '123456789012345678901234567890123456';
      const trace = `Error: 401 Unauthorized for token ${pat}\n    at GitHubClient.get (/app/src/infrastructure/github/github-client.ts:89:12)`;
      const sanitized = testLogger.sanitize(trace);
      expect(sanitized).not.toContain(pat);
      expect(sanitized).toContain('Error: 401 Unauthorized for token ***');
    });

    it('scrubs fine-grained GitHub PAT (github_pat_ + 82 characters)', () => {
      const fgPat = 'github_pat_' + 'A'.repeat(82);
      expect(fgPat.length).toBe(93);
      const msg = `Authenticated with fine-grained PAT: ${fgPat}`;
      expect(testLogger.sanitize(msg)).toBe('Authenticated with fine-grained PAT: ***');
    });

    it('scrubs fine-grained GitHub PAT with underscores in payload', () => {
      const payload = ('A1_' + 'B2_' + 'C3_').repeat(9).slice(0, 81) + 'X';
      expect(payload.length).toBe(82);
      expect(payload).toContain('_');
      const fgPat = `github_pat_${payload}`;
      const msg = `URL: https://${fgPat}@github.com/org/repo.git`;
      expect(testLogger.sanitize(msg)).toBe('URL: https://***@github.com/org/repo.git');
    });

    it('scrubs fine-grained GitHub PAT passed as Bearer token', () => {
      const fgPat = 'github_pat_' + 'B'.repeat(82);
      const msg = `Authorization: Bearer ${fgPat}`;
      const sanitized = testLogger.sanitize(msg);
      expect(sanitized).not.toContain(fgPat);
      expect(sanitized).toBe('Authorization: Bearer ***');
    });
  });

  describe('3. Secret Scrubbing — Azure DevOps 52-Character PATs', () => {
    let testLogger: Logger;

    beforeEach(() => {
      testLogger = new Logger();
    });

    it('scrubs 52-char Base32 Azure DevOps PAT embedded in URL query parameter', () => {
      const pat = '4abcdefghijklmnopqrstuvwxyz234567abcdefghijklmnopqrs';
      expect(pat.length).toBe(52);
      const url = `https://dev.azure.com/BFLDevOpsOrg?api-version=7.0&token=${pat}&verbose=true`;
      expect(testLogger.sanitize(url)).toBe('https://dev.azure.com/BFLDevOpsOrg?api-version=7.0&token=***&verbose=true');
    });

    it('scrubs 52-char Azure DevOps PAT in URL userinfo / authority', () => {
      const pat = '4abcdefghijklmnopqrstuvwxyz234567abcdefghijklmnopqrs';
      const url = `https://:${pat}@dev.azure.com/BFLDevOpsOrg/3in1_Agile_Projects`;
      expect(testLogger.sanitize(url)).toBe('https://:***@dev.azure.com/BFLDevOpsOrg/3in1_Agile_Projects');
    });

    it('scrubs 52-char alphanumeric Azure DevOps PAT in JSON payload', () => {
      const pat = 'K1mQ8zL4pW7rT2yU5sA0cE6gH8jN1kM3vX5qY7zR9tP2wDv3bF9x';
      expect(pat.length).toBe(52);
      const json = JSON.stringify({ organization: 'BFLDevOpsOrg', pat });
      expect(testLogger.sanitize(json)).toBe(JSON.stringify({ organization: 'BFLDevOpsOrg', pat: '***' }));
    });

    it('scrubs 52-char Azure DevOps PAT in multi-line error stack trace', () => {
      const pat = '7zyxwvutsrqponmlkjihgfedcba765432zyxwvutsrqponmlkjih';
      expect(pat.length).toBe(52);
      const stack = [
        `AzureDevOpsClientError: Request failed with status 401 using PAT ${pat}`,
        '    at AzureDevOpsClient.fetch (/new-app/src/infrastructure/azure/client.ts:55:18)',
        '    at async AzureWorkItemService.getWorkItem (/new-app/src/infrastructure/azure/work-item-service.ts:120:22)',
      ].join('\n');

      const sanitized = testLogger.sanitize(stack);
      expect(sanitized).not.toContain(pat);
      expect(sanitized).toContain('AzureDevOpsClientError: Request failed with status 401 using PAT ***');
    });

    it('preserves non-52 character strings (prevents false positive over-scrubbing)', () => {
      const str51 = 'a'.repeat(51);
      const str53 = 'b'.repeat(53);
      expect(testLogger.sanitize(`Code 51: ${str51}`)).toBe(`Code 51: ${str51}`);
      expect(testLogger.sanitize(`Code 53: ${str53}`)).toBe(`Code 53: ${str53}`);
    });
  });

  describe('4. Secret Scrubbing — HTTP Basic Authorization Headers', () => {
    let testLogger: Logger;

    beforeEach(() => {
      testLogger = new Logger();
    });

    it('scrubs standard HTTP Basic authorization header', () => {
      const header = 'Authorization: Basic OjRhYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5ejIzNDU2N2FiY2RlZmdoaWprbG1ub3BxcnM=';
      expect(testLogger.sanitize(header)).toBe('Authorization: Basic ***');
    });

    it('scrubs lowercase "basic" authorization header', () => {
      const header = 'authorization: basic OjRhYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5ejIzNDU2N2FiY2RlZmdoaWprbG1ub3BxcnM=';
      expect(testLogger.sanitize(header)).toBe('authorization: Basic ***');
    });

    it('scrubs uppercase "BASIC" authorization header', () => {
      const header = 'AUTHORIZATION: BASIC OjRhYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5ejIzNDU2N2FiY2RlZmdoaWprbG1ub3BxcnM=';
      expect(testLogger.sanitize(header)).toBe('AUTHORIZATION: Basic ***');
    });

    it('scrubs HTTP Basic header with 0 padding characters', () => {
      const b64 = Buffer.from('user:password12345').toString('base64');
      const header = `Authorization: Basic ${b64}`;
      expect(testLogger.sanitize(header)).toBe('Authorization: Basic ***');
    });

    it('scrubs HTTP Basic header with single padding character (=)', () => {
      const b64 = Buffer.from('user:password1234').toString('base64');
      expect(b64.endsWith('=')).toBe(true);
      const header = `Authorization: Basic ${b64}`;
      expect(testLogger.sanitize(header)).toBe('Authorization: Basic ***');
    });

    it('scrubs HTTP Basic header with double padding characters (==)', () => {
      const b64 = Buffer.from('user:password123').toString('base64');
      expect(b64.endsWith('==')).toBe(true);
      const header = `Authorization: Basic ${b64}`;
      expect(testLogger.sanitize(header)).toBe('Authorization: Basic ***');
    });

    it('scrubs HTTP Basic header with multiple spaces and tabs', () => {
      const header = 'Authorization: Basic   \t  OjRhYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5ejIzNDU2N2FiY2RlZmdoaWprbG1ub3BxcnM=';
      expect(testLogger.sanitize(header)).toBe('Authorization: Basic ***');
    });

    it('scrubs Azure DevOps encoded PAT in HTTP Basic header', () => {
      const pat = '4abcdefghijklmnopqrstuvwxyz234567abcdefghijklmnopqrs';
      const encoded = Buffer.from(`:${pat}`).toString('base64');
      const requestDump = `POST /_apis/wit/wiql HTTP/1.1\nHost: dev.azure.com\nAuthorization: Basic ${encoded}\nContent-Type: application/json`;
      const sanitized = testLogger.sanitize(requestDump);
      expect(sanitized).not.toContain(encoded);
      expect(sanitized).not.toContain(pat);
      expect(sanitized).toContain('Authorization: Basic ***');
    });
  });

  describe('5. Secret Scrubbing — Sink Leak Prevention & Ring Buffer Verification', () => {
    let testLogger: Logger;

    beforeEach(() => {
      testLogger = new Logger();
      testLogger.setVerbose(true);
    });

    it('prevents leaks across all log levels in getRecentLogs()', () => {
      const pat = 'ghp_' + 'X'.repeat(36);
      testLogger.debug(`Debug token: ${pat}`);
      testLogger.info(`Info token: ${pat}`);
      testLogger.warn(`Warn token: ${pat}`);
      testLogger.error(`Error token: ${pat}`);
      testLogger.success(`Success token: ${pat}`);

      const logs = testLogger.getRecentLogs();
      expect(logs.length).toBe(5);
      for (const entry of logs) {
        expect(entry.message).not.toContain(pat);
        expect(entry.message).toContain('***');
      }
    });

    it('prevents leaks to listeners subscribed via addListener()', () => {
      const captured: string[] = [];
      const unsub = testLogger.addListener(entry => {
        captured.push(entry.message);
      });

      const azurePat = '4abcdefghijklmnopqrstuvwxyz234567abcdefghijklmnopqrs';
      const githubPat = 'ghp_' + 'Y'.repeat(36);
      const bearerToken = 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig';

      testLogger.info(`Azure: ${azurePat}`);
      testLogger.warn(`GitHub: ${githubPat}`);
      testLogger.error(`Bearer: ${bearerToken}`);

      unsub();
      testLogger.info('Post-unsubscribe message');

      expect(captured.length).toBe(3);
      expect(captured[0]).toBe('Azure: ***');
      expect(captured[1]).toBe('GitHub: ***');
      expect(captured[2]).toBe('Bearer: Bearer ***');
    });

    it('prevents leaks to console.log, console.warn, and console.error', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const pat = 'ghp_' + 'Q'.repeat(36);

      try {
        testLogger.info(`Log info: ${pat}`);
        testLogger.warn(`Log warn: ${pat}`);
        testLogger.error(`Log error: ${pat}`);
        testLogger.raw(`Raw output: ${pat}`);

        expect(logSpy).toHaveBeenCalledTimes(2); // info + raw
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(errorSpy).toHaveBeenCalledTimes(1);

        expect(String(logSpy.mock.calls[0][0])).toBe('[INFO] Log info: ***');
        expect(String(logSpy.mock.calls[1][0])).toBe('Raw output: ***');
        expect(String(warnSpy.mock.calls[0][0])).toBe('[WARN] Log warn: ***');
        expect(String(errorSpy.mock.calls[0][0])).toBe('[ERROR] Log error: ***');
      } finally {
        logSpy.mockRestore();
        warnSpy.mockRestore();
        errorSpy.mockRestore();
      }
    });

    it('handles buffer capacity rollover without corrupting sanitized entries', () => {
      for (let i = 0; i < 550; i++) {
        testLogger.info(`Event ${i}: ghp_${'K'.repeat(36)}`);
      }
      const logs = testLogger.getRecentLogs();
      expect(logs.length).toBe(500); // capped at maxRecent = 500
      expect(logs[0].message).toContain('Event 50: ***');
      expect(logs[499].message).toContain('Event 549: ***');
      for (const log of logs) {
        expect(log.message).not.toContain('ghp_');
      }
    });

    it('retroactively scrubs earlier buffer entries when secret is registered dynamically', () => {
      const lateSecret = 'super-secret-late-pat-99999999999';
      testLogger.info(`Message 1 before reg: ${lateSecret}`);
      testLogger.warn(`Message 2 before reg: ${lateSecret}`);

      let recent = testLogger.getRecentLogs();
      expect(recent[0].message).toContain(lateSecret);
      expect(recent[1].message).toContain(lateSecret);

      testLogger.registerSecret(lateSecret);

      recent = testLogger.getRecentLogs();
      expect(recent[0].message).toBe('Message 1 before reg: ***');
      expect(recent[1].message).toBe('Message 2 before reg: ***');
      expect(recent[0].message).not.toContain(lateSecret);
      expect(recent[1].message).not.toContain(lateSecret);
    });
  });

  describe('6. TLS Safety Enforcement — assertTlsSafety()', () => {
    it('throws when ALLOW_INSECURE_TLS is true (lowercase)', () => {
      expect(() => assertTlsSafety({ ALLOW_INSECURE_TLS: 'true' })).toThrow(
        /TLS certificate verification must remain enabled/
      );
    });

    it('throws when ALLOW_INSECURE_TLS is True (capitalized)', () => {
      expect(() => assertTlsSafety({ ALLOW_INSECURE_TLS: 'True' })).toThrow(
        /TLS certificate verification must remain enabled/
      );
    });

    it('throws when ALLOW_INSECURE_TLS is TRUE (all caps)', () => {
      expect(() => assertTlsSafety({ ALLOW_INSECURE_TLS: 'TRUE' })).toThrow(
        /TLS certificate verification must remain enabled/
      );
    });

    it('throws when ALLOW_INSECURE_TLS has leading/trailing whitespace', () => {
      expect(() => assertTlsSafety({ ALLOW_INSECURE_TLS: '   true   ' })).toThrow(
        /TLS certificate verification must remain enabled/
      );
    });

    it('throws when NODE_TLS_REJECT_UNAUTHORIZED is 0', () => {
      expect(() => assertTlsSafety({ NODE_TLS_REJECT_UNAUTHORIZED: '0' })).toThrow(
        /TLS certificate verification must remain enabled/
      );
    });

    it('throws when NODE_TLS_REJECT_UNAUTHORIZED is " 0 "', () => {
      expect(() => assertTlsSafety({ NODE_TLS_REJECT_UNAUTHORIZED: ' 0 ' })).toThrow(
        /TLS certificate verification must remain enabled/
      );
    });

    it('throws when both ALLOW_INSECURE_TLS and NODE_TLS_REJECT_UNAUTHORIZED are set', () => {
      expect(() => assertTlsSafety({
        ALLOW_INSECURE_TLS: 'true',
        NODE_TLS_REJECT_UNAUTHORIZED: '0',
      })).toThrow(/TLS certificate verification must remain enabled/);
    });

    it('does not throw when environment is clean', () => {
      expect(() => assertTlsSafety({})).not.toThrow();
    });

    it('does not throw when ALLOW_INSECURE_TLS is false', () => {
      expect(() => assertTlsSafety({ ALLOW_INSECURE_TLS: 'false' })).not.toThrow();
    });

    it('does not throw when NODE_TLS_REJECT_UNAUTHORIZED is 1', () => {
      expect(() => assertTlsSafety({ NODE_TLS_REJECT_UNAUTHORIZED: '1' })).not.toThrow();
    });
  });

  describe('7. TLS Safety Enforcement — buildApp() Integration', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('rejects buildApp() startup when ALLOW_INSECURE_TLS=true', async () => {
      vi.stubEnv('ALLOW_INSECURE_TLS', 'true');
      await expect(buildApp()).rejects.toThrow(
        /TLS certificate verification must remain enabled/
      );
    });

    it('rejects buildApp() startup when ALLOW_INSECURE_TLS=True', async () => {
      vi.stubEnv('ALLOW_INSECURE_TLS', 'True');
      await expect(buildApp()).rejects.toThrow(
        /TLS certificate verification must remain enabled/
      );
    });

    it('rejects buildApp() startup when ALLOW_INSECURE_TLS=TRUE', async () => {
      vi.stubEnv('ALLOW_INSECURE_TLS', 'TRUE');
      await expect(buildApp()).rejects.toThrow(
        /TLS certificate verification must remain enabled/
      );
    });

    it('rejects buildApp() startup when NODE_TLS_REJECT_UNAUTHORIZED=0', async () => {
      vi.stubEnv('NODE_TLS_REJECT_UNAUTHORIZED', '0');
      await expect(buildApp()).rejects.toThrow(
        /TLS certificate verification must remain enabled/
      );
    });

    it('successfully initializes buildApp() in a normal clean environment', async () => {
      vi.stubEnv('ALLOW_INSECURE_TLS', '');
      vi.stubEnv('NODE_TLS_REJECT_UNAUTHORIZED', '');
      const app = await buildApp();
      expect(app).toBeDefined();
      expect(app.createTasks).toBeDefined();
      expect(app.planTasks).toBeDefined();
      expect(app.exploreTasks).toBeDefined();
      expect(app.getStatus).toBeDefined();
      expect(app.repairRelations).toBeDefined();
      expect(app.closeDailyTasks).toBeDefined();
    });
  });
});
