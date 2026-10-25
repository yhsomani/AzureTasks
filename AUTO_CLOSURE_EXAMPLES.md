# Auto-Closure Configuration Examples and Usage Guide

## Quick Start

### 1. Enable Auto-Closure for Specific Users

Using cURL:

```bash
curl -X PUT http://localhost:3000/api/auto-closure/config \
  -H "Content-Type: application/json" \
  -d '{
    "enabled": true,
    "version": 1,
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z",
    "createdBy": "admin@example.com",
    "lastModifiedBy": "admin@example.com",
    "rules": [
      {
        "ruleId": "developers-only",
        "type": "inclusion",
        "filterType": "users",
        "filters": [
          { "id": "alice@example.com", "name": "Alice" },
          { "id": "bob@example.com", "name": "Bob" }
        ],
        "description": "Only Alice and Bob can have tasks auto-closed",
        "createdAt": "2024-01-01T00:00:00Z",
        "updatedAt": "2024-01-01T00:00:00Z",
        "createdBy": "admin@example.com"
      }
    ]
  }'
```

### 2. Check Current Configuration

```bash
curl http://localhost:3000/api/auto-closure/config
```

Expected response:
```json
{
  "success": true,
  "data": {
    "enabled": true,
    "version": 2,
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-08T10:30:00Z",
    "createdBy": "admin@example.com",
    "lastModifiedBy": "admin@example.com",
    "rules": [...]
  }
}
```

### 3. View Audit History

```bash
# Get all closures in the last 100 entries
curl http://localhost:3000/api/auto-closure/audit

# Filter by specific task
curl http://localhost:3000/api/auto-closure/audit?taskId=123

# Filter by user
curl http://localhost:3000/api/auto-closure/audit?userId=alice@example.com

# Filter by status (success, rejected, failed)
curl http://localhost:3000/api/auto-closure/audit?status=rejected

# Filter by date range
curl "http://localhost:3000/api/auto-closure/audit?startDate=2024-01-01T00:00:00Z&endDate=2024-01-31T23:59:59Z"
```

### 4. Export Audit History

```bash
# Export as CSV
curl http://localhost:3000/api/auto-closure/audit/export/csv > audit.csv

# Export as JSON
curl http://localhost:3000/api/auto-closure/audit/export/json > audit.json
```

## Configuration Scenarios

### Scenario 1: Gradual Rollout

Start by excluding certain users, then progressively add inclusion rules.

**Phase 1: Disable auto-closure**
```json
{
  "enabled": false,
  "rules": []
}
```

**Phase 2: Enable but exclude everyone**
```json
{
  "enabled": true,
  "rules": [
    {
      "ruleId": "exclude-all",
      "type": "exclusion",
      "filterType": "roles",
      "filters": [{ "id": "all", "name": "All Users" }]
    }
  ]
}
```

**Phase 3: Whitelist specific team**
```json
{
  "enabled": true,
  "rules": [
    {
      "ruleId": "pilots-only",
      "type": "inclusion",
      "filterType": "roles",
      "filters": [{ "id": "developer", "name": "Developer" }]
    }
  ]
}
```

### Scenario 2: Exclude Management

Allow everyone except managers to be auto-closed.

```json
{
  "enabled": true,
  "rules": [
    {
      "ruleId": "exclude-managers",
      "type": "exclusion",
      "filterType": "roles",
      "filters": [
        { "id": "manager", "name": "Manager" },
        { "id": "director", "name": "Director" }
      ],
      "description": "Managers and above are not auto-closed"
    }
  ]
}
```

### Scenario 3: Team-Based Rules

Different teams have different auto-closure policies.

```json
{
  "enabled": true,
  "rules": [
    {
      "ruleId": "backend-team-allowed",
      "type": "inclusion",
      "filterType": "teams",
      "filters": [{ "id": "backend", "name": "Backend Team" }],
      "description": "Backend team members can be auto-closed"
    },
    {
      "ruleId": "qa-team-excluded",
      "type": "exclusion",
      "filterType": "teams",
      "filters": [{ "id": "qa", "name": "QA Team" }],
      "description": "QA team members are never auto-closed"
    }
  ]
}
```

### Scenario 4: Mixed Rules

Inclusion rule for developers + exclusion rule for specific power users.

