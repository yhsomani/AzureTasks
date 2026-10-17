import { describe, it, expect, vi } from 'vitest';
import { GitHubClient } from '../../src/infrastructure/github/github-client.js';

describe('GitHubClient', () => {
  describe('resolveUserByEmail', () => {
    it('resolves corporate email to EMU username deterministically without HTTP call', async () => {
      const mockFetch = vi.fn();
      const client = new GitHubClient({
        token: 'test-token',
        userSuffix: '_bflghec',
        fetchFn: mockFetch,
      });

      const username = await client.resolveUserByEmail('yash.somani@bajajfinserv.in');
      expect(username).toBe('yash-somani_bflghec');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('uses custom suffix when provided', async () => {
      const mockFetch = vi.fn();
      const client = new GitHubClient({
        token: 'test-token',
        userSuffix: '_bflghec',
        fetchFn: mockFetch,
      });

      const username = await client.resolveUserByEmail('mukul.ramteke@company.com', '_custom');
      expect(username).toBe('mukul-ramteke_custom');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('falls back to GitHub Search Users API when email is not dot-separated', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          items: [{ login: 'octocat' }],
        }),
      });

      const client = new GitHubClient({
        token: 'test-token',
        userSuffix: '',
        fetchFn: mockFetch,
      });

      const username = await client.resolveUserByEmail('admin@company.com');
      expect(username).toBe('octocat');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/search/users?q=admin%40company.com+in:email'),
        expect.any(Object)
      );
    });

    it('falls back to Commit Search API when User Search returns no items', async () => {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ items: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            items: [{ author: { login: 'committer-user' } }],
          }),
        });

      const client = new GitHubClient({
        token: 'test-token',
        userSuffix: '',
        fetchFn: mockFetch,
      });

      const username = await client.resolveUserByEmail('contributor@company.com');
      expect(username).toBe('committer-user');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('returns null and caches result when both searches fail', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ items: [] }),
      });

      const client = new GitHubClient({
        token: 'test-token',
        userSuffix: '',
        fetchFn: mockFetch,
      });

      const res1 = await client.resolveUserByEmail('unknown@company.com');
      expect(res1).toBeNull();

      // Second call should hit the cache and not invoke fetch again
      const res2 = await client.resolveUserByEmail('unknown@company.com');
      expect(res2).toBeNull();
      expect(mockFetch).toHaveBeenCalledTimes(2); // exactly 2 from first call
    });

    it('handles empty input safely', async () => {
      const client = new GitHubClient();
      expect(await client.resolveUserByEmail('')).toBeNull();
    });
  });

  describe('getUserPullRequests', () => {
    it('fetches PRs authored by user within organization', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          items: [
            {
              id: 101,
              number: 42,
              title: 'feat: add task closure',
              html_url: 'https://github.com/my-org/repo/pull/42',
              state: 'open',
              created_at: '2026-10-15T12:00:00Z',
              repository_url: 'https://api.github.com/repos/my-org/my-repo',
            },
          ],
        }),
      });

      const client = new GitHubClient({
        token: 'test-token',
        org: 'my-org',
        fetchFn: mockFetch,
      });

      const prs = await client.getUserPullRequests('dev_user');
      expect(prs).toHaveLength(1);
      expect(prs[0].number).toBe(42);
      expect(prs[0].title).toBe('feat: add task closure');
      expect(prs[0].repositoryName).toBe('my-repo');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/search/issues?q=type%3Apr%20author%3Adev_user%20org%3Amy-org'),
        expect.any(Object)
      );
    });

    it('returns empty array on API error without throwing', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Rate limit exceeded',
        text: async () => 'API rate limit exceeded',
      });

      const client = new GitHubClient({
        token: 'test-token',
        fetchFn: mockFetch,
      });

      const prs = await client.getUserPullRequests('dev_user');
      expect(prs).toEqual([]);
    });
  });

  describe('getPrDeliverablesForDate', () => {
    it('filters PRs to specified target date in timezone and formats deliverables', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          items: [
            {
              id: 101,
              number: 11,
              title: 'fix: validation bug',
              html_url: 'https://github.com/org/repo/pull/11',
              state: 'closed',
              created_at: '2026-10-15T08:30:00Z', // 2026-10-15 in Asia/Kolkata
              pull_request: { merged_at: '2026-10-15T09:00:00Z' },
              repository_url: 'https://api.github.com/repos/org/frontend',
            },
            {
              id: 102,
              number: 10,
              title: 'docs: update readme',
              html_url: 'https://github.com/org/repo/pull/10',
              state: 'closed',
              created_at: '2026-10-14T10:00:00Z', // Yesterday
              repository_url: 'https://api.github.com/repos/org/frontend',
            },
          ],
        }),
      });

      const client = new GitHubClient({
        token: 'test-token',
        fetchFn: mockFetch,
      });

      const deliverables = await client.getPrDeliverablesForDate('yash-somani_bflghec', '2026-10-15', 'Asia/Kolkata');
      expect(deliverables.isToday).toBe(true);
      expect(deliverables.pullRequests).toHaveLength(1);
      expect(deliverables.pullRequests[0].number).toBe(11);
      expect(deliverables.htmlDescription).toContain('PR #11');
      expect(deliverables.htmlDescription).toContain('fix: validation bug');
      expect(deliverables.summaryText).toContain('1 PR(s) created today: #11');
    });

    it('reports missing PR evidence without claiming unverified work', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          items: [],
        }),
      });

      const client = new GitHubClient({
        token: 'test-token',
        fetchFn: mockFetch,
      });

      const deliverables = await client.getPrDeliverablesForDate('mukul-ramteke_bflghec', '2026-10-15', 'Asia/Kolkata', {
        role: 'Dev On-Role',
      });
      expect(deliverables.isToday).toBe(false);
      expect(deliverables.pullRequests).toHaveLength(0);
      expect(deliverables.htmlDescription).toContain('No matching Pull Requests were found');
      expect(deliverables.summaryText).toContain('manual work summary not verified');
    });
  });
});
