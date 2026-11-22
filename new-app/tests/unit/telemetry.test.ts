import { describe, it, expect } from 'vitest';
import { MetricsRegistry } from '../../src/infrastructure/telemetry/metrics.js';
import { parseTraceparent, formatTraceparent, recordSpanException } from '../../src/infrastructure/telemetry/tracer.js';

describe('Feature #36: Production Observability & Prometheus Telemetry', () => {
  it('renders standard Prometheus metrics in plain text format', () => {
    const registry = new MetricsRegistry();
    registry.recordHttpRequest('GET', '/api/health', 200, 0.012);
    registry.incrementTasksCreated(5);
    registry.setActiveJobs(2);
    registry.setAzureRateLimitRemaining(85);
    registry.recordPlanDuration(0.35);

    const output = registry.renderPrometheusMetrics();

    expect(output).toContain('# HELP');
    expect(output).toContain('# TYPE');
    expect(output).toContain('http_requests_total');
    expect(output).toContain('workops_tasks_created_total 5');
    expect(output).toContain('workops_active_jobs 2');
    expect(output).toContain('workops_azure_rate_limit_remaining 85');
    expect(output).toContain('workops_plan_duration_seconds_bucket');
  });

  it('handles 64-bit BigInt counts accurately without loss of precision', () => {
    const registry = new MetricsRegistry();
    const largeCount = 9007199254740993; // > Number.MAX_SAFE_INTEGER
    registry.incrementTasksCreated(largeCount);

    const output = registry.renderPrometheusMetrics();
    expect(output).toContain(`workops_tasks_created_total ${largeCount}`);
  });

  it('validates W3C traceparent header format and propagates trace ID', () => {
    const validHeader = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
    const ctx = parseTraceparent(validHeader);

    expect(ctx.valid).toBe(true);
    expect(ctx.version).toBe('00');
    expect(ctx.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(ctx.parentId).toBe('00f067aa0ba902b7');
    expect(ctx.traceFlags).toBe('01');

    const formatted = formatTraceparent(ctx);
    expect(formatted).toBe(validHeader);
  });

  it('generates a fresh compliant trace context when given an invalid traceparent', () => {
    const invalidHeader = 'invalid-not-a-traceparent';
    const ctx = parseTraceparent(invalidHeader);

    expect(ctx.valid).toBe(false);
    expect(ctx.traceId.length).toBe(32);
    expect(ctx.parentId.length).toBe(16);
    expect(ctx.version).toBe('00');
  });

  it('formats span exception event on error', () => {
    const err = new Error('Database connection pool exhausted');
    const span = recordSpanException(err);

    expect(span.spanStatus).toBe('ERROR');
    expect(span.event).toBe('exception');
    expect(span.errorMessage).toBe('Database connection pool exhausted');
    expect(span.stack).toBeDefined();
  });
});
