/**
 * GitHub REST Client
 * Connects to GitHub API v3 to resolve user emails to logins and fetch Pull Requests
 */

import { GitHubPullRequest, GitHubPrDeliverables, GitHubCommit, formatPrTaskDescription, deriveGitHubUsernameFromEmail } from '../../domain/services/github-service.js';
import { logger } from '../logging/logger.js';

export interface GitHubClientOptions {
  token?: string;
  apiUrl?: string;
  org?: string;
  userSuffix?: string;
  fetchFn?: typeof fetch;
}

export class GitHubClient {
  private readonly options: GitHubClientOptions;
  private readonly apiUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly emailCache = new Map<string, string | null>();

  constructor(options: GitHubClientOptions = {}) {
    this.options = options;
    this.apiUrl = (options.apiUrl || process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, '');
    this.fetchFn = options.fetchFn || globalThis.fetch;
  }

  get token(): string | undefined {
    return this.options.token || process.env.GITHUB_TOKEN || process.env.GH_PAT;
  }

  get defaultOrg(): string | undefined {
    return this.options.org || process.env.GITHUB_ORG;
  }

  get defaultUserSuffix(): string {
    return this.options.userSuffix !== undefined ? this.options.userSuffix : (process.env.GITHUB_USER_SUFFIX ?? '_bflghec');
  }

  /**
   * Resolves a user's corporate email to their GitHub username/login.
   * Priority:
   * 1. Deterministic EMU derivation (when enterprise suffix is configured)
   * 2. GitHub Users API Search (if token/network available)
   * 3. GitHub Commits API Search
   */
  async resolveUserByEmail(email: string, customSuffix?: string): Promise<string | null> {
    if (!email) return null;
    const normalizedEmail = email.toLowerCase().trim();
    if (this.emailCache.has(normalizedEmail)) {
      return this.emailCache.get(normalizedEmail) ?? null;
    }

    const suffix = customSuffix !== undefined ? customSuffix : this.defaultUserSuffix;

    // 1. Primary: Deterministic EMU derivation for corporate accounts (when suffix is configured)
    if (suffix) {
      const derived = deriveGitHubUsernameFromEmail(normalizedEmail, suffix);
      if (derived) {
        this.emailCache.set(normalizedEmail, derived);
        logger.info(`Resolved GitHub login '${derived}' for email '${email}' via EMU derivation (suffix='${suffix}').`);
        return derived;
      }
    }

    try {
      // 2. Search Users API
      const userRes = await this.request<{ items?: Array<{ login: string }> }>(
        `/search/users?q=${encodeURIComponent(normalizedEmail)}+in:email`
      );

      if (userRes?.items && userRes.items.length > 0) {
        const login = userRes.items[0].login;
        this.emailCache.set(normalizedEmail, login);
        logger.info(`Resolved GitHub login '${login}' for email '${email}' via User Search.`);
        return login;
      }

      // 3. Fallback: Search Commits API
      const commitRes = await this.request<{
        items?: Array<{
          author?: { login?: string };
          committer?: { login?: string };
        }>;
      }>(
        `/search/commits?q=author-email:${encodeURIComponent(normalizedEmail)}&sort=author-date&order=desc`,
        { headers: { Accept: 'application/vnd.github.cloak-preview+json' } }
      );

      if (commitRes?.items && commitRes.items.length > 0) {
        const login = commitRes.items[0].author?.login || commitRes.items[0].committer?.login;
        if (login) {
          this.emailCache.set(normalizedEmail, login);
          logger.info(`Resolved GitHub login '${login}' for email '${email}' via Commit Author Search.`);
          return login;
        }
      }

      this.emailCache.set(normalizedEmail, null);
      return null;
    } catch (err: any) {
      logger.warn(`Failed to query GitHub API for '${email}': ${err.message}`);
      return null;
    }
  }

