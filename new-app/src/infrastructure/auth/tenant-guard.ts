import { Request, Response, NextFunction, RequestHandler } from 'express';
import { TenantContext } from '../../domain/entities/tenant.js';

declare global {
  namespace Express {
    interface Request {
      tenant?: TenantContext;
    }
  }
}

export interface TenantGuardOptions {
  requireTenant?: boolean;
  headerName?: string;
}

/**
 * Tenant Isolation Guard Middleware
 * Scopes incoming HTTP requests to an authenticated tenant.
 * Prevents cross-tenant data access leakage by enforcing matching tenant identity.
 */
export function tenantGuard(options: TenantGuardOptions = {}): RequestHandler {
  const headerKey = options.headerName?.toLowerCase() || 'x-tenant-id';
  const requireTenant = options.requireTenant ?? false;

  return (req: Request, res: Response, next: NextFunction): void => {
    const rawHeader = req.headers[headerKey];
    const headerTenant = Array.isArray(rawHeader) ? rawHeader[0]?.trim() : rawHeader?.trim();
    const queryTenant = typeof req.query.tenantId === 'string' ? req.query.tenantId.trim() : undefined;
    const userTenant = req.user?.tenantId?.trim();

    const targetTenantId = headerTenant || queryTenant || userTenant;

    if (!targetTenantId) {
      if (requireTenant) {
        res.status(400).json({
          success: false,
          error: 'TENANT_IDENTIFIER_REQUIRED',
          message: 'A valid X-Tenant-ID header or authenticated tenant context is required.',
        });
        return;
      }
      return next();
    }

    // Cross-tenant access validation:
    // If the user has an assigned tenant and attempts to access a different tenant,
    // verify authorization (Admin role required to span multiple tenants).
    if (userTenant && targetTenantId && userTenant !== targetTenantId) {
      const isAdmin = req.user?.roles?.includes('Admin');
      if (!isAdmin) {
        res.status(403).json({
          success: false,
          error: 'CROSS_TENANT_ACCESS_FORBIDDEN',
          message: `Authenticated user from tenant '${userTenant}' is not authorized to access tenant '${targetTenantId}'.`,
        });
        return;
      }
    }

    // Populate tenant context onto the request object
    req.tenant = {
      organizationId: targetTenantId,
      teamId: typeof req.query.teamId === 'string' ? req.query.teamId.trim() : undefined,
      departmentId: typeof req.query.deptId === 'string' ? req.query.deptId.trim() : undefined,
    };

    next();
  };
}
