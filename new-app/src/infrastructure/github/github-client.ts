/**
 * GitHub REST Client
 * Connects to GitHub API v3 to resolve user emails to logins and fetch Pull Requests
 */

import {
  GitHubPullRequest,
  GitHubPrDeliverables,
  GitHubCommit,
  MemberDailyPrSummary,
  DailyPrTrackingResult,
  formatPrTaskDescription,
  deriveGitHubUsernameFromEmail,
} from '../../domain/services/github-service.js';
import { PersonConfig } from '../../domain/entities/person.js';
import { logger } from '../logging/logger.js';

export interface GitHubClientOptions {
  token?: string;
  apiUrl?: string;
  org?: string;
  userSuffix?: string;
  fetchFn?: typeof fetch;
  timeout?: number;    // default 30000 ms
  maxRetries?: number; // default 3 attempts
  initialRetryDelayMs?: number; // default 1000 ms
}

export class GitHubClient {
  private readonly options: GitHubClientOptions;
  private readonly apiUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly emailCache = new Map<string, string | null>();
  private readonly timeout: number;
  private readonly maxRetries: number;
  private readonly initialRetryDelayMs: number;

  constructor(options: GitHubClientOptions = {}) {
    this.options = options;
    this.apiUrl = (options.apiUrl || process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, '');
    this.fetchFn = options.fetchFn || globalThis.fetch;
    this.timeout = options.timeout ?? 30000;
    this.maxRetries = options.maxRetries ?? 3;
    this.initialRetryDelayMs = options.initialRetryDelayMs ?? 1000;
  }

