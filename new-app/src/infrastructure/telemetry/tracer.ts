import * as crypto from 'node:crypto';
import { Request, Response, NextFunction, RequestHandler } from 'express';
import { metricsRegistry } from './metrics.js';

declare global {
  namespace Express {
    interface Request {
      traceId?: string;
      spanId?: string;
    }
  }
}

export interface TraceContext {
  valid: boolean;
  version: string;
  traceId: string;
  parentId: string;
  traceFlags: string;
}

export interface SpanExceptionEvent {
  spanStatus: 'ERROR';
  event: 'exception';
  errorMessage: string;
  stack?: string;
}

/**
 * Parse W3C traceparent header or generate a fresh valid trace context
 */
export function parseTraceparent(header?: string): TraceContext {
  const regex = /^00-([a-f0-9]{32})-([a-f0-9]{16})-([a-f0-9]{2})$/;
  if (header && regex.test(header.trim())) {
    const parts = header.trim().split('-');
    return {
      valid: true,
      version: parts[0],
      traceId: parts[1],
      parentId: parts[2],
      traceFlags: parts[3],
    };
  }

  // Generate fresh valid trace context
  return {
    valid: false,
    version: '00',
    traceId: crypto.randomBytes(16).toString('hex'),
    parentId: crypto.randomBytes(8).toString('hex'),
    traceFlags: '01',
  };
}

/**
 * Format trace context into W3C traceparent header string
 */
export function formatTraceparent(context: TraceContext): string {
  return `${context.version}-${context.traceId}-${context.parentId}-${context.traceFlags}`;
}

/**
 * Record an exception event formatted for OpenTelemetry span export
 */
export function recordSpanException(err: Error): SpanExceptionEvent {
  return {
    spanStatus: 'ERROR',
    event: 'exception',
    errorMessage: err.message,
    stack: err.stack,
  };
}

/**
 * Express Middleware for W3C Distributed Tracing and Latency Telemetry
 */
export function tracingMiddleware(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const rawHeader = req.headers['traceparent'] as string | undefined;
    const traceCtx = parseTraceparent(rawHeader);

    req.traceId = traceCtx.traceId;
    req.spanId = traceCtx.parentId;

    const outgoingTraceparent = formatTraceparent(traceCtx);
    res.setHeader('traceparent', outgoingTraceparent);
    res.setHeader('X-Trace-ID', traceCtx.traceId);

    const startTime = performance.now();

    res.on('finish', () => {
      const durationSeconds = (performance.now() - startTime) / 1000;
      const routePath = req.baseUrl ? `${req.baseUrl}${req.path}` : req.path;
      metricsRegistry.recordHttpRequest(req.method, routePath || '/', res.statusCode, durationSeconds);
    });

    next();
  };
}
