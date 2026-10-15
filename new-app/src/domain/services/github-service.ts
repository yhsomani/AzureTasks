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

export interface GitHubPrDeliverables {
  username: string;
  sourceDate: string; // YYYY-MM-DD
  isToday: boolean;
  pullRequests: GitHubPullRequest[];
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
  role?: string;
}): { htmlDescription: string; summaryText: string } {
  const { targetIsoDate, pullRequests, role } = options;

  if (pullRequests.length === 0) {
    const roleContext = role ? ` (${escapeHtml(role)})` : '';
    const htmlDescription = `<div>\n<p><strong>Daily Deliverables &amp; Activities (${targetIsoDate}):</strong></p>\n<p>No Pull Requests were created today. Scheduled development, code review, bug fixes, and verification tasks completed as planned${roleContext}.</p>\n</div>`.trim();
    const summaryText = 'No PRs created today. Daily engineering deliverables executed as planned.';
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

  const htmlDescription = `<div>\n<p><strong>${headerTitle}:</strong></p>\n<ul>\n${prItemsHtml}\n</ul>\n</div>`.trim();

  const summaryText = `${pullRequests.length} PR(s) created today: ${pullRequests.map(p => `#${p.number}`).join(', ')}`;

  return { htmlDescription, summaryText };
}
