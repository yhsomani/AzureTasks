/**
 * GitHub Domain Service & PR Deliverables Formatter
 * Pure domain logic for formatting task descriptions from Pull Requests
 */

export interface GitHubPullRequest {
  id: number;
  number: number;
  title: string;
  htmlUrl: string;
  state: string; // 'open' | 'closed' | 'all'
  createdAt: string; // ISO string
  closedAt?: string | null;
  mergedAt?: string | null;
  body?: string | null;
  repositoryName?: string;
}

export interface GitHubCommit {
  sha: string;
  message: string;
  htmlUrl: string;
  authoredAt: string;
  repositoryName: string;
  branch: string;
}

export interface GitHubPrDeliverables {
  username: string;
  sourceDate: string; // YYYY-MM-DD
  isToday: boolean;
  pullRequests: GitHubPullRequest[];
  commits?: GitHubCommit[];
  htmlDescription: string;
  summaryText: string;
}

/**
 * Derives a GitHub Enterprise Managed User (EMU) username from a corporate email.
 * Pattern: local-part dots replaced by hyphens + enterprise suffix (default "_bflghec")
 * Examples:
 *   "yash.somani@bajajfinserv.in"     -> "yash-somani_bflghec"
 *   "mukul.ramteke@bajajfinserv.in"   -> "mukul-ramteke_bflghec"
 *   "ajinkya.lendikar@bajajfinserv.in" -> "ajinkya-lendikar_bflghec"
 *   "vishal.shinde17@bajajfinserv.in" -> "vishal-shinde17_bflghec"
 *   "pankaj.chaure3@bajajfinserv.in"  -> "pankaj-chaure3_bflghec"
 */
export function deriveGitHubUsernameFromEmail(email: string, suffix: string = '_bflghec'): string {
  if (!email) return '';
  const match = email.match(/<([^>]+)>/);
  const cleanEmail = match ? match[1] : email;
  const localPart = cleanEmail.split('@')[0].trim().toLowerCase();
  const hyphenated = localPart.replace(/\./g, '-');
  return `${hyphenated}${suffix}`;
}

/**
 * Escapes HTML characters for safe rich-text rendering in Azure DevOps WIT Description
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Formats task description HTML from GitHub pull requests
 */
export function formatPrTaskDescription(options: {
  username: string;
  targetIsoDate: string;
  sourceDate: string;
  isToday: boolean;
  pullRequests: GitHubPullRequest[];
  commits?: GitHubCommit[];
  role?: string;
}): { htmlDescription: string; summaryText: string } {
  const { targetIsoDate, pullRequests, role, commits = [] } = options;

  if (pullRequests.length === 0 && commits.length === 0) {
    // Do not invent work completion when GitHub returned no evidence.
    // The operator may provide a manually verified summary separately.
    const roleContext = role ? ` (Role: ${escapeHtml(role)})` : '';
    const htmlDescription = `<div><p><strong>GitHub evidence for ${escapeHtml(targetIsoDate)}${roleContext}:</strong></p><p>No matching Pull Requests were found. This does not establish whether other work was completed. Review the work item before closure.</p></div>`;
    const summaryText = 'No matching GitHub PR evidence; manual work summary not verified.';
    return { htmlDescription, summaryText };
  }

  const headerTitle = `Daily Deliverables &amp; Pull Requests (${targetIsoDate})`;

  const prItemsHtml = pullRequests
    .map(pr => {
      const repoBadge = pr.repositoryName ? `<code>[${escapeHtml(pr.repositoryName)}]</code> ` : '';
      const statusBadge = pr.mergedAt ? 'Merged' : pr.state === 'closed' ? 'Closed' : 'Active';
      return `  <li>${repoBadge}<strong>PR #${pr.number}</strong>: <a href="${escapeHtml(pr.htmlUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(pr.title)}</a> (<em>${statusBadge}</em>)</li>`;
    })
    .join('\n');

  const commitItemsHtml = commits.map(commit =>
    `<li><code>[${escapeHtml(commit.repositoryName)}:${escapeHtml(commit.branch)}]</code> <a href="${escapeHtml(commit.htmlUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(commit.sha.slice(0, 10))}</a> — ${escapeHtml(commit.message.split('\\n')[0])}</li>`
  ).join('\\n');
  const prSection = pullRequests.length ? `<p>PRs created on this date (not proof of completion):</p><ul>${prItemsHtml}</ul>` : '<p>No PRs created on this date.</p>';
  const commitSection = commits.length
    ? `<p>Commits authored on this date on configured repositories/branches:</p><ul>${commitItemsHtml}</ul>`
    : '';
  const htmlDescription = `<div><p><strong>${headerTitle}:</strong></p>${prSection}${commitSection}<p>Source-control activity is supporting evidence, not a verified timesheet.</p></div>`;

  const prSummary = `${pullRequests.length} PR(s) created today${pullRequests.length ? `: ${pullRequests.map(p => `#${p.number}`).join(', ')}` : ''}`;
  const summaryText = commits.length ? `${prSummary}; ${commits.length} commit(s) authored in configured scope` : prSummary;

  return { htmlDescription, summaryText };
}
