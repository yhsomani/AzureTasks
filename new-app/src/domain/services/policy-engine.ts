/**
 * Verified Auto-Closure Policy Engine
 * Enforces verifiable GitHub pull request or commit deliverables before automated task closure can proceed.
 * Flag unverified tasks for human review and requires Admin/Lead role for manual override.
 */

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  roles: string[];
  tenantId: string;
}

export interface GitHubPrItem {
  id?: number;
  number?: number;
  title?: string;
  state?: string;
  created_at?: string;
  merged_at?: string;
  isDraft?: boolean;
  commitsCount?: number;
  user?: { login?: string; id?: number };
  [key: string]: any;
}

export interface GitHubCommitItem {
  sha?: string;
  commit?: {
    author?: { name?: string; email?: string; date?: string };
    message?: string;
  };
  [key: string]: any;
}

export interface DeliverableEvidence {
  username?: string;
  sourceDate?: string;
  pullRequests: GitHubPrItem[];
  commits?: GitHubCommitItem[];
  rateLimited?: boolean;
  repoNotFound?: boolean;
  error?: string;
  isToday?: boolean;
}

export type PolicyClosureStatus =
  | 'AUTO_CLOSE_ELIGIBLE'
  | 'NEEDS_REVIEW'
  | 'EXEMPT_LEAVE'
  | 'EVALUATION_DEFERRED';

export interface ManualOverrideDetails {
  allowed: boolean;
  overrideRole?: string;
  reason?: string;
  operatorEmail?: string;
}

export interface ClosureDecision {
  status: PolicyClosureStatus;
  reason: string;
  taskState?: string;
  retryNextCycle?: boolean;
  warningLogged?: boolean;
  taskClosed: boolean;
  deliverables?: {
    pullRequests: GitHubPrItem[];
    commits: GitHubCommitItem[];
  };
  manualOverride?: ManualOverrideDetails;
}

export interface PolicyEvaluationContext {
  targetDate?: string;
  timezone?: string;
  isLeave?: boolean;
  autoCloseEnabled?: boolean;
  requirePrEvidence?: boolean;
}

export interface IAutoClosurePolicyEngine {
  evaluateClosure(
    task: any,
    evidence: DeliverableEvidence,
    context?: PolicyEvaluationContext
  ): Promise<ClosureDecision>;

  evaluateManualOverride(
    decision: ClosureDecision,
    operator: AuthenticatedUser,
    reason: string
  ): ClosureDecision;
}