  /**
   * Fetches recent Pull Requests authored by a given GitHub username.
   */
  async getUserPullRequests(
    username: string,
    options: { org?: string; limit?: number; createdRange?: { from: string; to: string }; exhaustive?: boolean } = {}
  ): Promise<GitHubPullRequest[]> {
    const org = options.org || this.defaultOrg;
    const limit = options.exhaustive ? 100 : Math.min(Math.max(options.limit || 30, 1), 100);

    const query = [
      'type:pr',
      `author:${username}`,
      org ? `org:${org}` : '',
      options.createdRange ? `created:${options.createdRange.from}..${options.createdRange.to}` : '',
    ].filter(Boolean).join(' ');

    try {
      type SearchResult = {
        total_count?: number;
        incomplete_results?: boolean;
        items?: Array<{
          id: number;
          number: number;
          title: string;
          html_url: string;
          state: string;
          created_at: string;
          closed_at?: string | null;
          pull_request?: { merged_at?: string | null };
          body?: string | null;
          repository_url: string;
        }>;
      };
      const prs: GitHubPullRequest[] = [];
      for (let page = 1; page <= (options.exhaustive ? 10 : 1); page++) {
        const data = await this.request<SearchResult>(
          `/search/issues?q=${encodeURIComponent(query)}&sort=created&order=desc&per_page=${limit}&page=${page}`
        );
        if (!Array.isArray(data.items)) {
          throw new Error('GitHub returned an invalid search response; completeness is unknown.');
        }
        if (data.incomplete_results === true) {
          throw new Error('GitHub reported incomplete search results; work evidence cannot be trusted.');
        }
        if (options.exhaustive && (data.total_count ?? 0) > 1000) {
          throw new Error('GitHub date-scoped search exceeds the 1000-result API cap; narrow the repository scope.');
        }
        for (const item of data.items) {
          if (!item.created_at || !item.html_url) {
            throw new Error('GitHub returned a PR without its creation timestamp or URL.');
          }
          prs.push({
            id: item.id,
            number: item.number,
            title: item.title,
            htmlUrl: item.html_url,
            state: item.state,
            createdAt: item.created_at,
            closedAt: item.closed_at,
            mergedAt: item.pull_request?.merged_at,
            body: item.body,
            repositoryName: item.repository_url ? item.repository_url.split('/').pop() : undefined,
          });
        }
        if (!options.exhaustive || data.items.length < limit ||
            (typeof data.total_count === 'number' && prs.length >= data.total_count)) {
          return prs;
        }
      }
      throw new Error('GitHub search reached its pagination limit; evidence may be incomplete.');
    } catch (err: any) {
      const reason = err instanceof Error ? err.message : String(err);
      logger.warn(`Failed to fetch GitHub PRs for user '${username}': ${reason}`);
      // Auth failures/rate limits cannot be represented as an empty PR list:
      // doing so would allow EOD descriptions and closures based on false evidence.
      throw new Error(`GitHub PR lookup failed for '${username}': ${reason}`);
    }
  }

