import { describe, it, expect, vi } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { tenantGuard } from '../../src/infrastructure/auth/tenant-guard.js';

describe('Feature #33: Multi-Tenant Architecture & Tenant Guard', () => {
  function createMockReqRes(options: {
    headers?: Record<string, string>;
    query?: Record<string, string>;
    user?: any;
  }) {
    const req = {
      headers: options.headers || {},
      query: options.query || {},
      user: options.user,
    } as unknown as Request;

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as unknown as Response;

    const next = vi.fn() as unknown as NextFunction;

    return { req, res, next };
  }

  it('allows access and attaches tenant context when X-Tenant-ID header matches user tenant', () => {
    const middleware = tenantGuard();
    const { req, res, next } = createMockReqRes({
      headers: { 'x-tenant-id': 'org-alpha' },
      user: { tenantId: 'org-alpha', roles: ['Developer'] },
    });

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.tenant?.organizationId).toBe('org-alpha');
  });

  it('rejects cross-tenant access for non-admin user with 403 Forbidden', () => {
    const middleware = tenantGuard();
    const { req, res, next } = createMockReqRes({
      headers: { 'x-tenant-id': 'org-beta' },
      user: { tenantId: 'org-alpha', roles: ['Developer'] },
    });

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'CROSS_TENANT_ACCESS_FORBIDDEN',
        message: "Authenticated user from tenant 'org-alpha' is not authorized to access tenant 'org-beta'.",
      })
    );
  });

  it('rejects cross-tenant access via query parameter without header for non-admin user with 403 Forbidden', () => {
    const middleware = tenantGuard();
    const { req, res, next } = createMockReqRes({
      query: { tenantId: 'victim-org' },
      user: { tenantId: 'org-alpha', roles: ['Developer'] },
    });

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'CROSS_TENANT_ACCESS_FORBIDDEN',
      message: "Authenticated user from tenant 'org-alpha' is not authorized to access tenant 'victim-org'.",
    });
  });

  it('allows cross-tenant access via query parameter when authenticated user has Admin role', () => {
    const middleware = tenantGuard();
    const { req, res, next } = createMockReqRes({
      query: { tenantId: 'victim-org' },
      user: { tenantId: 'org-alpha', roles: ['Admin'] },
    });

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.tenant?.organizationId).toBe('victim-org');
  });

  it('allows cross-tenant access when authenticated user has Admin role', () => {
    const middleware = tenantGuard();
    const { req, res, next } = createMockReqRes({
      headers: { 'x-tenant-id': 'org-beta' },
      user: { tenantId: 'org-alpha', roles: ['Admin'] },
    });

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.tenant?.organizationId).toBe('org-beta');
  });

  it('rejects when requireTenant is true and no tenant context is provided', () => {
    const middleware = tenantGuard({ requireTenant: true });
    const { req, res, next } = createMockReqRes({});

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'TENANT_IDENTIFIER_REQUIRED',
      })
    );
  });
});
