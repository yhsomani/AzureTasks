/**
 * Rate Limiting Middleware
 * Protects API endpoints from abuse with configurable limits per endpoint group
 */

import rateLimit from 'express-rate-limit';
import { logger } from '../../infrastructure/logging/logger.js';

/**
 * Rate Limiting Configuration
 */
export const RATE_LIMIT_CONFIG = {
  general: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    statusCode: 429,
  },
  strict: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 30,
    statusCode: 429,
  },
  auth: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5,
    statusCode: 429,
  },
  bulk: {
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10,
    statusCode: 429,
  },
} as const;

/**
 * Store for rate limit violations (in-memory)
 * In production, this should be replaced with a persistent store like Redis
 */
export const violationLog = new Map<string, number[]>();

/**
 * Log rate limit violations for monitoring and alerting
 */
export function logViolation(ip: string, endpoint: string, limit: number, windowMs: number): void {
  const key = `${ip}:${endpoint}`;
  const now = Date.now();
  const windowStart = now - windowMs;

  if (!violationLog.has(key)) {
    violationLog.set(key, []);
  }

  const timestamps = violationLog.get(key)!;
  const recentViolations = timestamps.filter(t => t > windowStart);
  recentViolations.push(now);

  if (recentViolations.length === 1) {
    logger.warn(`Rate limit violation: IP ${ip} hit rate limit on ${endpoint}. Limit: ${limit} requests per ${windowMs / 1000 / 60} minutes.`);
  } else if (recentViolations.length % 5 === 0) {
    logger.error(`Repeated rate limit violation: IP ${ip} (${recentViolations.length} violations in window) on ${endpoint}. Possible abuse attempt.`);
  }

  violationLog.set(key, recentViolations);
}

/**
 * Cleanup old violation logs every hour to prevent memory leak
 */
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  const maxAge = 60 * 60 * 1000; // 1 hour

  for (const [key, timestamps] of violationLog.entries()) {
    const recent = timestamps.filter(t => now - t < maxAge);
    if (recent.length === 0) {
      violationLog.delete(key);
    } else {
      violationLog.set(key, recent);
    }
  }
}, 60 * 60 * 1000);
cleanupInterval.unref();

/**
 * General API rate limiter: 100 requests per 15 minutes per IP
 */
export const generalLimiter = rateLimit({
  windowMs: RATE_LIMIT_CONFIG.general.windowMs,
  max: RATE_LIMIT_CONFIG.general.max,
  message: 'Too many requests from this IP, please try again later.',
  statusCode: RATE_LIMIT_CONFIG.general.statusCode,
  standardHeaders: false,
  skip: (req) => {
    // Skip rate limiting for health check and session endpoints
    return req.path === '/api/health' || req.path === '/api/session';
  },
  handler: (_req, res, _next, options) => {
    const ip = _req.ip || 'unknown';
    logViolation(ip, _req.path, options.max as number, options.windowMs);
    res.status(options.statusCode).json({
      success: false,
      error: 'Rate limit exceeded. Please try again later.',
    });
  },
  keyGenerator: (req) => req.ip || 'unknown',
});

/**
 * Strict limiter for mutation endpoints: 30 requests per 15 minutes per IP
 * Applied to POST, PUT, PATCH, DELETE endpoints
 */
export const strictLimiter = rateLimit({
  windowMs: RATE_LIMIT_CONFIG.strict.windowMs,
  max: RATE_LIMIT_CONFIG.strict.max,
  message: 'Too many requests from this IP, please try again later.',
  statusCode: RATE_LIMIT_CONFIG.strict.statusCode,
  standardHeaders: false,
  skip: (req) => {
    // Only apply to mutation methods
    return !['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method.toUpperCase());
  },
  handler: (_req, res, _next, options) => {
    const ip = _req.ip || 'unknown';
    logViolation(ip, _req.path, options.max as number, options.windowMs);
    res.status(options.statusCode).json({
      success: false,
      error: 'Too many requests. Please wait before making more changes.',
    });
  },
  keyGenerator: (req) => req.ip || 'unknown',
});

/**
 * Auth endpoint limiter: 5 requests per 15 minutes per IP
 * Prevents brute force attacks on authentication endpoints
 */
export const authLimiter = rateLimit({
  windowMs: RATE_LIMIT_CONFIG.auth.windowMs,
  max: RATE_LIMIT_CONFIG.auth.max,
  message: 'Too many authentication attempts, please try again later.',
  statusCode: RATE_LIMIT_CONFIG.auth.statusCode,
  standardHeaders: false,
  skip: (req) => {
    // Only apply to auth / session requests and never health
    const path = (req.path || '').toLowerCase();
    if (path === '/api/health') return true;
    return !path.includes('auth') && !path.includes('session') && !path.includes('login');
  },
  handler: (_req, res, _next, options) => {
    const ip = _req.ip || 'unknown';
    logViolation(ip, 'auth', options.max as number, options.windowMs);
    res.status(options.statusCode).json({
      success: false,
      error: 'Too many authentication attempts. Please try again in 15 minutes.',
    });
  },
  keyGenerator: (req) => req.ip || 'unknown',
});

/**
 * Bulk operations limiter: 10 requests per hour per IP
 * Prevents bulk operations from overwhelming the system
 */
export const bulkOperationsLimiter = rateLimit({
  windowMs: RATE_LIMIT_CONFIG.bulk.windowMs,
  max: RATE_LIMIT_CONFIG.bulk.max,
  message: 'Too many bulk operations, please try again later.',
  statusCode: RATE_LIMIT_CONFIG.bulk.statusCode,
  standardHeaders: false,
  skip: (req) => {
    // Only apply to bulk operation endpoints
    const path = req.path.toLowerCase();
    return !path.includes('bulk') && !path.includes('batch');
  },
  handler: (_req, res, _next, options) => {
    const ip = _req.ip || 'unknown';
    logViolation(ip, 'bulk-operations', options.max as number, options.windowMs);
    res.status(options.statusCode).json({
      success: false,
      error: 'Too many bulk operations. Please try again in 1 hour.',
    });
  },
  keyGenerator: (req) => req.ip || 'unknown',
});
