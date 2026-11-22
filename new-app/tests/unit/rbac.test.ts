import { describe, expect, it } from 'vitest';
import {
  normalizeRole,
  hasRole,
  enforceRbac,
  requireAuth,
  requireRole,
  oidcAuthGuard,
  AuthenticatedUser,
} from '../../src/infrastructure/auth/rbac.js';

describe('Milestone 4 — Feature 24: Four-Tier Granular RBAC', () => {
  describe('normalizeRole()', () => {
    it('normalizes role strings regardless of casing', () => {
      expect(normalizeRole('admin')).toBe('Admin');
      expect(normalizeRole('ADMIN')).toBe('Admin');
      expect(normalizeRole('lead')).toBe('Lead');
      expect(normalizeRole('LEAD')).toBe('Lead');
      expect(normalizeRole('developer')).toBe('Developer');
      expect(normalizeRole('DEVELOPER')).toBe('Developer');
      expect(normalizeRole('auditor')).toBe('Auditor');
      expect(normalizeRole('AUDITOR')).toBe('Auditor');
    });

    it('falls back to Developer for unknown or missing role', () => {
      expect(normalizeRole('')).toBe('Developer');
      expect(normalizeRole('unknown_role')).toBe('Developer');
    });
  });

  describe('hasRole()', () => {
    const user: AuthenticatedUser = {
      id: 'u-1',
      email: 'user@workops.test',
      name: 'Test User',
      roles: ['Lead', 'Developer'],
      tenantId: 'tenant-1',
    };

    it('returns true when user has any of the allowed roles', () => {
      expect(hasRole(user, ['Lead'])).toBe(true);
      expect(hasRole(user, ['Developer'])).toBe(true);
      expect(hasRole(user, ['Admin', 'Lead'])).toBe(true);
    });

    it('returns false when user does not possess any allowed role', () => {
      expect(hasRole(user, ['Admin'])).toBe(false);
      expect(hasRole(user, ['Auditor'])).toBe(false);
    });

    it('handles undefined user safely', () => {
      expect(hasRole(undefined, ['Admin'])).toBe(false);
    });
  });

  describe('enforceRbac() permission evaluation', () => {
    it('denies Developer role from executing team plans with HTTP 403', () => {
      const res = enforceRbac('Developer', 'execute_team_plan');
      expect(res.allowed).toBe(false);
      expect(res.status).toBe(403);
      expect(res.error).toBe("Role 'Developer' cannot execute team plans.");
    });

    it('allows Lead and Admin roles to execute team plans', () => {
      expect(enforceRbac('Lead', 'execute_team_plan').allowed).toBe(true);
      expect(enforceRbac('Admin', 'execute_team_plan').allowed).toBe(true);
    });

    it('strictly denies Auditor role from any mutation action with HTTP 403', () => {
      const res = enforceRbac('Auditor', 'mutate_task');
      expect(res.allowed).toBe(false);
      expect(res.status).toBe(403);
      expect(res.error).toBe("Role 'Auditor' is read-only.");
    });

    it('denies Lead role from global tenant deletion reserved for Admin', () => {
      const res = enforceRbac('Lead', 'delete_tenant');
      expect(res.allowed).toBe(false);
      expect(res.status).toBe(403);
      expect(res.error).toBe("Global tenant management requires role 'Admin'.");
    });

    it('rejects empty roles with HTTP 403', () => {
      const res = enforceRbac('', 'any_action');
      expect(res.allowed).toBe(false);
      expect(res.status).toBe(403);
      expect(res.error).toBe('No assigned roles found for user.');
    });

    it('applies union permissions for multi-role users', () => {
      const res = enforceRbac(['Developer', 'Lead'], 'execute_team_plan');
      expect(res.allowed).toBe(true);
      expect(res.status).toBe(200);
    });
  });

  describe('Express Middlewares: requireAuth, requireRole, oidcAuthGuard', () => {
    const createMockRes = () => {
      const res: any = {};
      res.statusCode = 200;
      res.status = (code: number) => {
        res.statusCode = code;
        return res;
      };
      res.json = (body: any) => {
        res.body = body;
        return res;
      };
      return res;
    };

    it('requireAuth() allows authenticated requests and blocks unauthenticated', () => {
      const mw = requireAuth();
      let nextCalled = false;
      const next = () => {
        nextCalled = true;
      };

      // Unauthenticated
      const req1: any = {};
      const res1 = createMockRes();
      mw(req1, res1, next);
      expect(nextCalled).toBe(false);
      expect(res1.statusCode).toBe(401);

      // Authenticated
      const req2: any = { user: { id: 'u1', email: 'u1@test.com', roles: ['Developer'] } };
      const res2 = createMockRes();
      mw(req2, res2, next);
      expect(nextCalled).toBe(true);
    });

    it('requireRole() enforces allowed roles', () => {
      const mw = requireRole(['Admin', 'Lead']);
      let nextCalled = false;
      const next = () => {
        nextCalled = true;
      };

      // Developer denied
      const req1: any = { method: 'POST', user: { id: 'u1', email: 'dev@test.com', roles: ['Developer'] } };
      const res1 = createMockRes();
      mw(req1, res1, next);
      expect(nextCalled).toBe(false);
      expect(res1.statusCode).toBe(403);

      // Lead allowed
      const req2: any = { method: 'POST', user: { id: 'u2', email: 'lead@test.com', roles: ['Lead'] } };
      const res2 = createMockRes();
      mw(req2, res2, next);
      expect(nextCalled).toBe(true);
    });

    it('oidcAuthGuard() blocks Auditor on state mutations', () => {
      const guard = oidcAuthGuard();
      let nextCalled = false;
      const next = () => {
        nextCalled = true;
      };

      const req: any = { method: 'POST', user: { id: 'u-aud', email: 'auditor@test.com', roles: ['Auditor'] } };
      const res = createMockRes();
      guard(req, res, next);
      expect(nextCalled).toBe(false);
      expect(res.statusCode).toBe(403);
      expect(res.body.error).toBe("Role 'Auditor' is read-only.");
    });
  });
});
