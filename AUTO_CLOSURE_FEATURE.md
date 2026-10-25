# Auto Task Closure Configuration Feature

## Overview

The Auto Task Closure Configuration feature allows fine-grained control over which users' tasks can be automatically closed by the system. It provides:

- **User/Team/Role-Based Rules**: Control who can have tasks auto-closed
- **Inclusion/Exclusion Rules**: Explicitly allow or prevent specific users/teams/roles
- **Dynamic Configuration**: Update rules without restarting the application
- **Comprehensive Audit Logging**: Record all auto-closure decisions with full context
- **Admin Authorization**: Only administrators can modify configuration
- **Conflict Detection**: Warn about potentially conflicting rules

## Architecture

### Domain Layer

#### Entities (`src/domain/entities/auto-closure-config.ts`)

The domain layer defines the core data structures:

```typescript
// Rule types
type FilterType = 'users' | 'teams' | 'roles';
type RuleType = 'inclusion' | 'exclusion';

// Filter definitions
interface UserFilter { id: string; name: string; }
interface TeamFilter { id: string; name: string; }
interface RoleFilter { id: string; name: string; }

// Rule definition
interface AutoClosureRule {
  ruleId: string;
  type: RuleType;           // 'inclusion' or 'exclusion'
  filterType: FilterType;   // 'users', 'teams', or 'roles'
  filters: (UserFilter | TeamFilter | RoleFilter)[];
  description?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

// Configuration
interface AutoClosureConfig {
  enabled: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  lastModifiedBy: string;
  rules: AutoClosureRule[];
  retentionDays?: number;  // Audit log retention (default: 90)
}

// Audit log
interface AutoClosureAuditLog {
  id: string;
  taskId: number;
  assignedUser: string;
  closedAt: string;
  triggerSource: 'scheduled' | 'manual' | 'api';
  closureReason: string;
  automationDetails: {
    ruleName?: string;
    ruleId?: string;
    matchedFilterType?: FilterType;
    matchedFilters?: string[];
  };
  configurationVersion: number;
  validationResults: {
    passed: boolean;
    reason?: string;
    warnings?: string[];
  };
  status: 'success' | 'failed' | 'rejected';
  error?: string;
}
```

#### Service (`src/domain/services/auto-closure-service.ts`)

Business logic for:

- **Authorization**: Check if user can modify configuration (admin-only)
- **Closure Decisions**: Determine if task should be auto-closed based on rules
- **Rule Matching**: Match users/teams/roles against rules
- **Conflict Detection**: Identify conflicting inclusion/exclusion rules
- **Validation**: Validate user/team/role references

### Infrastructure Layer

#### Configuration Repository (`src/infrastructure/config/file-auto-closure-config-repo.ts`)

Manages configuration persistence:

- Load/save configuration from JSON file (`.auto-closure-config.json`)
- Cache with 5-second TTL for performance
- Atomic writes with temp file + rename
- Comprehensive validation
- Version tracking

#### Audit Repository (`src/infrastructure/journal/file-auto-closure-audit-repo.ts`)

Manages audit log persistence:

- Record auto-closure decisions to JSON file (`.auto-closure-audit.json`)
- Archive old entries to `.audit-archives/` directory
- Query entries with filters (task, user, status, date range)
- Export as CSV/JSON
- Automatic cleanup of old entries (retention policy)

### Ports (Repository Interfaces)

Defined in `src/domain/ports/repositories.ts`:

```typescript
export interface AutoClosureConfigRepository {
  load(): Promise<AutoClosureConfig>;
  save(config: AutoClosureConfig): Promise<void>;
  validate(config: AutoClosureConfig): Promise<AutoClosureValidationResult>;
  getVersion(): Promise<number>;
}

export interface AutoClosureAuditLogRepository {
  record(entry: AutoClosureAuditLog): Promise<void>;
  getEntries(limit?: number, filters?: AutoClosureAuditFilter): Promise<AutoClosureAuditLog[]>;
  getEntriesByTask(taskId: number): Promise<AutoClosureAuditLog[]>;
  getEntriesByUser(userId: string, limit?: number): Promise<AutoClosureAuditLog[]>;
  exportCsv(): Promise<string>;
  exportJson(): Promise<string>;
  cleanup(beforeDate: string): Promise<number>;
}
```

### Integration

The feature is integrated into:

