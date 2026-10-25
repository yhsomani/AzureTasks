/**
 * Auto-Closure Configuration Domain Model
 * Defines rules for which users/teams/roles can have tasks auto-closed
 */

export type FilterType = 'users' | 'teams' | 'roles';
export type RuleType = 'inclusion' | 'exclusion';

export interface UserFilter {
  id: string;  // Azure DevOps user ID or email
  name: string;
}

export interface TeamFilter {
  id: string;  // Azure DevOps team ID
  name: string;
}

export interface RoleFilter {
  id: string;  // Role identifier (e.g., 'developer', 'manager')
  name: string;
}

export interface AutoClosureRule {
  ruleId: string;
  type: RuleType;  // 'inclusion' or 'exclusion'
  filterType: FilterType;  // 'users', 'teams', or 'roles'
  filters: (UserFilter | TeamFilter | RoleFilter)[];
  description?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;  // User who created the rule
}

export interface AutoClosureConfig {
  enabled: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  lastModifiedBy: string;
  rules: AutoClosureRule[];
  retentionDays?: number;  // Audit log retention in days (default: 90)
}

export interface AutoClosureAuditLog {
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
  patchOperations?: any[];  // Azure DevOps patch operations applied
  status: 'success' | 'failed' | 'rejected';
  error?: string;
}

export interface AutoClosureValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}
