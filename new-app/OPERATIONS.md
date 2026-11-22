# WorkOps Platform — Production Operations Runbook

## 1. System Architecture Overview
WorkOps is an enterprise Engineering Work Operations Platform built on Hexagonal Clean Architecture. It provides task lifecycle planning, automated immutable execution, verified auto-closure policy gating, multi-tenancy, and deep telemetry.

```
                    +---------------------------+
                    |    Kubernetes Ingress     |
                    +-------------+-------------+
                                  |
               +------------------+------------------+
               |                                     |
               v                                     v
       +---------------+                     +---------------+
       |  HTTP Web UI  |                     | Worker Daemon |
       | (Port 3000)   |                     | (Standalone)  |
       +-------+-------+                     +-------+-------+
               |                                     |
    +----------+----------+               +----------+----------+
    |                     |               |                     |
    v                     v               v                     v
+--------+           +---------+     +---------+           +---------+
| SQLite |           | Azure   |     | Redis / |           | Teams / |
| WAL /  |           | DevOps  |     | Postgres|           | Slack   |
| Postgres           | REST    |     | Lock    |           | Webhook |
+--------+           +---------+     +---------+           +---------+
```

---

## 2. Environment Variables & Configuration Reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `3000` | Unprivileged HTTP server port. |
| `NODE_ENV` | Yes | `production` | Environment mode (`production` or `development`). |
| `DATABASE_URL` | No | `sqlite:./data/workops.db` | Relational database connection string (SQLite WAL or PostgreSQL). |
| `AZURE_DEVOPS_ORG_URL` | Yes | - | Azure DevOps organization base URL (e.g., `https://dev.azure.com/my-org`). |
| `AZURE_DEVOPS_PROJECT` | Yes | - | Primary Azure DevOps team project name. |
| `AZURE_DEVOPS_PAT` | Yes | - | Azure DevOps Personal Access Token (Work Items Read & Write). |
| `GITHUB_TOKEN` | Yes | - | GitHub token for PR deliverable and commit verification. |
| `PLAN_SIGNING_SECRET` | Yes | - | HMAC-SHA256 signing secret for the Immutable Plan Protocol. |
| `API_AUTH_TOKEN` | Yes | - | HTTP Basic authentication operator token. |
| `API_AUTH_USER` | No | `admin` | Operator username for HTTP Basic authentication. |
| `API_VIEWER_TOKEN` | No | - | Read-only compliance auditor credential token. |
| `METRICS_AUTH_TOKEN` | No | - | Bearer token for Prometheus metrics endpoint access restriction. |
| `TEAMS_WEBHOOK_URL` | No | - | Microsoft Teams incoming webhook for Adaptive Cards. |
| `SLACK_WEBHOOK_URL` | No | - | Slack incoming webhook for Block Kit notifications. |
| `TIMEZONE` | No | `UTC` | Default operational timezone for task cycles and scheduling. |

---

## 3. Container & Helm Deployment (AKS & ACA)

### 3.1 Container Packaging
The multi-stage `Dockerfile` uses `node:22-alpine` and drops privileges to non-root user `workops` (`UID 10001`):
```bash
# Build production image
docker build -t workops:2.0.0 .

# Run container with unprivileged port 3000
docker run -d \
  --name workops \
  -p 3000:3000 \
  --env-file .env \
  workops:2.0.0
```

### 3.2 Helm Chart Deployment on Kubernetes (AKS)
```bash
# Lint the Helm chart
helm lint chart/

# Dry-run template rendering
helm template workops chart/ -f chart/values.yaml

# Deploy or upgrade in production namespace
helm upgrade --install workops chart/ \
  --namespace workops-prod \
  --create-namespace \
  -f chart/values.yaml \
  --set image.tag="2.0.0"
```

### 3.3 Azure Container Apps (ACA) Deployment
```bash
# Deploy to ACA environment
az containerapp create \
  --name workops-app \
  --resource-group rg-workops-prod \
  --environment managedEnv-workops \
  --image workops:2.0.0 \
  --target-port 3000 \
  --ingress external \
  --min-replicas 2 \
  --max-replicas 10 \
  --cpu 1.0 \
  --memory 2.0Gi
```

---

## 4. Autoscaling & High Availability