  private calculateBackoff(attempt: number): number {
    const baseDelay = this.initialRetryDelayMs;
    const maxDelay = 30000;
    const exp = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
    const jitter = Math.random() * 200;
    return exp + jitter;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
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
    const suffix = customSuffix !== undefined ? customSuffix : this.defaultUserSuffix;
    const cacheKey = `${normalizedEmail}::${suffix || ''}`;
    if (this.emailCache.has(cacheKey)) {
      return this.emailCache.get(cacheKey) ?? null;
    }

    // 1. Primary: Deterministic EMU derivation for corporate accounts (when suffix is configured)
    if (suffix) {
      const derived = deriveGitHubUsernameFromEmail(normalizedEmail, suffix);
      if (derived) {
        this.emailCache.set(cacheKey, derived);
        logger.warn(`Derived GitHub login '${derived}' for email '${email}' from a naming convention (suffix='${suffix}'); identity has NOT been verified.`);
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
        this.emailCache.set(cacheKey, login);
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
          this.emailCache.set(cacheKey, login);
          logger.info(`Resolved GitHub login '${login}' for email '${email}' via Commit Author Search.`);
          return login;
        }
      }

      this.emailCache.set(cacheKey, null);
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
    options: {
      org?: string;
      limit?: number;
      createdRange?: { from: string; to: string };
      updatedRange?: { from: string; to: string };
      exhaustive?: boolean;
    } = {}
  ): Promise<GitHubPullRequest[]> {
    const org = options.org || this.defaultOrg;
    const limit = options.exhaustive ? 100 : Math.min(Math.max(options.limit || 30, 1), 100);

    const query = [
      'type:pr',
      `author:${username}`,
      org ? `org:${org}` : '',
      options.createdRange ? `created:${options.createdRange.from}..${options.createdRange.to}` : '',
      options.updatedRange ? `updated:${options.updatedRange.from}..${options.updatedRange.to}` : '',
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
          updated_at?: string;
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
            updatedAt: item.updated_at,
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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetIsoDate) ||
        Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== targetIsoDate) {
      throw new Error('Invalid GitHub evidence date; expected YYYY-MM-DD.');
    }
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone });
    // UTC range covers any local calendar date (including UTC±14 offsets).
    const since = new Date(day.getTime() - 86400000).toISOString();
    const until = new Date(day.getTime() + 2 * 86400000 - 1).toISOString();
    const items = new Map<string, GitHubCommit>();
    for (const repo of normalizedRepos) {
      if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) ||
          repo.split('/').some(segment => segment === '.' || segment === '..')) {
        throw new Error('Invalid GitHub owner/repo configuration.');
      }
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

  /**
   * Fetches daily pull requests created from 12:00 AM up to the current time
   * on the specified targetDate for all configured team members in the configured timezone.
   */
  async getDailyPullRequestsSummary(options: {
    people: PersonConfig[];
    targetIsoDate: string;
    timezone: string;
    org?: string;
  }): Promise<DailyPrTrackingResult> {
    const { people, targetIsoDate, timezone, org = this.defaultOrg } = options;

    const day = new Date(`${targetIsoDate}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetIsoDate) ||
      !Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== targetIsoDate) {
      throw new Error('Daily PR evidence date must be a valid YYYY-MM-DD date.');
    }
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone });
    const utcDay = (offset: number) =>
      new Date(day.getTime() + offset * 86400000).toISOString().slice(0, 10);

    const members: MemberDailyPrSummary[] = [];
    let totalPrsToday = 0;
    let totalOpenPrsToday = 0;
    let totalMergedPrsToday = 0;

    for (const person of people) {
      if (person.enabled === false) continue;

      let ghUsername = person.githubUsername?.trim() || '';
      if (!ghUsername && person.assignedTo) {
        ghUsername = (await this.resolveUserByEmail(person.assignedTo)) || '';
      }

      if (!ghUsername) {
        members.push({
          key: person.key,
          name: person.name,
          email: person.assignedTo,
          githubUsername: '',
          prCount: 0,
          openCount: 0,
          mergedCount: 0,
          pullRequests: [],
          openPrs: [],
          mergedPrs: [],
        });
        continue;
      }

      try {
        // Query PRs created in the range or updated in the range sequentially to prevent hitting GitHub burst search limits
        const createdPrs = await this.getUserPullRequests(ghUsername, {
          org,
          createdRange: { from: utcDay(-1), to: utcDay(1) },
          exhaustive: true,
        });

        // Small delay between searches to respect GitHub search secondary rate limits
        await this.sleep(300);

        const updatedPrs = await this.getUserPullRequests(ghUsername, {
          org,
          updatedRange: { from: utcDay(-1), to: utcDay(1) },
          exhaustive: true,
        });

        // Delay before moving to the next member
        await this.sleep(200);

        // Merge without duplicates by PR ID
        const prMap = new Map<number, GitHubPullRequest>();
        for (const pr of [...createdPrs, ...updatedPrs]) {
          prMap.set(pr.id, pr);
        }

        // Filter to PRs created OR updated on targetIsoDate in configured timezone
        let memberPrs = Array.from(prMap.values()).filter(pr => {
          const createdDate = this.toLocalDateIso(pr.createdAt, timezone);
          const updatedDate = pr.updatedAt ? this.toLocalDateIso(pr.updatedAt, timezone) : createdDate;
          return createdDate === targetIsoDate || updatedDate === targetIsoDate;
        });

        // If person has explicit githubRepositories configured, filter to those repositories
        if (person.githubRepositories && person.githubRepositories.length > 0) {
          const allowedRepos = new Set(
            person.githubRepositories.map(r => r.includes('/') ? r.split('/').pop()!.toLowerCase() : r.toLowerCase())
          );
          memberPrs = memberPrs.filter(pr => pr.repositoryName && allowedRepos.has(pr.repositoryName.toLowerCase()));
        }

        // Categorize into Open PRs and Merged PRs
        // In GitHub API:
        // - Open PRs: pr.state === 'open'
        // - Merged PRs: pr.mergedAt != null (or closed with mergedAt)
        // - Closed without merge: pr.state === 'closed' && !pr.mergedAt
        const openPrs = memberPrs.filter(pr => pr.state === 'open');
        const mergedPrs = memberPrs.filter(pr => Boolean(pr.mergedAt));

        totalPrsToday += memberPrs.length;
        totalOpenPrsToday += openPrs.length;
        totalMergedPrsToday += mergedPrs.length;

        members.push({
          key: person.key,
          name: person.name,
          email: person.assignedTo,
          githubUsername: ghUsername,
          prCount: memberPrs.length,
          openCount: openPrs.length,
          mergedCount: mergedPrs.length,
          pullRequests: memberPrs,
          openPrs,
          mergedPrs,
          filteredByRepositories: person.githubRepositories && person.githubRepositories.length > 0 ? person.githubRepositories : undefined,
        });
      } catch (err: any) {
        logger.warn(`Failed to retrieve daily PRs for ${person.name} (${ghUsername}): ${err.message}`);
        members.push({
          key: person.key,
          name: person.name,
          email: person.assignedTo,
          githubUsername: ghUsername,
          prCount: 0,
          openCount: 0,
          mergedCount: 0,
          pullRequests: [],
          openPrs: [],
          mergedPrs: [],
        });
      }
    }

    return {
      targetDate: targetIsoDate,
      timezone,
      totalPrsToday,
      totalOpenPrsToday,
      totalMergedPrsToday,
      members,
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
    const baseHeaders: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'Azure-DevOps-Task-Creator',
      ...(init.headers as Record<string, string> || {}),
    };

    if (this.token) {
      baseHeaders.Authorization = `Bearer ${this.token}`;
    }

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      try {
        const res = await this.fetchFn(url, {
          ...init,
          headers: baseHeaders,
          signal: controller.signal,
        });

        const status = res.status ?? 200;
        const remainingHeader = res.headers?.get?.('x-ratelimit-remaining');
        const retryAfterHeader = res.headers?.get?.('retry-after');

        // Check for primary or secondary rate limits
        let isSecondaryRateLimit = false;
        let responseBodyText = '';
        if (status === 403 || status === 429) {
          responseBodyText = typeof res.text === 'function' ? await res.text().catch(() => '') : '';
          const lowerText = responseBodyText.toLowerCase();
          if (
            lowerText.includes('secondary rate limit') ||
            lowerText.includes('please wait a few minutes') ||
            lowerText.includes('abuse detection')
          ) {
            isSecondaryRateLimit = true;
          }
        }

        const isRateLimited = status === 429 || isSecondaryRateLimit || (
          status === 403 && (remainingHeader === '0' || Boolean(retryAfterHeader))
        );

        if (isRateLimited) {
          if (attempt >= this.maxRetries) {
            const errorSnippet = responseBodyText.slice(0, 200);
            throw new Error(`GitHub API rate limit exceeded (HTTP ${status}): ${errorSnippet}`);
          }
          let delay = isSecondaryRateLimit
            ? Math.max(this.calculateBackoff(attempt), Math.min(this.initialRetryDelayMs, 5000))
            : this.calculateBackoff(attempt);
          if (retryAfterHeader) {
            const sec = Number(retryAfterHeader);
            if (Number.isFinite(sec) && sec > 0) delay = Math.min(sec * 1000, 60000);
          } else {
            const resetHeader = res.headers?.get?.('x-ratelimit-reset');
            if (resetHeader) {
              const resetSec = Number(resetHeader);
              if (Number.isFinite(resetSec)) {
                const diffMs = resetSec * 1000 - Date.now();
                if (diffMs > 0) delay = Math.min(diffMs, 60000);
              }
            }
          }
          logger.warn(`GitHub API ${isSecondaryRateLimit ? 'secondary rate limit' : 'rate limit'} hit (HTTP ${status}). Backing off for ${Math.round(delay)}ms (attempt ${attempt + 1}/${this.maxRetries})...`);
          await this.sleep(delay);
          continue;
        }

        if (status >= 500) {
          if (attempt >= this.maxRetries) {
            const errorBody = responseBodyText || (typeof res.text === 'function' ? await res.text().catch(() => '') : '');
            throw new Error(`GitHub API server error ${status}: ${errorBody.slice(0, 200)}`);
          }
          await this.sleep(this.calculateBackoff(attempt));
          continue;
        }

        if (!res.ok) {
          const errorBody = responseBodyText || (typeof res.text === 'function' ? await res.text().catch(() => '') : '');
          throw new Error(`GitHub API error ${res.status} (${res.statusText}): ${errorBody.slice(0, 200)}`);
        }

        if (responseBodyText) {
          return JSON.parse(responseBodyText) as T;
        }
        return (await res.json()) as T;
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          if (attempt >= this.maxRetries) {
            throw new Error(`GitHub API request timed out after ${this.timeout}ms: ${endpoint}`);
          }
          await this.sleep(this.calculateBackoff(attempt));
          continue;
        }

        const isNetworkError = err instanceof TypeError || String(err?.message || '').toLowerCase().includes('fetch');
        if (isNetworkError && attempt < this.maxRetries) {
          await this.sleep(this.calculateBackoff(attempt));
          continue;
        }

        throw err;
      } finally {
        clearTimeout(timeoutId);
      }
    }

    throw new Error(`GitHub API request failed after ${this.maxRetries} retries: ${endpoint}`);
  }
}
