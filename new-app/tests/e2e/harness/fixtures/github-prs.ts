export interface MockGitHubPR {
  id: number;
  number: number;
  title: string;
  state: 'open' | 'closed';
  merged_at?: string | null;
  created_at: string;
  updated_at: string;
  closed_at?: string | null;
  html_url: string;
  user: {
    login: string;
    id: number;
  };
  author_email?: string;
  repository_url?: string;
}

export interface MockGitHubCommit {
  sha: string;
  commit: {
    author: {
      name: string;
      email: string;
      date: string;
    };
    message: string;
  };
  author?: {
    login: string;
  };
}

export const SEED_PRS: MockGitHubPR[] = [
  {
    id: 501,
    number: 501,
    title: 'feat: add authentication JWT validation',
    state: 'closed',
    merged_at: '2026-10-14T16:30:00Z',
    created_at: '2026-10-14T09:15:00Z',
    updated_at: '2026-10-14T16:30:00Z',
    closed_at: '2026-10-14T16:30:00Z',
    html_url: 'https://github.com/workops/core/pull/501',
    user: {
      login: 'dev1-workops',
      id: 9001,
    },
    author_email: 'dev1@workops.test',
  },
  {
    id: 502,
    number: 502,
    title: 'fix: resolve connection pool leak in postgres adapter',
    state: 'open',
    merged_at: null,
    created_at: '2026-10-14T11:00:00Z',
    updated_at: '2026-10-14T14:00:00Z',
    html_url: 'https://github.com/workops/core/pull/502',
    user: {
      login: 'dev2-workops',
      id: 9002,
    },
    author_email: 'dev2@workops.test',
  },
];

export const SEED_COMMITS: MockGitHubCommit[] = [
  {
    sha: 'c0ffee1234567890abcdef1234567890abcdef12',
    commit: {
      author: {
        name: 'Dev One',
        email: 'dev1@workops.test',
        date: '2026-10-14T14:20:00Z',
      },
      message: 'feat(auth): add RS256 token verification middleware',
    },
    author: {
      login: 'dev1-workops',
    },
  },
];