- **Horizontal Pod Autoscaler (HPA)**:
  - Minimum replicas: `2`
  - Maximum replicas: `10`
  - Scale trigger: `80%` average CPU utilization or `80%` average Memory utilization.
- **Mutual Exclusion & Clustering**:
  - Web processes are stateless behind the load balancer.
  - Task execution and cron scheduling are guarded by distributed locks (`distributed_locks` table or Redis).

---

## 5. Health Probes & Lifecycle Semantics

### 5.1 Liveness Probe (`GET /api/health`)
- **Purpose**: Kubernetes kubelet container liveness verification.
- **Port**: `3000`
- **Response**: HTTP 200 `{ "status": "alive", "uptime": 3600, "timestamp": "...", "version": "2.0.0" }`.
- **Failure Condition**: Process hang or fatal unhandled event loop stall (triggers pod restart).

### 5.2 Readiness Probe (`GET /api/ready`)
- **Purpose**: Traffic routing eligibility probe.
- **Checks**:
  1. Database connectivity (`SELECT 1`)
  2. Secret manager / Key Vault availability
  3. Azure DevOps REST API connectivity
  4. Distributed lock manager status
- **Response (Healthy)**: HTTP 200 `{ "status": "ready", "azureDevOpsConnected": true, "checks": { ... } }`.
- **Response (Unhealthy)**: HTTP 503 `{ "status": "unavailable", "checks": { ... } }` (pod removed from service endpoints until dependencies recover).

---

## 6. Observability & Prometheus Telemetry Catalog

The `/metrics` endpoint exports standard Prometheus text format (`version=0.0.4`):

| Metric | Type | Description |
|---|---|---|
| `http_requests_total` | Counter | Total incoming HTTP requests partitioned by `method`, `route`, and `status`. |
| `http_request_duration_seconds_bucket` | Histogram | Request latency distribution with standard buckets (0.05s to 10s). |
| `workops_tasks_created_total` | Counter | Total number of Azure DevOps work items created. |
| `workops_active_jobs` | Gauge | Current number of concurrently running background worker jobs. |
| `workops_azure_rate_limit_remaining` | Gauge | Remaining Azure DevOps REST API rate limit token budget. |
| `workops_plan_duration_seconds_bucket` | Histogram | Execution time of task planning and preview generation. |
| `workops_up` | Gauge | Service operational availability indicator (always 1 when responding). |

### Distributed Tracing (W3C traceparent)
All inbound and outbound HTTP calls propagate standard W3C `traceparent` headers:
`00-{32_char_hex_trace_id}-{16_char_hex_parent_id}-{flags}`.

---

## 7. Backup, Restore & Disaster Recovery

### 7.1 Automated Relational Database Backup
```bash
# Run backup script
npm run state:backup

# Verify backup integrity
npm run state:verify
```

### 7.2 Point-in-Time Database Recovery
```bash
# Restore state from specific snapshot
node scripts/state-backup.mjs restore backups/snapshot-2026-11-22T08-00-00.tar.gz
```

---

## 8. Operational Troubleshooting & Runbook Procedures

### Incident: Upstream Azure DevOps HTTP 429 Rate Limiting
- **Symptom**: Spikes in request duration; log warnings `[WARN] Azure DevOps rate limit exceeded (HTTP 429)`.
- **System Behavior**: Token Bucket throttles outbound calls; exponential backoff engages respecting `Retry-After`.
- **Action**: Check `workops_azure_rate_limit_remaining` metric; consider increasing batch chunk size or requesting Azure DevOps service limit expansion.

### Incident: Distributed Execution Lock Conflict (HTTP 409)
- **Symptom**: `POST /api/tasks/execute` returns `409 Conflict` with `EXECUTION_LOCK_CONFLICT`.
- **Cause**: Another operator or worker replica is executing the same plan snapshot.
- **Action**: Inspect active tasks in Cockpit; verify if prior execution completed.

### Incident: Auto-Closure Task Rejected by Policy Engine
- **Symptom**: Tasks flagged as `NEEDS_REVIEW` instead of `AUTO_CLOSED`.
- **Cause**: Member has zero verifiable GitHub PRs or commits for the targeted work date.
- **Action**: Operator reviews commit evidence in Daily Workflow workspace and performs manual closure if work was delivered outside standard GitHub repos.
