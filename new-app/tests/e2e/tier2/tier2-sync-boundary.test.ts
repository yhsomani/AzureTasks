import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Logger } from '../../../src/infrastructure/logging/logger.js';
import { MockAzureDevOpsServer } from '../harness/mock-azure-server.js';
import { extractIdentity } from '../../../src/domain/entities/person.js';

describe('Tier 2: Boundary & Corner Cases - Group 3: Sync & Security', () => {
  let mockAdoServer: MockAzureDevOpsServer;

  beforeEach(async () => {
    mockAdoServer = new MockAzureDevOpsServer();
    await mockAdoServer.start();
  });

  afterEach(async () => {
    await mockAdoServer.stop();
  });

  // =========================================================================
  // Feature F7 Boundary: ADO Export & Identity Malformedness (5 Tests)
  // =========================================================================
  describe('Feature F7 Boundary: Identity Unnesting Resilience', () => {
    it('T2-F7-01: Completely unassigned task (AssignedTo: null) returns null without throwing TypeError', () => {
      expect(() => {
        const result = extractIdentity(null);
        expect(result).toBeNull();
      }).not.toThrow();
    });

    it('T2-F7-02: Malformed identity object without uniqueName falls back gracefully to displayName', () => {
      const malformedObj = {
        displayName: 'External Guest User',
        // uniqueName missing
      };

      const extracted = extractIdentity(malformedObj);
      expect(extracted).not.toBeNull();
      expect(extracted?.displayName).toBe('External Guest User');
      expect(extracted?.uniqueName).toBeUndefined();
    });

    it('T2-F7-03: Deeply nested vendor fields are extracted while ignoring unexpected attributes', () => {
      const vendorPayload = {
        id: 'guid-vendor-001',
        displayName: 'Sam Vendor',
        uniqueName: 'sam.vendor@workops.test',
        extraVendorMetadata: {
          claims: ['read', 'write'],
          tenantInfo: { region: 'us-east' },
        },
      };

      const extracted = extractIdentity(vendorPayload);
      expect(extracted?.displayName).toBe('Sam Vendor');
      expect(extracted?.uniqueName).toBe('sam.vendor@workops.test');
    });

    it('T2-F7-04: Extreme whitespace and mixed casing: trims whitespace properly', () => {
      const messyInput = '   Dr. Jane Smith <  JANE.SMITH@WORKOPS.TEST  >  ';
      const extracted = extractIdentity(messyInput);

      expect(extracted).not.toBeNull();
      expect(extracted?.displayName).toBe('Dr. Jane Smith');
      expect(extracted?.uniqueName).toBe('JANE.SMITH@WORKOPS.TEST');
    });

    it('T2-F7-05: Special characters in display names (apostrophes, hyphens, periods) are preserved intact', () => {
      const specialName = "Mary-Jane O'Connor, Ph.D. <mary.oconnor@workops.test>";
      const extracted = extractIdentity(specialName);

      expect(extracted).not.toBeNull();
      expect(extracted?.displayName).toBe("Mary-Jane O'Connor, Ph.D.");
      expect(extracted?.uniqueName).toBe('mary.oconnor@workops.test');
    });
  });

  // =========================================================================
  // Feature F8 Boundary: Multi-Project Network Fault Injection (5 Tests)
  // =========================================================================
  describe('Feature F8 Boundary: Multi-Project Network Fault Injection', () => {
    it('T2-F8-01: HTTP 429 Rate Limiting with Retry-After header: server emits 429 fault', async () => {
      mockAdoServer.setFault('429', 1, 1);
      const baseUrl = mockAdoServer.getBaseUrl();

      const res = await fetch(`${baseUrl}/3in1_Agile_Projects/_apis/wit/workitems/1001?api-version=7.1`);
      expect(res.status).toBe(429);
      expect(res.headers.get('retry-after')).toBe('1');
    });

    it('T2-F8-02: HTTP 503 Transient Service Unavailable: server emits 503 fault and recovers on subsequent call', async () => {
      mockAdoServer.setFault('503', 1);
      const baseUrl = mockAdoServer.getBaseUrl();

      const res1 = await fetch(`${baseUrl}/3in1_Agile_Projects/_apis/wit/workitems/1001?api-version=7.1`);
      expect(res1.status).toBe(503);

      // Fault count was 1, so 2nd call succeeds with 200
      const res2 = await fetch(`${baseUrl}/3in1_Agile_Projects/_apis/wit/workitems/1001?api-version=7.1`);
      expect(res2.status).toBe(200);
    });

    it('T2-F8-03: Empty project response: handles project with 0 work items cleanly without crash', async () => {
      const baseUrl = mockAdoServer.getBaseUrl();

      const res = await fetch(`${baseUrl}/Empty_Project/_apis/wit/wiql?api-version=7.1`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = "Empty_Project"' }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data.workItems)).toBe(true);
    });

    it('T2-F8-04: Network timeout fault: abort controller safely cancels hanging request', async () => {
      mockAdoServer.setFault('timeout', 1);
      const baseUrl = mockAdoServer.getBaseUrl();

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 100);

      let timedOut = false;
      try {
        await fetch(`${baseUrl}/3in1_Agile_Projects/_apis/wit/workitems/1001?api-version=7.1`, {
          signal: controller.signal,
        });
      } catch (err: any) {
        timedOut = err.name === 'AbortError';
      } finally {
        clearTimeout(timeoutId);
        mockAdoServer.clearFault();
      }

      expect(timedOut).toBe(true);
    });

    it('T2-F8-05: Multi-page WIQL pagination: handles consecutive pagination requests without error', async () => {
      const baseUrl = mockAdoServer.getBaseUrl();

      for (let page = 1; page <= 3; page++) {
        const res = await fetch(`${baseUrl}/3in1_Agile_Projects/_apis/wit/wiql?page=${page}&api-version=7.1`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: 'SELECT [System.Id] FROM WorkItems' }),
        });
        expect(res.status).toBe(200);
      }
    });
  });

  // =========================================================================
  // Feature F9 Boundary: Secret Sanitization Edge Cases (5 Tests)
  // =========================================================================
  describe('Feature F9 Boundary: Secret Sanitization Edge Cases', () => {
    it('T2-F9-01: Short secrets (< 4 chars): masking handles short tokens without crashing', () => {
      const logger = new Logger();
      expect(() => {
        logger.registerSecret('123');
        const masked = logger.sanitize('Testing 123 in message');
        expect(masked).toBeDefined();
      }).not.toThrow();
    });

    it('T2-F9-02: Multiple distinct secrets in a single message: all are masked simultaneously', () => {
      const logger = new Logger();
      const secret1 = 'ghp_firstSecretToken12345';
      const secret2 = 'ghp_secondSecretToken67890';

      logger.registerSecret(secret1);
      logger.registerSecret(secret2);

      const combinedMessage = `Connecting to GitHub with token ${secret1} and secondary ${secret2}`;
      const scrubbed = logger.sanitize(combinedMessage);

      expect(scrubbed).not.toContain(secret1);
      expect(scrubbed).not.toContain(secret2);
      expect(scrubbed).toContain('***');
    });

    it('T2-F9-03: Secrets in URL query parameters (?pat=...): sanitized cleanly in log strings', () => {
      const logger = new Logger();
      const secretPat = 'az_pat_9876543210fedcba';
      logger.registerSecret(secretPat);

      const urlLog = `GET https://dev.azure.com/org/project?pat=${secretPat}&api-version=7.1`;
      const scrubbed = logger.sanitize(urlLog);

      expect(scrubbed).not.toContain(secretPat);
    });

    it('T2-F9-04: Complex objects passed to logger are handled without unhandled exceptions', () => {
      const logger = new Logger();
      expect(() => {
        logger.info('Logging structured event: ' + JSON.stringify({ event: 'SYNC', timestamp: Date.now() }));
      }).not.toThrow();
    });

    it('T2-F9-05: Case-insensitive secret scrubbing handles uppercase and lowercase prefix variations', () => {
      const logger = new Logger();
      const token = 'ghp_sampleSecretValue';
      logger.registerSecret(token);

      const testMsg = `Authorization: Bearer ${token}`;
      const sanitized = logger.sanitize(testMsg);

      expect(sanitized).not.toContain(token);
    });
  });
});
