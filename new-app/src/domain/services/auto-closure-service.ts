/**
 * Auto-Closure Service
 * Handles authorization, validation, and closure decision logic
 */

import {
  AutoClosureConfig,
  AutoClosureRule,
  AutoClosureValidationResult,
} from '../entities/auto-closure-config.js';

export interface ClosureDecision {
  shouldClose: boolean;
  reason: string;
  ruleName?: string;
  ruleId?: string;
}

export interface AuthorizationCheckResult {
  isAuthorized: boolean;
  reason: string;
}

export class AutoClosureService {
  /**
   * Check if a user is authorized to modify auto-closure configuration
   * Only admins can modify configuration
   */
  checkConfigurationAuthorization(
    requestingUser: string,
    adminUsers?: string[]
  ): AuthorizationCheckResult {
    // For now, check against admin list
    // In a real system, this would check Azure DevOps permissions
    if (!adminUsers || adminUsers.length === 0) {
      return {
        isAuthorized: false,
        reason: 'No admin users configured for auto-closure management',
      };
    }

    const isAdmin = adminUsers.some(
      admin => admin.toLowerCase() === requestingUser.toLowerCase()
    );

    if (!isAdmin) {
      return {
        isAuthorized: false,
        reason: `User ${requestingUser} is not authorized to modify auto-closure configuration`,
      };
    }

    return {
      isAuthorized: true,
      reason: 'User has admin permission for auto-closure configuration',
    };
  }

  /**
   * Determine if a task assigned to a user should be auto-closed
   * based on the configuration rules
   */
  shouldCloseTask(
    config: AutoClosureConfig,
    assignedUser: string,
    userRole?: string,
    userTeam?: string
  ): ClosureDecision {
    if (!config.enabled) {
      return {
        shouldClose: false,
        reason: 'Auto-closure is disabled',
      };
    }

    if (config.rules.length === 0) {
      return {
        shouldClose: false,
        reason: 'No auto-closure rules defined',
      };
    }

    // Separate inclusion and exclusion rules
    const inclusionRules = config.rules.filter(r => r.type === 'inclusion');
    const exclusionRules = config.rules.filter(r => r.type === 'exclusion');

    // Check exclusion rules first
    for (const rule of exclusionRules) {
      if (this.matchesRule(rule, assignedUser, userRole, userTeam)) {
        return {
          shouldClose: false,
          reason: `User matches exclusion rule: ${rule.description || rule.ruleId}`,
          ruleId: rule.ruleId,
          ruleName: rule.description,
        };
      }
    }

    // If inclusion rules exist, check if user matches any
    if (inclusionRules.length > 0) {
      for (const rule of inclusionRules) {
        if (this.matchesRule(rule, assignedUser, userRole, userTeam)) {
          return {
            shouldClose: true,
            reason: `User matches inclusion rule: ${rule.description || rule.ruleId}`,
            ruleId: rule.ruleId,
            ruleName: rule.description,
          };
        }
      }
      // User didn't match any inclusion rule
      return {
        shouldClose: false,
        reason: 'User does not match any inclusion rules',
      };
    }

    // No inclusion rules and didn't match exclusion rules
    return {
      shouldClose: true,
      reason: 'Auto-closure enabled with no exclusion rules matching user',
    };
  }

  /**
   * Check if a user matches a specific rule
   */
  private matchesRule(
    rule: AutoClosureRule,
    userId: string,
    userRole?: string,
    userTeam?: string
  ): boolean {
    switch (rule.filterType) {
      case 'users':
        return rule.filters.some(
          f => f.id.toLowerCase() === userId.toLowerCase() ||
               f.name.toLowerCase() === userId.toLowerCase()
        );
      case 'roles':
        return userRole
          ? rule.filters.some(
              f => f.id.toLowerCase() === userRole.toLowerCase() ||
                   f.name.toLowerCase() === userRole.toLowerCase()
            )
          : false;
      case 'teams':
        return userTeam
          ? rule.filters.some(
              f => f.id.toLowerCase() === userTeam.toLowerCase() ||
                   f.name.toLowerCase() === userTeam.toLowerCase()
            )
          : false;
      default:
        return false;
    }
  }

  /**
   * Validate that all referenced users, teams, and roles exist
   * In a real system, this would check Azure DevOps API
   * For now, this is a placeholder
   */
  validateReferences(
    config: AutoClosureConfig,
    availableUsers?: Map<string, any>,
    availableTeams?: Map<string, any>,
    availableRoles?: Map<string, any>
  ): AutoClosureValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    for (const rule of config.rules) {
      for (const filter of rule.filters) {
        switch (rule.filterType) {
          case 'users':
            if (availableUsers && !availableUsers.has(filter.id.toLowerCase())) {
              warnings.push(
                `Rule ${rule.ruleId}: User "${filter.id}" not found. ` +
                `Consider updating the user reference or verifying it exists in Azure DevOps.`
              );
            }
            break;
          case 'teams':
            if (availableTeams && !availableTeams.has(filter.id.toLowerCase())) {
              warnings.push(
                `Rule ${rule.ruleId}: Team "${filter.id}" not found. ` +
                `Consider updating the team reference or verifying it exists in Azure DevOps.`
              );
            }
            break;
          case 'roles':
            if (availableRoles && !availableRoles.has(filter.id.toLowerCase())) {
              warnings.push(
                `Rule ${rule.ruleId}: Role "${filter.id}" not found. ` +
                `Available roles: ${Array.from(availableRoles.keys()).join(', ')}`
              );
            }
            break;
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Detect conflicting rules that might prevent expected behavior
   */
  detectConflicts(config: AutoClosureConfig): string[] {
    const conflicts: string[] = [];

    if (config.rules.length < 2) {
      return conflicts;
    }

    const inclusionRules = config.rules.filter(r => r.type === 'inclusion');
    const exclusionRules = config.rules.filter(r => r.type === 'exclusion');

    if (inclusionRules.length > 0 && exclusionRules.length > 0) {
      // Check for explicit conflicts
      for (const inclusion of inclusionRules) {
        for (const exclusion of exclusionRules) {
          if (inclusion.filterType === exclusion.filterType) {
            const inclusionIds = new Set(
              inclusion.filters.map(f => f.id.toLowerCase())
            );
            const exclusionIds = new Set(
              exclusion.filters.map(f => f.id.toLowerCase())
            );

            for (const id of inclusionIds) {
              if (exclusionIds.has(id)) {
                conflicts.push(
                  `User/Team/Role "${id}" is in both inclusion rule ` +
                  `"${inclusion.ruleId}" and exclusion rule "${exclusion.ruleId}". ` +
                  `Exclusion will take precedence.`
                );
              }
            }
          }
        }
      }
    }

    return conflicts;
  }
}
