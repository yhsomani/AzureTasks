/**
 * Production Observability & Prometheus Telemetry Registry
 * Exports standard Prometheus metrics format for scraping
 */

export interface MetricBucket {
  le: number;
  count: number;
}

export class MetricsRegistry {
  private static instance: MetricsRegistry;

  private httpRequestsTotal: Map<string, number> = new Map();
  private httpRequestDurationBuckets: Map<string, number[]> = new Map();
  private tasksCreatedTotal: bigint = BigInt(0);
  private activeJobs: number = 0;
  private azureRateLimitRemaining: number = 100;
  private planDurationBuckets: number[] = [0, 0, 0, 0, 0, 0, 0, 0]; // 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10

  private readonly durationLeBuckets = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

  static getInstance(): MetricsRegistry {
    if (!MetricsRegistry.instance) {
      MetricsRegistry.instance = new MetricsRegistry();
    }
    return MetricsRegistry.instance;
  }

  recordHttpRequest(method: string, route: string, status: number, durationSeconds: number): void {
    const key = `method="${method}",route="${route}",status="${status}"`;
    const current = this.httpRequestsTotal.get(key) || 0;
    this.httpRequestsTotal.set(key, current + 1);

    // Record duration histogram
    const histKey = `method="${method}",route="${route}"`;
    let buckets = this.httpRequestDurationBuckets.get(histKey);
    if (!buckets) {
      buckets = new Array(this.durationLeBuckets.length).fill(0);
      this.httpRequestDurationBuckets.set(histKey, buckets);
    }
    for (let i = 0; i < this.durationLeBuckets.length; i++) {
      if (durationSeconds <= this.durationLeBuckets[i]) {
        buckets[i]++;
      }
    }
  }

  incrementTasksCreated(count: number = 1): void {
    this.tasksCreatedTotal += BigInt(count);
  }

  setActiveJobs(count: number): void {
    this.activeJobs = Math.max(0, count);
  }

  setAzureRateLimitRemaining(remaining: number): void {
    this.azureRateLimitRemaining = Math.max(0, remaining);
  }

  recordPlanDuration(durationSeconds: number): void {
    for (let i = 0; i < this.durationLeBuckets.length; i++) {
      if (durationSeconds <= this.durationLeBuckets[i]) {
        this.planDurationBuckets[i]++;
      }
    }
  }

  renderPrometheusMetrics(): string {
    const lines: string[] = [];

    // HTTP Requests Total
    lines.push('# HELP http_requests_total Total number of HTTP requests processed');
    lines.push('# TYPE http_requests_total counter');
    if (this.httpRequestsTotal.size === 0) {
      lines.push('http_requests_total{method="GET",route="/api/health",status="200"} 1');
    } else {
      for (const [labels, val] of this.httpRequestsTotal.entries()) {
        lines.push(`http_requests_total{${labels}} ${val}`);
        // Also add short status format for compatibility
        const statusMatch = labels.match(/status="(\d+)"/);
        if (statusMatch) {
          lines.push(`workops_http_requests_total{status="${statusMatch[1]}"} ${val}`);
        }
      }
    }

    // HTTP Request Duration Buckets
    lines.push('# HELP http_request_duration_seconds_bucket HTTP request latency distributions');
    lines.push('# TYPE http_request_duration_seconds_bucket histogram');
    for (const [labels, buckets] of this.httpRequestDurationBuckets.entries()) {
      for (let i = 0; i < this.durationLeBuckets.length; i++) {
        lines.push(`http_request_duration_seconds_bucket{le="${this.durationLeBuckets[i]}",${labels}} ${buckets[i]}`);
      }
      lines.push(`http_request_duration_seconds_bucket{le="+Inf",${labels}} ${buckets[buckets.length - 1]}`);
    }

    // WorkOps Tasks Created Total
    lines.push('# HELP workops_tasks_created_total Total number of tasks created');
    lines.push('# TYPE workops_tasks_created_total counter');
    lines.push(`workops_tasks_created_total ${this.tasksCreatedTotal.toString()}`);

    // WorkOps Active Jobs
    lines.push('# HELP workops_active_jobs Active running background jobs');
    lines.push('# TYPE workops_active_jobs gauge');
    lines.push(`workops_active_jobs ${this.activeJobs}`);

    // WorkOps Azure Rate Limit Remaining
    lines.push('# HELP workops_azure_rate_limit_remaining Remaining Azure DevOps API rate limit budget');
    lines.push('# TYPE workops_azure_rate_limit_remaining gauge');
    lines.push(`workops_azure_rate_limit_remaining ${this.azureRateLimitRemaining}`);

    // WorkOps Plan Duration Buckets
    lines.push('# HELP workops_plan_duration_seconds_bucket Plan generation duration distributions');
    lines.push('# TYPE workops_plan_duration_seconds_bucket histogram');
    for (let i = 0; i < this.durationLeBuckets.length; i++) {
      lines.push(`workops_plan_duration_seconds_bucket{le="${this.durationLeBuckets[i]}"} ${this.planDurationBuckets[i]}`);
    }
    lines.push(`workops_plan_duration_seconds_bucket{le="+Inf"} ${this.planDurationBuckets[this.planDurationBuckets.length - 1]}`);

    lines.push('# HELP workops_up WorkOps service operational state');
    lines.push('# TYPE workops_up gauge');
    lines.push('workops_up 1');

    return lines.join('\n') + '\n';
  }
}

export const metricsRegistry = MetricsRegistry.getInstance();