```json
{
  "enabled": true,
  "rules": [
    {
      "ruleId": "auto-close-developers",
      "type": "inclusion",
      "filterType": "roles",
      "filters": [{ "id": "developer", "name": "Developer" }],
      "description": "Auto-close for developers"
    },
    {
      "ruleId": "exclude-tech-leads",
      "type": "exclusion",
      "filterType": "users",
      "filters": [
        { "id": "lead1@example.com", "name": "Tech Lead 1" },
        { "id": "lead2@example.com", "name": "Tech Lead 2" }
      ],
      "description": "Tech leads are manually reviewed before closure"
    }
  ]
}
```

## Audit Analysis Examples

### Count Auto-Closed Tasks by User

```bash
curl "http://localhost:3000/api/auto-closure/audit/export/json" | \
  jq '[.[] | select(.status == "success") | .assignedUser] | group_by(.) | map({user: .[0], count: length})'
```

Output:
```json
[
  { "user": "alice@example.com", "count": 42 },
  { "user": "bob@example.com", "count": 35 }
]
```

### Find Rejected Closures

```bash
curl "http://localhost:3000/api/auto-closure/audit?status=rejected" | \
  jq '.data[] | {taskId, assignedUser, closureReason, ruleId: .automationDetails.ruleId}'
```

### Identify Problematic Tasks

```bash
curl "http://localhost:3000/api/auto-closure/audit?status=failed" | \
  jq '.data[] | {taskId, error, assignedUser}'
```

## Troubleshooting

### Issue: Tasks Not Being Auto-Closed

1. Check if auto-closure is enabled:
   ```bash
   curl http://localhost:3000/api/auto-closure/config | jq '.data.enabled'
   ```

2. Check audit logs for rejections:
   ```bash
   curl "http://localhost:3000/api/auto-closure/audit?status=rejected"
   ```

3. Verify the user matches a rule:
   ```bash
   curl "http://localhost:3000/api/auto-closure/audit?userId=user@example.com"
   ```

### Issue: Unexpected Rejections

1. Check for conflicting rules:
   ```bash
   curl http://localhost:3000/api/auto-closure/config | jq '.data.rules[]'
   ```

2. Look at the closure reason in audit logs:
   ```bash
   curl "http://localhost:3000/api/auto-closure/audit?taskId=123" | jq '.data[] | .closureReason'
   ```

### Issue: Configuration Validation Failed

Common errors:

- **"Auto-closure is enabled but no rules are defined"**
  - Disable auto-closure or add at least one rule

- **"Duplicate rule ID"**
  - Each rule must have a unique `ruleId`

- **"Configuration mixes inclusion and exclusion rules"**
  - Warning only; ensure this is intentional (exclusion takes precedence)

## Performance Considerations

- Configuration is cached for 5 seconds (configurable)
- Audit logs are rotated at 50MB or 50,000 entries
- Old entries are archived to `.audit-archives/` directory
- Use retention cleanup to manage disk space:
  ```bash
  curl -X DELETE http://localhost:3000/api/auto-closure/audit \
    -H "Content-Type: application/json" \
    -d '{"beforeDate": "2023-10-01T00:00:00Z"}'
  ```

## Best Practices

1. **Test with dry-run first**: Always test configuration changes
2. **Start restrictive**: Begin with strict rules and relax gradually
3. **Monitor rejections**: Use audit logs to identify unexpected behavior
4. **Document rules**: Add clear descriptions to each rule
5. **Regular audits**: Review audit history periodically
6. **Backup configuration**: Save configuration before major changes
7. **Review conflicts**: Address any reported conflicts
8. **Use consistent IDs**: Use email addresses for users, lowercase for teams/roles

## Integration with Close-Daily-Tasks

The auto-closure configuration is automatically checked during the close-daily-tasks operation:

```bash
# Manual close with audit context
curl -X POST http://localhost:3000/api/tasks/close \
  -H "Content-Type: application/json" \
  -d '{
    "dryRun": false,
    "triggerSource": "manual"
  }'
```

Response includes:
```json
{
  "results": [
    {
      "status": "rejected",
      "taskId": 123,
      "personName": "User Name",
      "summaryText": "User does not match any inclusion rules",
      "autoClosureRuleId": "rule-1"
    }
  ],
  "totalRejected": 5
}
```