1. **CloseDailyTasksUseCase**: Checks configuration before auto-closing each task
2. **Container**: Instantiates repositories and wires dependencies
3. **API Routes**: Provides endpoints for configuration management

## API Endpoints

All endpoints are prefixed with `/api/auto-closure/`.

### Configuration Management

#### GET /config
Retrieve current auto-closure configuration.

**Response:**
```json
{
  "success": true,
  "data": {
    "enabled": true,
    "version": 2,
    "rules": [
      {
        "ruleId": "rule-1",
        "type": "inclusion",
        "filterType": "users",
        "filters": [
          { "id": "user@example.com", "name": "John Doe" }
        ],
        "description": "Allow John to be auto-closed"
      }
    ]
  }
}
```

#### PUT /config
Update auto-closure configuration (admin-only).

**Request:**
```json
{
  "enabled": true,
  "version": 2,
  "createdAt": "2024-01-01T00:00:00Z",
  "updatedAt": "2024-01-01T00:00:00Z",
  "createdBy": "admin@example.com",
  "lastModifiedBy": "admin@example.com",
  "rules": [
    {
      "ruleId": "rule-1",
      "type": "inclusion",
      "filterType": "users",
      "filters": [
        { "id": "user@example.com", "name": "John Doe" }
      ],
      "description": "Allow John to be auto-closed",
      "createdAt": "2024-01-01T00:00:00Z",
      "updatedAt": "2024-01-01T00:00:00Z",
      "createdBy": "admin@example.com"
    }
  ],
  "retentionDays": 90
}
```

**Response:**
```json
{
  "success": true,
  "data": { /* updated config */ },
  "warnings": ["Configuration mixes inclusion and exclusion rules..."],
  "conflicts": ["User 'user@example.com' is in both inclusion and exclusion rules..."]
}
```

### Audit History

#### GET /audit
Retrieve auto-closure audit history with optional filters.