export class VerifiedAutoClosurePolicyEngine implements IAutoClosurePolicyEngine {
  /**
   * Evaluate task closure against verifiable deliverables and policy constraints.
   */
  public async evaluateClosure(
    task: any,
    evidence: DeliverableEvidence,
    context: PolicyEvaluationContext = {}
  ): Promise<ClosureDecision> {
    const currentState = String(task?.fields?.['System.State'] || task?.state || 'Open');

    // 1. Leave exemption check
    if (context.isLeave) {
      return {
        status: 'EXEMPT_LEAVE',
        reason: 'Member is on approved calendar leave for the target date',
        taskState: currentState,
        taskClosed: false,
      };
    }

    // 2. Upstream GitHub rate limiting (HTTP 429) -> postpone evaluation
    if (evidence.rateLimited || evidence.error?.includes('429') || evidence.error?.includes('Rate limit exceeded')) {
      return {
        status: 'EVALUATION_DEFERRED',
        reason: 'GitHub API rate limit exceeded; evaluation deferred to next cycle',
        taskState: currentState,
        retryNextCycle: true,
        taskClosed: false,
      };
    }

    // 3. Upstream repository missing / 404 Not Found -> fails safe to review
    if (evidence.repoNotFound || evidence.error?.includes('404') || evidence.error?.includes('Not Found')) {
      return {
        status: 'NEEDS_REVIEW',
        reason: 'GitHub repository not found or inaccessible; work evidence unverified',
        taskState: currentState,
        warningLogged: true,
        taskClosed: false,
      };
    }

    const prs = evidence.pullRequests || [];
    const commits = evidence.commits || [];
    const workDate = context.targetDate || evidence.sourceDate || '';
    const tz = context.timezone || 'UTC';

    // 4. Validate PR date freshness and draft status
    const validPrs: GitHubPrItem[] = [];
    for (const pr of prs) {
      if (pr.created_at && workDate) {
        const prLocalDate = this.getLocalDate(pr.created_at, tz);
        if (prLocalDate !== workDate) {
          // Stale deliverable: PR created on different calendar date
          continue;
        }
      }

      // Empty draft PR with zero commits does not satisfy work verification
      if (pr.isDraft && (pr.commitsCount === 0 || pr.commitsCount === undefined)) {
        continue;
      }

      validPrs.push(pr);
    }

    // 5. Validate commits matching target date
    const validCommits: GitHubCommitItem[] = [];
    for (const commit of commits) {
      const commitDateStr = commit.commit?.author?.date;
      if (commitDateStr && workDate) {
        const commitLocalDate = this.getLocalDate(commitDateStr, tz);
        if (commitLocalDate === workDate) {
          validCommits.push(commit);
        }
      } else {
        validCommits.push(commit);
      }
    }

    // 6. Check deliverable count
    if (validPrs.length === 0 && validCommits.length === 0) {
      let specificReason = 'Zero verified deliverables (PRs or commits) found for target work date';
      if (prs.length > 0) {
        const firstPr = prs[0];
        if (firstPr.created_at && workDate && this.getLocalDate(firstPr.created_at, tz) !== workDate) {
          specificReason = 'Stale deliverable: PR created on different calendar date';
        } else if (firstPr.isDraft && (firstPr.commitsCount === 0 || firstPr.commitsCount === undefined)) {
          specificReason = 'Draft PR with zero commits does not satisfy work verification';
        }
      }

      return {
        status: 'NEEDS_REVIEW',
        reason: specificReason,
        taskState: currentState,
        warningLogged: true,
        taskClosed: false,
        deliverables: { pullRequests: validPrs, commits: validCommits },
      };
    }

    // 7. Deliverables verified -> Task is eligible for automated closure
    return {
      status: 'AUTO_CLOSE_ELIGIBLE',
      reason: `Verified ${validPrs.length} pull request(s) and ${validCommits.length} commit(s) for ${workDate}`,
      taskState: 'Closed',
      taskClosed: true,
      deliverables: { pullRequests: validPrs, commits: validCommits },
    };
  }

  /**
   * Manual override of a flagged task requiring Admin or Lead authorization.
   */
  public evaluateManualOverride(
    decision: ClosureDecision,
    operator: AuthenticatedUser,
    reason: string
  ): ClosureDecision {
    if (!operator || !operator.roles || operator.roles.length === 0) {
      throw new Error('Manual override requires authenticated operator identity');
    }

    const hasAdminOrLead = operator.roles.some((r) => r === 'Admin' || r === 'Lead');
    if (!hasAdminOrLead) {
      throw new Error("Manual override policy requires role 'Admin' or 'Lead'");
    }

    if (!reason || !reason.trim()) {
      throw new Error('Manual override requires an attributed justification reason');
    }

    return {
      ...decision,
      status: 'AUTO_CLOSE_ELIGIBLE',
      taskClosed: true,
      reason: `Manual override by ${operator.email} (${operator.roles.join(', ')}): ${reason.trim()}`,
      manualOverride: {
        allowed: true,
        overrideRole: operator.roles.find((r) => r === 'Admin' || r === 'Lead'),
        reason: reason.trim(),
        operatorEmail: operator.email,
      },
    };
  }

  private getLocalDate(isoDateStr: string, timeZone: string): string {
    try {
      const date = new Date(isoDateStr);
      return new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(date);
    } catch {
      return isoDateStr.slice(0, 10);
    }
  }
}
