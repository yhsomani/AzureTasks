import { describe, it, expect } from 'vitest';
import {
  deriveGitHubUsernameFromEmail,
  formatPrTaskDescription,
  escapeHtml,
  GitHubPullRequest,
  GitHubCommit,
} from '../../src/domain/services/github-service.js';

describe('GitHub Service & EMU Derivation', () => {
  describe('deriveGitHubUsernameFromEmail', () => {
    it('correctly derives GitHub EMU usernames matching enterprise conventions', () => {
      // User-provided examples
      expect(deriveGitHubUsernameFromEmail('mukul.ramteke@bajajfinserv.in')).toBe('mukul-ramteke_bflghec');
      expect(deriveGitHubUsernameFromEmail('yash.somani@bajajfinserv.in')).toBe('yash-somani_bflghec');
      expect(deriveGitHubUsernameFromEmail('ajinkya.lendikar@bajajfinserv.in')).toBe('ajinkya-lendikar_bflghec');
      expect(deriveGitHubUsernameFromEmail('vishal.shinde17@bajajfinserv.in')).toBe('vishal-shinde17_bflghec');
      expect(deriveGitHubUsernameFromEmail('pankaj.chaure3@bajajfinserv.in')).toBe('pankaj-chaure3_bflghec');
    });

    it('handles email wrapped in displayName angle brackets', () => {
      expect(deriveGitHubUsernameFromEmail('Yash Somani <yash.somani@bajajfinserv.in>')).toBe('yash-somani_bflghec');
      expect(deriveGitHubUsernameFromEmail('Vishal Shinde <vishal.shinde17@bajajfinserv.in>')).toBe('vishal-shinde17_bflghec');
    });

    it('handles uppercase and extra whitespace in email', () => {
      expect(deriveGitHubUsernameFromEmail('  Mukul.Ramteke@BajajFinserv.in  ')).toBe('mukul-ramteke_bflghec');
    });

    it('supports custom enterprise suffixes', () => {
      expect(deriveGitHubUsernameFromEmail('john.doe@company.com', '_corp')).toBe('john-doe_corp');
    });

    it('returns empty string for falsy input', () => {
      expect(deriveGitHubUsernameFromEmail('')).toBe('');
    });
  });

  describe('formatPrTaskDescription', () => {
    const mockPr1: GitHubPullRequest = {
      id: 101,
      number: 142,
      title: 'feat(auth): add biometrics support',
      htmlUrl: 'https://github.com/myorg/pwa/pull/142',
      state: 'open',
      createdAt: '2026-10-15T12:00:00Z',
      repositoryName: '3in1-pwa',
    };

    const mockPr2: GitHubPullRequest = {
      id: 102,
      number: 145,
      title: 'fix(payment): resolve mandate webhook timeout',
      htmlUrl: 'https://github.com/myorg/pwa/pull/145',
      state: 'closed',
      mergedAt: '2026-10-15T14:30:00Z',
      createdAt: '2026-10-15T13:00:00Z',
      repositoryName: '3in1-pwa',
    };

    it('generates rich HTML description for today PRs', () => {
      const result = formatPrTaskDescription({
        username: 'yash-somani_bflghec',
        targetIsoDate: '2026-10-15',
        sourceDate: '2026-10-15',
        isToday: true,
        pullRequests: [mockPr1, mockPr2],
      });

      expect(result.htmlDescription).toContain('Daily Deliverables &amp; Pull Requests (2026-10-15)');
      expect(result.htmlDescription).toContain('PR #142');
      expect(result.htmlDescription).toContain('PR #145');
      expect(result.htmlDescription).toContain('[3in1-pwa]');
      expect(result.htmlDescription).toContain('Merged');
      expect(result.htmlDescription).toContain('Active');
      expect(result.summaryText).toContain('2 PR(s) created today');
    });

    it('honestly reports missing PR evidence without asserting unverified work', () => {
      const result = formatPrTaskDescription({
        username: 'mukul-ramteke_bflghec',
        targetIsoDate: '2026-10-15',
        sourceDate: '2026-10-15',
        isToday: false,
        pullRequests: [],
        role: 'SDM',
      });

      expect(result.htmlDescription.trim().length).toBeGreaterThan(20);
      expect(result.htmlDescription).toContain('GitHub evidence for 2026-10-15');
      expect(result.htmlDescription).toContain('No matching Pull Requests were found');
      expect(result.htmlDescription).toContain('SDM');
      expect(result.summaryText).toContain('manual work summary not verified');
      expect(result.htmlDescription).not.toContain('completed as planned');
    });
  });

  it('formats configured commit evidence without claiming completed hours', () => {
    const commit: GitHubCommit = {
      sha: 'abcdef1234567890', message: 'fix: safe <work> and escaping',
      htmlUrl: 'https://github.com/team/repo/commit/abcdef1234567890',
      authoredAt: '2026-10-15T10:00:00Z', repositoryName: 'team/repo', branch: 'release/v2',
    };
    const result = formatPrTaskDescription({
      username: 'dev', sourceDate: '2026-10-15', targetIsoDate: '2026-10-15',
      isToday: true, pullRequests: [], commits: [commit],
    });
    expect(result.htmlDescription).toContain('release/v2');
    expect(result.htmlDescription).toContain('&lt;work&gt;');
    expect(result.htmlDescription).toContain('not a verified timesheet');
    expect(result.summaryText).toContain('1 commit(s)');
  });

  describe('escapeHtml', () => {
    it('escapes dangerous HTML characters', () => {
      expect(escapeHtml('<script>alert("xss") & test</script>')).toBe(
        '&lt;script&gt;alert(&quot;xss&quot;) &amp; test&lt;/script&gt;'
      );
    });
  });
});
