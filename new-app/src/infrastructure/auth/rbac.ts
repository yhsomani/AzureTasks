import { Request, Response, NextFunction, RequestHandler } from 'express';

export type Role = 'Admin' | 'Lead' | 'Developer' | 'Auditor';

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  roles: Role[];
  tenantId: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      authUser?: string;
      authRole?: string;
    }
  }
}

/**
 * Normalize role string to title case (Admin, Lead, Developer, Auditor).
 */
export function normalizeRole(role: string): Role {
  if (!role || typeof role !== 'string') return 'Developer';
  const clean = role.trim();
  const lower = clean.toLowerCase();
  if (lower === 'admin') return 'Admin';
  if (lower === 'lead') return 'Lead';
  if (lower === 'auditor') return 'Auditor';
  if (lower === 'developer') return 'Developer';
  return 'Developer';
}

/**
 * Check whether a user possesses at least one of the allowed roles.
 */
export function hasRole(user: AuthenticatedUser | undefined, allowedRoles: Role[]): boolean {
  if (!user || !Array.isArray(user.roles) || user.roles.length === 0) {
    return false;
  }
  const normalizedAllowed = new Set(allowedRoles.map((r) => normalizeRole(r)));
  return user.roles.some((r) => normalizedAllowed.has(normalizeRole(r)));
}

/**
 * Standard RBAC permission evaluation helper.
 * Strictly adheres to WorkOps Governance and Security specification.
 */
export function enforceRbac(
  roleOrRoles: string | string[] | undefined,
  action: string
): { allowed: boolean; status: number; error?: string } {
  if (!roleOrRoles) {
    return { allowed: false, status: 403, error: 'No assigned roles found for user.' };
  }

  const rawRoles = Array.isArray(roleOrRoles) ? roleOrRoles : [roleOrRoles];
  const validRoles = rawRoles.filter((r) => typeof r === 'string' && r.trim().length > 0);

  if (validRoles.length === 0) {
    return { allowed: false, status: 403, error: 'No assigned roles found for user.' };
  }

  const normalizedRoles = validRoles.map(
    (r) => r.charAt(0).toUpperCase() + r.slice(1).toLowerCase()
  );

  if (action === 'execute_team_plan' && !normalizedRoles.some((r) => ['Lead', 'Admin'].includes(r))) {
    const displayRole = Array.isArray(roleOrRoles) ? roleOrRoles.join(', ') : roleOrRoles;
    return { allowed: false, status: 403, error: `Role '${displayRole}' cannot execute team plans.` };
  }

  if (
    action === 'mutate_task' &&
    normalizedRoles.includes('Auditor') &&
    !normalizedRoles.some((r) => ['Admin', 'Lead', 'Developer'].includes(r))
  ) {
    return { allowed: false, status: 403, error: "Role 'Auditor' is read-only." };
  }

  if (action === 'delete_tenant' && !normalizedRoles.includes('Admin')) {
    return { allowed: false, status: 403, error: "Global tenant management requires role 'Admin'." };
  }

  return { allowed: true, status: 200 };
}

/**
 * Middleware requiring an authenticated user session.
 */
export function requireAuth(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: 'Authentication required. Missing or invalid authentication token.',
      });
      return;
    }
    next();
  };
}

/**
 * Middleware requiring specific RBAC roles.
 * Blocks read-only Auditor role from performing any state mutations.
 */
export function requireRole(allowedRoles: Role[]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: 'Authentication required before role verification.',
      });
      return;
    }

    if (!req.user.roles || req.user.roles.length === 0) {
      res.status(403).json({
        success: false,
        error: 'No assigned roles found for user.',
      });
      return;
    }

    const isMutation = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method.toUpperCase());
    const isAuditorOnly =
      req.user.roles.includes('Auditor') &&
      !req.user.roles.some((r) => ['Admin', 'Lead', 'Developer'].includes(r));

    if (isMutation && isAuditorOnly) {
      res.status(403).json({
        success: false,
        error: "Role 'Auditor' is read-only.",
      });
      return;
    }

    if (!hasRole(req.user, allowedRoles)) {
      res.status(403).json({
        success: false,
        error: `Insufficient permissions. Allowed roles: ${allowedRoles.join(', ')}.`,
      });
      return;
    }

    next();
  };
}

/**
 * Combined OIDC Authentication and RBAC Guard Middleware.
 */
export function oidcAuthGuard(allowedRoles?: Role[]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: 'Authentication required. Valid OIDC bearer token or session required.',
      });
      return;
    }

    const isMutation = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method.toUpperCase());
    const isAuditorOnly =
      req.user.roles.includes('Auditor') &&
      !req.user.roles.some((r) => ['Admin', 'Lead', 'Developer'].includes(r));

    if (isMutation && isAuditorOnly) {
      res.status(403).json({
        success: false,
        error: "Role 'Auditor' is read-only.",
      });
      return;
    }

    if (allowedRoles && allowedRoles.length > 0) {
      if (!hasRole(req.user, allowedRoles)) {
        res.status(403).json({
          success: false,
          error: `Insufficient permissions. Allowed roles: ${allowedRoles.join(', ')}.`,
        });
        return;
      }
    }

    next();
  };
}

export {
  sanitizeOperatorEmail,
  resolveOperator,
  ImmutableJournalEntry,
} from './identity.js';
