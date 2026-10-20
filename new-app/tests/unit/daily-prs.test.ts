import { describe, it, expect, vi } from 'vitest';
import { GitHubClient } from '../../src/infrastructure/github/github-client.js';
import { PersonConfig } from '../../src/domain/entities/person.js';

describe('Daily PR Tracking by Team Member', () => {
  it('correctly aggregates daily PR counts created on the target date in local timezone', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      // Mock GitHub search API response
      if (url.includes('/search/issues')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            total_count: 3,
            incomplete_results: false,
            items: [
              {
                id: 101,
                number: 1,
                title: 'Feature: Add user authentication',
                html_url: 'https://github.com/org/repo/pull/1',
                state: 'open',
                // Created on 2026-10-19 at 03:00 UTC = 08:30 IST (Today in Asia/Kolkata)
                created_at: '2026-10-19T03:00:00Z',
                repository_url: 'https://api.github.com/repos/3in1-AppFrontEnd/3in1_PWA_MYACCOUNT',
              },
              {
                id: 102,
                number: 2,
                title: 'Bugfix: Fix button styling',
                html_url: 'https://github.com/org/repo/pull/2',
                state: 'closed',
                // Created on 2026-10-19 at 08:00 UTC = 13:30 IST (Today in Asia/Kolkata)
                created_at: '2026-10-19T08:00:00Z',
                repository_url: 'https://api.github.com/repos/3in1-AppFrontEnd/3in1_PWA_MYACCOUNT',
              },
              {
                id: 103,
                number: 3,
                title: 'Docs: Update readme',
                html_url: 'https://github.com/org/repo/pull/3',
                state: 'closed',
                // Created on 2026-10-18 at 18:00 UTC = 23:30 IST (Yesterday in Asia/Kolkata)
                created_at: '2026-10-18T18:00:00Z',
                repository_url: 'https://api.github.com/repos/3in1-AppFrontEnd/3in1_PWA_MYACCOUNT',
              },
            ],
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    const client = new GitHubClient({
      token: 'test-token',
      userSuffix: '_bflghec',
      fetchFn: mockFetch,
    });

    const people: PersonConfig[] = [
      {
        key: 'yash_somani',
        name: 'Yash Somani',
        assignedTo: 'yash.somani@bajajfinserv.in',
        enabled: true,
      },
    ];

    const result = await client.getDailyPullRequestsSummary({
      people,
      targetIsoDate: '2026-10-19',
      timezone: 'Asia/Kolkata',
      org: '3in1-AppFrontEnd',
    });

    expect(result.targetDate).toBe('2026-10-19');
    expect(result.timezone).toBe('Asia/Kolkata');
    // Out of 3 PRs returned, only 2 were created on 2026-10-19 in Asia/Kolkata (the 3rd was 23:30 on 2026-10-18)
    expect(result.totalPrsToday).toBe(2);
    expect(result.members.length).toBe(1);
    expect(result.members[0].name).toBe('Yash Somani');
    expect(result.members[0].githubUsername).toBe('yash-somani_bflghec');
    expect(result.members[0].prCount).toBe(2);
    expect(result.members[0].pullRequests.map(p => p.number)).toEqual([1, 2]);
  });

  it('filters PRs by configured repositories when specified per person', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/search/issues')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            total_count: 2,
            incomplete_results: false,
            items: [
              {
                id: 201,
                number: 10,
                title: 'Matched repo PR',
                html_url: 'https://github.com/org/repo/pull/10',
                state: 'open',
                created_at: '2026-10-19T05:00:00Z',
                repository_url: 'https://api.github.com/repos/3in1-AppFrontEnd/repo-alpha',
              },
              {
                id: 202,
                number: 11,
                title: 'Ignored repo PR',
                html_url: 'https://github.com/org/repo/pull/11',
                state: 'open',
                created_at: '2026-10-19T06:00:00Z',
                repository_url: 'https://api.github.com/repos/3in1-AppFrontEnd/repo-beta',
              },
            ],
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    const client = new GitHubClient({
      token: 'test-token',
      fetchFn: mockFetch,
    });

    const people: PersonConfig[] = [
      {
        key: 'dev_user',
        name: 'Developer User',
        assignedTo: 'dev.user@example.com',
        githubUsername: 'dev_user_bflghec',
        githubRepositories: ['3in1-AppFrontEnd/repo-alpha'],
        enabled: true,
      },
    ];

    const result = await client.getDailyPullRequestsSummary({
      people,
      targetIsoDate: '2026-10-19',
      timezone: 'UTC',
    });

    expect(result.totalPrsToday).toBe(1);
    expect(result.members[0].prCount).toBe(1);
    expect(result.members[0].pullRequests[0].number).toBe(10);
    expect(result.members[0].filteredByRepositories).toEqual(['3in1-AppFrontEnd/repo-alpha']);
  });

  it('aggregates multiple team members and computes accurate team total', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('author%3Auser1_bflghec')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            total_count: 2,
            incomplete_results: false,
            items: [
              {
                id: 301,
                number: 1,
                title: 'User 1 PR A',
                html_url: 'https://github.com/org/repo/pull/1',
                state: 'open',
                created_at: '2026-10-19T02:00:00Z',
                repository_url: 'https://api.github.com/repos/org/repo',
              },
              {
                id: 302,
                number: 2,
                title: 'User 1 PR B',
                html_url: 'https://github.com/org/repo/pull/2',
                state: 'open',
                created_at: '2026-10-19T04:00:00Z',
                repository_url: 'https://api.github.com/repos/org/repo',
              },
            ],
          }),
        });
      }
      if (url.includes('author%3Auser2_bflghec')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            total_count: 1,
            incomplete_results: false,
            items: [
              {
                id: 303,
                number: 3,
                title: 'User 2 PR',
                html_url: 'https://github.com/org/repo/pull/3',
                state: 'open',
                created_at: '2026-10-19T06:00:00Z',
                repository_url: 'https://api.github.com/repos/org/repo',
              },
            ],
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({ total_count: 0, items: [] }) });
    });

    const client = new GitHubClient({
      token: 'test-token',
      fetchFn: mockFetch,
    });

    const people: PersonConfig[] = [
      { key: 'user1', name: 'User One', assignedTo: 'user1@company.com', githubUsername: 'user1_bflghec', enabled: true },
      { key: 'user2', name: 'User Two', assignedTo: 'user2@company.com', githubUsername: 'user2_bflghec', enabled: true },
      { key: 'user3', name: 'Disabled User', assignedTo: 'user3@company.com', enabled: false },
    ];

    const result = await client.getDailyPullRequestsSummary({
      people,
      targetIsoDate: '2026-10-19',
      timezone: 'UTC',
    });

    expect(result.totalPrsToday).toBe(3);
    expect(result.members.length).toBe(2); // user3 is disabled so excluded
    expect(result.members.find(m => m.key === 'user1')?.prCount).toBe(2);
    expect(result.members.find(m => m.key === 'user2')?.prCount).toBe(1);
  });
});
