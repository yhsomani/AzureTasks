/**
 * GitHub REST Client
 * Connects to GitHub API v3 to resolve user emails to logins and fetch Pull Requests
 */

import { GitHubPullRequest, GitHubPrDeliverables, formatPrTaskDescription, deriveGitHubUsernameFromEmail } from '../../domain/services/github-service.js';
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
    options: { org?: string; limit?: number } = {}
  ): Promise<GitHubPullRequest[]> {
    const org = options.org || this.defaultOrg;
    const limit = Math.min(Math.max(options.limit || 30, 1), 100);

    const query = [
      'type:pr',
      `author:${username}`,
      org ? `org:${org}` : '',
    ].filter(Boolean).join(' ');

    try {
      const data = await this.request<{
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
      }>(`/search/issues?q=${encodeURIComponent(query)}&sort=created&order=desc&per_page=${limit}`);

      if (!data?.items) {
        return [];
      }

      return data.items.map(item => {
        const repoName = item.repository_url ? item.repository_url.split('/').pop() : undefined;
        return {
          id: item.id,
          number: item.number,
          title: item.title,
          htmlUrl: item.html_url,
          state: item.state,
          createdAt: item.created_at,
          closedAt: item.closed_at,
          mergedAt: item.pull_request?.merged_at,
          body: item.body,
          repositoryName: repoName,
        };
      });
    } catch (err: any) {
      logger.warn(`Failed to fetch GitHub PRs for user '${username}': ${err.message}`);
      return [];
    }
  }

  /**
   * Retrieves PR deliverables for a specific target date (YYYY-MM-DD in timezone).
   * Strictly filters to PRs created on the target date for this individual user.
   * If user created NO PRs on target date -> formats a clean daily engineering deliverable description.
   */
  async getPrDeliverablesForDate(
    username: string,
    targetIsoDate: string,
    timezone: string,
    options: { org?: string; role?: string } = {}
  ): Promise<GitHubPrDeliverables> {
    const prs = await this.getUserPullRequests(username, { org: options.org, limit: 50 });

    // Filter strictly to PRs created on targetIsoDate in the specified timezone
    const todayPrs = prs.filter(pr => {
      const localDate = this.toLocalDateIso(pr.createdAt, timezone);
      return localDate === targetIsoDate;
    });

    const isToday = todayPrs.length > 0;
    const formatted = formatPrTaskDescription({
      username,
      targetIsoDate,
      sourceDate: targetIsoDate,
      isToday,
      pullRequests: todayPrs,
      role: options.role,
    });

    return {
      username,
      sourceDate: targetIsoDate,
      isToday,
      pullRequests: todayPrs,
      htmlDescription: formatted.htmlDescription,
      summaryText: formatted.summaryText,
    };
  }

  private toLocalDateIso(utcIso: string, timezone: string): string {
    try {
      const d = new Date(utcIso);
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(d);
    } catch {
      return utcIso.split('T')[0];
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