**Query Parameters:**
- `limit`: Number of entries (1-1000, default: 100)
- `taskId`: Filter by task ID
- `userId`: Filter by assigned user
- `status`: Filter by status (success/failed/rejected)
- `triggerSource`: Filter by trigger (scheduled/manual/api)
- `startDate`: Filter by start date (ISO format)
- `endDate`: Filter by end date (ISO format)

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "taskId": 123,
      "assignedUser": "user@example.com",
      "closedAt": "2024-01-01T12:00:00Z",
      "triggerSource": "scheduled",
      "closureReason": "User matches inclusion rule",
      "automationDetails": {
        "ruleId": "rule-1",
        "ruleName": "Allow developers",
        "matchedFilterType": "roles",
        "matchedFilters": ["developer"]
      },
      "configurationVersion": 1,
      "validationResults": {
        "passed": true
      },
      "status": "success"
    }
  ],
  "count": 1
}
```

#### GET /audit/export/csv
Export audit history as CSV.

#### GET /audit/export/json
Export audit history as JSON.

#### DELETE /audit
Clean up old audit entries (admin-only).

**Request:**
```json
{
  "beforeDate": "2023-10-01T00:00:00Z"
}
```

## Configuration Examples

### Example 1: Allow Only Specific Users

```json
{
  "enabled": true,
  "version": 1,
  "createdAt": "2024-01-01T00:00:00Z",
  "updatedAt": "2024-01-01T00:00:00Z",
  "createdBy": "admin@example.com",
  "lastModifiedBy": "admin@example.com",
  "rules": [
    {
      "ruleId": "allowed-users",
      "type": "inclusion",
      "filterType": "users",
      "filters": [
        { "id": "alice@example.com", "name": "Alice" },
        { "id": "bob@example.com", "name": "Bob" }
      ],
      "description": "Only Alice and Bob can be auto-closed",
      "createdAt": "2024-01-01T00:00:00Z",
      "updatedAt": "2024-01-01T00:00:00Z",
      "createdBy": "admin@example.com"
    }
  ]
}
```

### Example 2: Allow All Except Managers

```json
{
  "enabled": true,
  "version": 1,
  "createdAt": "2024-01-01T00:00:00Z",
  "updatedAt": "2024-01-01T00:00:00Z",
  "createdBy": "admin@example.com",
  "lastModifiedBy": "admin@example.com",
  "rules": [
    {
      "ruleId": "exclude-managers",
      "type": "exclusion",
      "filterType": "roles",
      "filters": [
        { "id": "manager", "name": "Manager" }
      ],
      "description": "Managers' tasks should not be auto-closed",
      "createdAt": "2024-01-01T00:00:00Z",
      "updatedAt": "2024-01-01T00:00:00Z",
      "createdBy": "admin@example.com"
    }
  ]
}
```

### Example 3: Role-Based Configuration

```json
{
  "enabled": true,
  "version": 1,
  "createdAt": "2024-01-01T00:00:00Z",
  "updatedAt": "2024-01-01T00:00:00Z",
  "createdBy": "admin@example.com",
  "lastModifiedBy": "admin@example.com",
  "rules": [
    {
      "ruleId": "auto-close-developers",
      "type": "inclusion",
      "filterType": "roles",
      "filters": [
        { "id": "developer", "name": "Developer" }
      ],
      "description": "Auto-close tasks for all developers",
      "createdAt": "2024-01-01T00:00:00Z",
      "updatedAt": "2024-01-01T00:00:00Z",
      "createdBy": "admin@example.com"
    }
  ]
}
```

## Behavior

### Default Behavior

1. When **auto-closure is disabled**: No tasks are auto-closed regardless of rules
2. When **no rules are defined**: No tasks are auto-closed
3. When **only inclusion rules exist**: Only users matching inclusion rules are auto-closed
4. When **only exclusion rules exist**: All users are auto-closed except those matching exclusion rules
5. When **both rules exist**: Exclusion rules take precedence (deny wins)

### Task Closure Flow

1. Task is selected for potential auto-closure
2. System checks if already closed → Skip
3. **System checks auto-closure configuration**
   - **If config.enabled = false** → Reject (not auto-closed)
   - **If user matches exclusion rule** → Reject (not auto-closed)
   - **If inclusion rules exist and user doesn't match** → Reject (not auto-closed)
   - **Otherwise** → Proceed with auto-closure
4. Closure is applied (Remaining Work = 0, etc.)
5. **Audit log entry is recorded** with configuration version and decision details

### Audit Logging

Every task closure decision is recorded, including:

- **Success**: Task was successfully auto-closed
- **Rejected**: Task was not auto-closed due to configuration rule
- **Failed**: Task closure attempt failed (error details included)
- **Already Closed**: Task was already in a closed state

Audit entries include:

- Task ID and assigned user
- Closure timestamp and trigger source
- Configuration version used for decision
- Matched rule (if any)
- Validation results and error messages (if any)

## Authorization

Only users in the **admin users list** can:

- Modify auto-closure configuration
- Delete audit log entries
- Perform cleanup operations

The admin user list is configured via:
- API dependency injection
- Or environment variable (to be implemented)

## Files Changed/Created

### New Files

- `src/domain/entities/auto-closure-config.ts` - Domain models
- `src/domain/services/auto-closure-service.ts` - Business logic
- `src/infrastructure/config/file-auto-closure-config-repo.ts` - Config persistence
- `src/infrastructure/journal/file-auto-closure-audit-repo.ts` - Audit log persistence
- `src/presentation/api/auto-closure-routes.ts` - API endpoints
- `tests/unit/auto-closure-service.test.ts` - Service tests
- `tests/unit/auto-closure-config-repo.test.ts` - Config repo tests
- `tests/unit/auto-closure-audit-repo.test.ts` - Audit repo tests

### Modified Files

- `src/domain/ports/repositories.ts` - Added new repository interfaces
- `src/domain/index.ts` - Exported new types and services
- `src/application/use-cases/close-daily-tasks.ts` - Integrated auto-closure checks
- `src/container.ts` - Instantiated new repositories and wired dependencies

## Testing

Run the auto-closure tests:

```bash
npm test -- auto-closure
```

Tests cover:

- ✅ Service logic (closure decisions, authorization, conflict detection)
- ✅ Configuration validation and persistence
- ✅ Audit log recording and querying
- ✅ Edge cases (case-insensitive matching, conflicting rules, etc.)

## Future Enhancements

- [ ] Azure DevOps API integration for user/team validation
- [ ] Web UI for configuration management
- [ ] Advanced scheduling (time-based rules, day-of-week rules)
- [ ] Notifications when tasks are rejected by config
- [ ] Bulk rule management (import/export)
- [ ] Rule templates for common scenarios
- [ ] Analytics dashboard for auto-closure metrics