  /**
   * Fetch author-filtered commits from explicit repository/branch scopes.
   * This API never infers a repo or fabricates commits if none is configured.
   * Exhaustive pagination is bounded; untrustworthy partial responses fail.
   */
  async getUserCommitsForDate(
    username: string,
    targetIsoDate: string,
    timezone: string,
    repositories: string[],
    branches: string[] = []
  ): Promise<GitHubCommit[]> {
    if (!repositories.length) return [];
    const normalizedRepos = [...new Set(repositories)];
    const normalizedBranches = [...new Set(branches)];
    const combos = normalizedRepos.length * Math.max(1, normalizedBranches.length);
    if (combos > 20) throw new Error('Too many GitHub repository/branch combinations (maximum 20).');
    const day = new Date(`${targetIsoDate}T00:00:00Z`);
    if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(targetIsoDate) ||
        Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== targetIsoDate) {
      throw new Error('Invalid GitHub evidence date; expected YYYY-MM-DD.');
    }
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone });
    // UTC range covers any local calendar date (including UTC±14 offsets).
    const since = new Date(day.getTime() - 86400000).toISOString();
    const until = new Date(day.getTime() + 2 * 86400000 - 1).toISOString();
    const items = new Map<string, GitHubCommit>();
    for (const repo of normalizedRepos) {
      if (!/^[A-Za-z0-9_.-]+\\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error('Invalid GitHub owner/repo configuration.');
      for (const branch of normalizedBranches.length ? normalizedBranches : ['']) {
        if (branch && (!/^[A-Za-z0-9_./-]+$/.test(branch) || branch.includes('..') ||
            branch.startsWith('/') || branch.endsWith('/'))) {
          throw new Error('Invalid GitHub branch configuration.');
        }
        let finished = false;
        for (let page = 1; page <= 10; page++) {
          const params = new URLSearchParams({
            author: username, since, until, per_page: '100', page: String(page),
          });
          if (branch) params.set('sha', branch);
          const raw = await this.request<Array<{
            sha: string;
            html_url: string;
            commit: { message: string; author?: { date?: string } };
          }>>(`/repos/${repo}/commits?${params.toString()}`);
          if (!Array.isArray(raw)) throw new Error('Invalid GitHub commit response; completeness unknown.');
          for (const entry of raw) {
            if (!entry.sha || !entry.html_url || !entry.commit?.author?.date) {
              throw new Error('GitHub commit record missing required evidence fields.');
            }
            if (this.toLocalDateIso(entry.commit.author.date, timezone) !== targetIsoDate) continue;
            items.set(`${repo}:${entry.sha}`, {
              sha: entry.sha, message: entry.commit.message, htmlUrl: entry.html_url,
              authoredAt: entry.commit.author.date, repositoryName: repo,
              branch: branch || '(default)',
            });
          }
          if (raw.length < 100) { finished = true; break; }
        }
        if (!finished) throw new Error(`GitHub commit pagination limit reached for ${repo}; evidence incomplete.`);
      }
    }
    return [...items.values()].sort((a, b) => b.authoredAt.localeCompare(a.authoredAt));
  }

  /**
   * Retrieves PR deliverables for a specific target date (YYYY-MM-DD in timezone).
   * Strictly filters to PRs created on the target date for this individual user.
   * If no matching PRs were returned, disclose the absence of verified PR evidence.
   */
  async getPrDeliverablesForDate(
    username: string,
    targetIsoDate: string,
    timezone: string,
    options: { org?: string; role?: string; repositories?: string[]; branches?: string[] } = {}
  ): Promise<GitHubPrDeliverables> {
    // A 50-most-recent PR search can hide work from a busy contributor.
    // Query a bounded UTC date range that safely covers the local date at
    // every timezone offset, then exhaust GitHub's pages before filtering.
    const day = new Date(`${targetIsoDate}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetIsoDate) ||
      !Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== targetIsoDate) {
      throw new Error('GitHub evidence date must be a valid YYYY-MM-DD date.');
    }
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone });
    const utcDay = (offset: number) =>
      new Date(day.getTime() + offset * 86400000).toISOString().slice(0, 10);
    const prs = await this.getUserPullRequests(username, {
      org: options.org,
      createdRange: { from: utcDay(-1), to: utcDay(1) },
      exhaustive: true,
    });

    // Filter strictly to PRs created on targetIsoDate in the specified timezone
    const todayPrs = prs.filter(pr => {
      const localDate = this.toLocalDateIso(pr.createdAt, timezone);
      return localDate === targetIsoDate;
    });

    const commits = options.repositories?.length
      ? await this.getUserCommitsForDate(username, targetIsoDate, timezone, options.repositories, options.branches)
      : [];
    const isToday = todayPrs.length > 0 || commits.length > 0;
    const formatted = formatPrTaskDescription({
      username,
      targetIsoDate,
      sourceDate: targetIsoDate,
      isToday,
      pullRequests: todayPrs,
      commits,
      role: options.role,
    });

    return {
      username,
      sourceDate: targetIsoDate,
      isToday,
      pullRequests: todayPrs,
      commits,
      htmlDescription: formatted.htmlDescription,
      summaryText: formatted.summaryText,
    };
  }

  private toLocalDateIso(utcIso: string, timezone: string): string {
    try {
      const d = new Date(utcIso);
      if (Number.isNaN(d.getTime())) throw new Error('Invalid GitHub PR timestamp.');
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(d);
    } catch (error) {
      throw new Error(`Unable to evaluate GitHub PR time in configured timezone: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async request<T>(endpoint: string, init: RequestInit = {}): Promise<T> {
    const url = `${this.apiUrl}${endpoint}`;
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'Azure-DevOps-Task-Creator',
      ...(init.headers as Record<string, string> || {}),
    };

    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }

    const res = await this.fetchFn(url, { ...init, headers });
    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');
      throw new Error(`GitHub API error ${res.status} (${res.statusText}): ${errorBody.slice(0, 200)}`);
    }

    return (await res.json()) as T;
  }
}
