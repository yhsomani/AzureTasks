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

    it('surfaces GitHub API errors instead of interpreting them as no PRs', async () => {
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

      await expect(client.getUserPullRequests('dev_user')).rejects.toThrow(/GitHub PR lookup failed.*403/);
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
  describe('date-scoped evidence completeness', () => {
    it('uses GitHub created-date search plus pagination instead of the most recent 50 PRs', async () => {
      const item = (number: number, createdAt: string) => ({
        id: number, number, title: `PR ${number}`,
        html_url: `https://github.com/org/repo/pull/${number}`, state: 'open',
        created_at: createdAt, repository_url: 'https://api.github.com/repos/org/repo',
      });
      const first = Array.from({ length: 100 }, (_, i) => item(i + 1, '2026-10-15T13:00:00Z'));
      const second = [item(101, '2026-10-15T13:10:00Z'), item(102, '2026-10-14T10:00:00Z')];
      const fetchFn = vi.fn().mockResolvedValueOnce({
        ok: true, json: async () => ({ total_count: 102, items: first }),
      }).mockResolvedValueOnce({
        ok: true, json: async () => ({ total_count: 102, items: second }),
      });
      const client = new GitHubClient({ org: 'org', token: 'test-only', fetchFn });
      const result = await client.getPrDeliverablesForDate('developer', '2026-10-15', 'Asia/Kolkata');
      expect(result.pullRequests).toHaveLength(101);
      expect(fetchFn).toHaveBeenCalledTimes(2);
      const firstUrl = fetchFn.mock.calls[0][0] as string;
      expect(decodeURIComponent(firstUrl)).toContain('created:2026-10-14..2026-10-16');
      expect(firstUrl).toContain('per_page=100&page=1');
      expect(fetchFn.mock.calls[1][0]).toContain('page=2');
    });

    it('uses timezone boundaries and excludes PRs from neighboring local days', async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        ok: true, json: async () => ({ total_count: 2, items: [
          { id: 1, number: 1, title: 'Inside', state: 'open', html_url: 'https://github.com/a/b/pull/1',
            created_at: '2026-10-14T19:00:00Z', repository_url: 'https://api.github.com/repos/a/b' },
          { id: 2, number: 2, title: 'Outside', state: 'open', html_url: 'https://github.com/a/b/pull/2',
            created_at: '2026-10-14T17:00:00Z', repository_url: 'https://api.github.com/repos/a/b' },
        ] }),
      });
      const client = new GitHubClient({ fetchFn });
      const result = await client.getPrDeliverablesForDate('developer', '2026-10-15', 'Asia/Kolkata');
      expect(result.pullRequests.map(p => p.number)).toEqual([1]);
    });

    it('fails visibly when GitHub says the search is incomplete or exceeds its cap', async () => {
      const incomplete = new GitHubClient({ fetchFn: vi.fn().mockResolvedValue({
        ok: true, json: async () => ({ incomplete_results: true, items: [] }),
      }) });
      await expect(incomplete.getPrDeliverablesForDate('dev', '2026-10-15', 'UTC'))
        .rejects.toThrow(/incomplete search results/);
      const oversized = new GitHubClient({ fetchFn: vi.fn().mockResolvedValue({
        ok: true, json: async () => ({ total_count: 1001, items: [] }),
      }) });
      await expect(oversized.getPrDeliverablesForDate('dev', '2026-10-15', 'UTC'))
        .rejects.toThrow(/1000-result/);
    });

    it('rejects invalid timezone and malformed requested dates', async () => {
      const client = new GitHubClient({ fetchFn: vi.fn() });
      await expect(client.getPrDeliverablesForDate('dev', '2026-02-30', 'UTC')).rejects.toThrow(/valid YYYY-MM-DD/);
      await expect(client.getPrDeliverablesForDate('dev', '2026-10-15', 'Unknown/Timezone')).rejects.toThrow();
    });
  });

  describe('per-person GitHub commit evidence', () => {
    it('returns real author commits within the local workday from the requested repository and branch', async () => {
      const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => ([
        { sha: 'abc123', html_url: 'https://github.com/team/app/commit/abc123',
          commit: { message: 'Fix checkout', author: { date: '2026-10-14T19:10:00Z' } } },
        { sha: 'def123', html_url: 'https://github.com/team/app/commit/def123',
          commit: { message: 'Other day', author: { date: '2026-10-14T10:00:00Z' } } },
      ]) });
      const client = new GitHubClient({ fetchFn });
      const commits = await client.getUserCommitsForDate('dev', '2026-10-15', 'Asia/Kolkata', ['team/app'], ['release/v2']);
      expect(commits).toHaveLength(1);
      expect(commits[0].sha).toBe('abc123');
      expect(commits[0].branch).toBe('release/v2');
      const url = fetchFn.mock.calls[0][0] as string;
      expect(url).toContain('/repos/team/app/commits?');
      expect(url).toContain('sha=release%2Fv2');
      expect(url).toContain('author=dev');
    });

    it('does not query unknown repositories or pretend missing commit configuration is evidence', async () => {
      const fetchFn = vi.fn();
      const client = new GitHubClient({ fetchFn });
      expect(await client.getUserCommitsForDate('dev', '2026-10-15', 'UTC', [])).toEqual([]);
      expect(fetchFn).not.toHaveBeenCalled();
      await expect(client.getUserCommitsForDate('dev', '2026-10-15', 'UTC', ['../secret'])).rejects.toThrow(/Invalid GitHub owner\/repo/);
      await expect(client.getUserCommitsForDate('dev', '2026-10-15', 'UTC', ['team/..'])).rejects.toThrow(/Invalid GitHub owner\/repo/);
    });

    it('does not treat a partial GitHub commit page as a complete result', async () => {
      const entry = { sha: 'abc', html_url: 'https://github.com/team/app/commit/abc',
        commit: { message: 'x', author: { date: '2026-10-15T12:00:00Z' } } };
      const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => Array.from({ length: 100 }, () => entry) });
      const client = new GitHubClient({ fetchFn });
      await expect(client.getUserCommitsForDate('dev', '2026-10-15', 'UTC', ['team/app'], ['main']))
        .rejects.toThrow(/pagination limit/);
      expect(fetchFn).toHaveBeenCalledTimes(10);
    });
  });

  describe('resilience, retries and timeout', () => {
    it('times out and aborts long-hanging requests', async () => {
      const fetchFn = vi.fn().mockImplementation((_url: string, init: any) => {
        return new Promise((_, reject) => {
          if (init?.signal) {
            init.signal.addEventListener('abort', () => {
              const err = new Error('The operation was aborted');
              err.name = 'AbortError';
              reject(err);
            });
          }
        });
      });

      const client = new GitHubClient({
        fetchFn,
        timeout: 50,
        maxRetries: 0,
        initialRetryDelayMs: 5,
      });

      await expect(client.getUserPullRequests('dev'))
        .rejects.toThrow(/timed out/);
    });

    it('retries on HTTP 429 with retry-after header and succeeds', async () => {
      const fetchFn = vi.fn()
        .mockResolvedValueOnce({
          status: 429,
          ok: false,
          headers: {
            get: (h: string) => (h.toLowerCase() === 'retry-after' ? '0' : null),
          },
          text: async () => 'Rate limit exceeded',
        })
        .mockResolvedValueOnce({
          status: 200,
          ok: true,
          headers: { get: () => null },
          json: async () => ({ items: [{ id: 1, number: 10, title: 'Fix bug', state: 'open', html_url: 'https://github.com/pr/10', created_at: '2026-10-15T10:00:00Z' }] }),
        });

      const client = new GitHubClient({
        fetchFn,
        maxRetries: 2,
        initialRetryDelayMs: 5,
      });

      const prs = await client.getUserPullRequests('alice');
      expect(prs).toHaveLength(1);
      expect(prs[0].number).toBe(10);
      expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it('retries on HTTP 403 when x-ratelimit-remaining is 0', async () => {
      const fetchFn = vi.fn()
        .mockResolvedValueOnce({
          status: 403,
          ok: false,
          headers: {
            get: (h: string) => (h.toLowerCase() === 'x-ratelimit-remaining' ? '0' : null),
          },
          text: async () => 'Secondary rate limit',
        })
        .mockResolvedValueOnce({
          status: 200,
          ok: true,
          headers: { get: () => null },
          json: async () => ({ items: [{ id: 2, number: 20, title: 'Add feature', state: 'open', html_url: 'https://github.com/pr/20', created_at: '2026-10-15T11:00:00Z' }] }),
        });

      const client = new GitHubClient({
        fetchFn,
        maxRetries: 2,
        initialRetryDelayMs: 5,
      });

      const prs = await client.getUserPullRequests('bob');
      expect(prs).toHaveLength(1);
      expect(prs[0].number).toBe(20);
      expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it('retries on HTTP 500 server error and succeeds on subsequent attempt', async () => {
      const fetchFn = vi.fn()
        .mockResolvedValueOnce({
          status: 500,
          ok: false,
          headers: { get: () => null },
          text: async () => 'Internal Server Error',
        })
        .mockResolvedValueOnce({
          status: 200,
          ok: true,
          headers: { get: () => null },
          json: async () => ({ items: [{ id: 3, number: 30, title: 'Refactor engine', state: 'closed', html_url: 'https://github.com/pr/30', created_at: '2026-10-15T12:00:00Z' }] }),
        });

      const client = new GitHubClient({
        fetchFn,
        maxRetries: 2,
        initialRetryDelayMs: 5,
      });

      const prs = await client.getUserPullRequests('charlie');
      expect(prs).toHaveLength(1);
      expect(prs[0].number).toBe(30);
      expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it('throws error when server error retries are exhausted', async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        status: 503,
        ok: false,
        headers: { get: () => null },
        text: async () => 'Service Unavailable',
      });

      const client = new GitHubClient({
        fetchFn,
        maxRetries: 2,
        initialRetryDelayMs: 5,
      });

      await expect(client.getUserPullRequests('exhausted'))
        .rejects.toThrow(/GitHub API server error 503/);
      expect(fetchFn).toHaveBeenCalledTimes(3); // attempt 0, 1, 2
    });

    it('does not retry non-retryable errors such as HTTP 404', async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        status: 404,
        statusText: 'Not Found',
        ok: false,
        headers: { get: () => null },
        text: async () => 'Resource not found',
      });

      const client = new GitHubClient({
        fetchFn,
        maxRetries: 2,
        initialRetryDelayMs: 5,
      });

      await expect(client.getUserPullRequests('notfound'))
        .rejects.toThrow(/GitHub API error 404/);
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });
  });

});
