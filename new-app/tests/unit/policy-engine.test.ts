import { describe, expect, it } from 'vitest';
import {
  VerifiedAutoClosurePolicyEngine,
  DeliverableEvidence,
} from '../../src/domain/services/policy-engine.js';
import { AuthenticatedUser } from '../../src/infrastructure/auth/rbac.js';

describe('Milestone 4 — Feature 26: Verified Auto-Closure Policy Engine', () => {
  const engine = new VerifiedAutoClosurePolicyEngine();
  const sampleTask = {
    id: 8001,
    fields: {
      'System.Title': 'Task: Dev One | Sprint 1 | 2026-11-21',
      'System.State': 'In Progress',
    },
  };

  describe('Deliverable Verification Gating', () => {
    it('approves auto-closure when verified GitHub PR exists for the target date', async () => {
      const evidence: DeliverableEvidence = {
        pullRequests: [
          {
            id: 101,
            number: 101,
            title: 'feat: add task closure verification',
            state: 'closed',
            created_at: '2026-11-21T10:00:00Z',
            isDraft: false,
            commitsCount: 3,
          },
        ],
        sourceDate: '2026-11-21',
      };

      const decision = await engine.evaluateClosure(sampleTask, evidence, {
        targetDate: '2026-11-21',
        timezone: 'UTC',
      });

      expect(decision.status).toBe('AUTO_CLOSE_ELIGIBLE');
      expect(decision.taskClosed).toBe(true);
      expect(decision.reason).toContain('Verified 1 pull request');
    });

    it('approves auto-closure when verified commit evidence exists for target date', async () => {
      const evidence: DeliverableEvidence = {
        pullRequests: [],
        commits: [
          {
            sha: 'commit-sha-123',
            commit: {
              author: { name: 'Dev One', email: 'dev1@workops.test', date: '2026-11-21T14:30:00Z' },
              message: 'fix: complete daily deliverables',
            },
          },
        ],
        sourceDate: '2026-11-21',
      };

      const decision = await engine.evaluateClosure(sampleTask, evidence, {
        targetDate: '2026-11-21',
        timezone: 'UTC',
      });

      expect(decision.status).toBe('AUTO_CLOSE_ELIGIBLE');
      expect(decision.taskClosed).toBe(true);
    });

    it('flags task as NEEDS_REVIEW when zero deliverables are found', async () => {
      const evidence: DeliverableEvidence = {
        pullRequests: [],
        commits: [],
        sourceDate: '2026-11-21',
      };

      const decision = await engine.evaluateClosure(sampleTask, evidence, {
        targetDate: '2026-11-21',
        timezone: 'UTC',
      });

      expect(decision.status).toBe('NEEDS_REVIEW');
      expect(decision.taskClosed).toBe(false);
      expect(decision.warningLogged).toBe(true);
      expect(decision.reason).toContain('Zero verified deliverables');
    });

    it('flags task as NEEDS_REVIEW when PR was created on a different calendar date', async () => {
      const evidence: DeliverableEvidence = {
        pullRequests: [
          {
            id: 102,
            title: 'stale PR',
            created_at: '2026-11-15T10:00:00Z', // Different date
            isDraft: false,
            commitsCount: 2,
          },
        ],
        sourceDate: '2026-11-21',
      };

      const decision = await engine.evaluateClosure(sampleTask, evidence, {
        targetDate: '2026-11-21',
        timezone: 'UTC',
      });

      expect(decision.status).toBe('NEEDS_REVIEW');
      expect(decision.taskClosed).toBe(false);
      expect(decision.reason).toContain('Stale deliverable: PR created on different calendar date');
    });

    it('flags task as NEEDS_REVIEW for empty draft PR with zero commits', async () => {
      const evidence: DeliverableEvidence = {
        pullRequests: [
          {
            id: 103,
            title: 'empty draft PR',
            created_at: '2026-11-21T10:00:00Z',
            isDraft: true,
            commitsCount: 0,
          },
        ],
        sourceDate: '2026-11-21',
      };

      const decision = await engine.evaluateClosure(sampleTask, evidence, {
        targetDate: '2026-11-21',
        timezone: 'UTC',
      });

      expect(decision.status).toBe('NEEDS_REVIEW');
      expect(decision.reason).toContain('Draft PR with zero commits does not satisfy work verification');
    });
  });

  describe('Boundary & Error Handling', () => {
    it('defers evaluation on GitHub rate limit (HTTP 429)', async () => {
      const evidence: DeliverableEvidence = {
        pullRequests: [],
        rateLimited: true,
        error: 'Rate limit exceeded (HTTP 429)',
      };

      const decision = await engine.evaluateClosure(sampleTask, evidence, {
        targetDate: '2026-11-21',
      });

      expect(decision.status).toBe('EVALUATION_DEFERRED');
      expect(decision.retryNextCycle).toBe(true);
      expect(decision.taskState).toBe('In Progress');
    });

    it('fails safe with NEEDS_REVIEW on GitHub repository 404', async () => {
      const evidence: DeliverableEvidence = {
        pullRequests: [],
        repoNotFound: true,
        error: 'Not Found (HTTP 404)',
      };

      const decision = await engine.evaluateClosure(sampleTask, evidence, {
        targetDate: '2026-11-21',
      });

      expect(decision.status).toBe('NEEDS_REVIEW');
      expect(decision.warningLogged).toBe(true);
      expect(decision.taskClosed).toBe(false);
    });

    it('exempts task from auto-closure when member is on approved calendar leave', async () => {
      const evidence: DeliverableEvidence = { pullRequests: [] };
      const decision = await engine.evaluateClosure(sampleTask, evidence, {
        targetDate: '2026-11-21',
        isLeave: true,
      });

      expect(decision.status).toBe('EXEMPT_LEAVE');
      expect(decision.taskClosed).toBe(false);
    });

    it('evaluates timezone boundary correctly for late-night commits', async () => {
      // 18:15 UTC on Nov 21 is 23:45 IST on Nov 21
      const evidence: DeliverableEvidence = {
        pullRequests: [],
        commits: [
          {
            sha: 'late-night-sha',
            commit: {
              author: { date: '2026-11-21T18:15:00Z' },
              message: 'late commit in IST',
            },
          },
        ],
      };

      const decision = await engine.evaluateClosure(sampleTask, evidence, {
        targetDate: '2026-11-21',
        timezone: 'Asia/Kolkata',
      });

      expect(decision.status).toBe('AUTO_CLOSE_ELIGIBLE');
      expect(decision.taskClosed).toBe(true);
    });
  });

  describe('Manual Override Policy', () => {
    const flaggedDecision = {
      status: 'NEEDS_REVIEW' as const,
      reason: 'Zero deliverables found',
      taskClosed: false,
    };

    it('allows Admin or Lead role to manually override a flagged task', () => {
      const leadUser: AuthenticatedUser = {
        id: 'user-lead',
        email: 'lead@workops.test',
        name: 'Tech Lead',
        roles: ['Lead'],
        tenantId: 'tenant-1',
      };

      const overridden = engine.evaluateManualOverride(
        flaggedDecision,
        leadUser,
        'Approved by team lead: offline client migration deliverable'
      );

      expect(overridden.status).toBe('AUTO_CLOSE_ELIGIBLE');
      expect(overridden.taskClosed).toBe(true);
      expect(overridden.manualOverride?.allowed).toBe(true);
      expect(overridden.manualOverride?.overrideRole).toBe('Lead');
      expect(overridden.manualOverride?.operatorEmail).toBe('lead@workops.test');
      expect(overridden.reason).toContain('offline client migration deliverable');
    });

    it('rejects manual override if operator has Developer or Auditor role only', () => {
      const devUser: AuthenticatedUser = {
        id: 'user-dev',
        email: 'dev@workops.test',
        name: 'Developer One',
        roles: ['Developer'],
        tenantId: 'tenant-1',
      };

      expect(() => {
        engine.evaluateManualOverride(flaggedDecision, devUser, 'I completed the task');
      }).toThrow("Manual override policy requires role 'Admin' or 'Lead'");
    });

    it('rejects manual override without a valid justification reason', () => {
      const adminUser: AuthenticatedUser = {
        id: 'user-admin',
        email: 'admin@workops.test',
        name: 'Admin',
        roles: ['Admin'],
        tenantId: 'tenant-1',
      };

      expect(() => {
        engine.evaluateManualOverride(flaggedDecision, adminUser, '   ');
      }).toThrow('Manual override requires an attributed justification reason');
    });
  });
});
