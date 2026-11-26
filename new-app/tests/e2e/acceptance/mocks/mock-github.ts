import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface MockGitHubUser {
  id?: number;
  login: string;
  email: string;
  name?: string;
}

export interface MockGitHubPr {
  id: number;
  number: number;
  title: string;
  html_url: string;
  state: 'open' | 'closed';
  created_at: string;
  updated_at?: string;
  closed_at?: string | null;
  pull_request?: { merged_at?: string | null };
  body?: string | null;
  repository_url: string;
  authorLogin: string;
}

export interface MockGitHubCommit {
  sha: string;
  html_url: string;
  repo: string;
  branch?: string;
  authorLogin: string;
  authorEmail?: string;
  authorName?: string;
  authoredAt: string;
  message: string;
}

export interface GitHubRequestRecord {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string | string[] | undefined>;
  timestamp: string;
}

interface GitHubFaultRule {
  remaining: number;
  statusCode: number;
  matchPath?: string | RegExp;
  message?: string;
}

export interface MockGitHubSeedOptions {
  users?: MockGitHubUser[];
  prs?: MockGitHubPr[];
  commits?: MockGitHubCommit[];
  requireAuth?: boolean;
}

export class MockGitHubServer {
  private server: http.Server | null = null;
  private baseUrl = '';
  private users: MockGitHubUser[] = [];
  private prs: MockGitHubPr[] = [];
  private commits: MockGitHubCommit[] = [];
  private requests: GitHubRequestRecord[] = [];
  private unavailable = false;
  private unavailableStatus = 503;
  private rateLimited = false;
  private rateLimitResetSeconds = 60;
  private faultQueue: GitHubFaultRule[] = [];
  private requireAuth = false;
  private initialSeed: MockGitHubSeedOptions;

  constructor(seed: MockGitHubSeedOptions = {}) {
    this.initialSeed = seed;
    this.applySeed(seed);
  }

  private applySeed(seed: MockGitHubSeedOptions): void {
    this.users = seed.users ? seed.users.map((u) => ({ ...u })) : [];
    this.prs = seed.prs ? seed.prs.map((p) => ({ ...p, pull_request: p.pull_request ? { ...p.pull_request } : undefined })) : [];
    this.commits = seed.commits ? seed.commits.map((c) => ({ ...c })) : [];
    this.requireAuth = Boolean(seed.requireAuth);
  }

  public async start(): Promise<string> {
    if (this.server) return this.baseUrl;

    this.server = http.createServer((req, res) => {
      void this.handleRequest(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(0, '127.0.0.1', () => resolve());
    });

    const address = this.server.address() as AddressInfo;
    this.baseUrl = `http://127.0.0.1:${address.port}`;
    return this.baseUrl;
  }

  public async stop(): Promise<void> {
    if (!this.server) return;
    const srv = this.server;
    this.server = null;
    if (typeof srv.closeAllConnections === 'function') {
      srv.closeAllConnections();
    }
    await new Promise<void>((resolve, reject) => {
      srv.close((err) => {
        if (err && (err as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  public reset(newSeed?: MockGitHubSeedOptions): void {
    this.requests = [];
    this.unavailable = false;
    this.unavailableStatus = 503;
    this.rateLimited = false;
    this.faultQueue = [];
    this.applySeed(newSeed ?? this.initialSeed);
  }

  public getRequests(): GitHubRequestRecord[] {
    return [...this.requests];
  }

  public clearRequests(): void {
    this.requests = [];
  }

  public setUnavailable(unavailable: boolean, statusCode = 503): void {
    this.unavailable = unavailable;
    this.unavailableStatus = statusCode;
  }

  public setRateLimited(limited: boolean, resetSeconds = 60): void {
    this.rateLimited = limited;
    this.rateLimitResetSeconds = resetSeconds;
  }

  public failNext(count: number, statusCode = 500, matchPath?: string | RegExp, message?: string): void {
    if (count <= 0) return;
    this.faultQueue.push({ remaining: count, statusCode, matchPath, message });
  }

  public seedUsers(users: MockGitHubUser[], replace = false): void {
    if (replace) this.users = [];
    for (const user of users) {
      const idx = this.users.findIndex((u) => u.login.toLowerCase() === user.login.toLowerCase());
      if (idx >= 0) {
        this.users[idx] = { ...user };
      } else {
        this.users.push({ id: this.users.length + 1, ...user });
      }
    }
  }

  public seedPrs(prs: MockGitHubPr[], replace = false): void {
    if (replace) this.prs = [];
    for (const pr of prs) {
      const normalized: MockGitHubPr = {
        ...pr,
        html_url: pr.html_url || `https://github.com/workops/core/pull/${pr.number}`,
        repository_url: pr.repository_url || 'https://api.github.com/repos/workops/core',
        pull_request: pr.pull_request ?? { merged_at: null },
      };
      const idx = this.prs.findIndex((p) => p.id === normalized.id);
      if (idx >= 0) {
        this.prs[idx] = normalized;
      } else {
        this.prs.push(normalized);
      }
    }
  }

  public seedCommits(commits: MockGitHubCommit[], replace = false): void {
    if (replace) this.commits = [];
    for (const commit of commits) {
      const normalized: MockGitHubCommit = {
        ...commit,
        html_url: commit.html_url || `https://github.com/${commit.repo}/commit/${commit.sha}`,
      };
      const idx = this.commits.findIndex((c) => c.sha === normalized.sha && c.repo === normalized.repo);
      if (idx >= 0) {
        this.commits[idx] = normalized;
      } else {
        this.commits.push(normalized);
      }
    }
  }

  private sendJson(res: http.ServerResponse, statusCode: number, payload: unknown, headers?: Record<string, string>): void {
    const body = JSON.stringify(payload);
    res.writeHead(statusCode, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      ...headers,
    });
    res.end(body);
  }

  private checkFaults(pathname: string): { statusCode: number; message: string; headers?: Record<string, string> } | null {
    if (this.unavailable) {
      return {
        statusCode: this.unavailableStatus,
        message: `Mock GitHub upstream unavailable (${this.unavailableStatus})`,
      };
    }
    if (this.rateLimited) {
      const resetEpoch = Math.floor(Date.now() / 1000) + this.rateLimitResetSeconds;
      return {
        statusCode: 403,
        message: 'API rate limit exceeded',
        headers: {
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': String(resetEpoch),
        },
      };
    }
    for (let i = 0; i < this.faultQueue.length; i++) {
      const rule = this.faultQueue[i];
      if (rule.remaining <= 0) continue;
      const matches = !rule.matchPath
        ? true
        : typeof rule.matchPath === 'string'
          ? pathname.includes(rule.matchPath)
          : rule.matchPath.test(pathname);
      if (matches) {
        rule.remaining -= 1;
        if (rule.remaining <= 0) {
          this.faultQueue.splice(i, 1);
        }
        return {
          statusCode: rule.statusCode,
          message: rule.message || `Injected GitHub fault (${rule.statusCode})`,
        };
      }
    }
    return null;
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const rawUrl = req.url || '/';
    const parsedUrl = new URL(rawUrl, this.baseUrl || 'http://127.0.0.1');
    const pathname = parsedUrl.pathname;
    const method = (req.method || 'GET').toUpperCase();

    // Drain body if any
    for await (const _chunk of req) {
      // discard
    }

    const queryObj: Record<string, string> = {};
    parsedUrl.searchParams.forEach((v, k) => {
      queryObj[k] = v;
    });

    this.requests.push({
      method,
      path: pathname,
      query: queryObj,
      headers: { ...req.headers },
      timestamp: new Date().toISOString(),
    });

    const fault = this.checkFaults(pathname);
    if (fault) {
      this.sendJson(res, fault.statusCode, { message: fault.message }, fault.headers);
      return;
    }

    if (this.requireAuth && !req.headers.authorization) {
      this.sendJson(res, 401, { message: 'Requires authentication' });
      return;
    }

    // GET /user
    if (method === 'GET' && pathname === '/user') {
      const firstUser = this.users[0] || {
        id: 1,
        login: 'workops-bot',
        email: 'bot@workops.test',
        name: 'WorkOps Bot',
      };
      this.sendJson(res, 200, firstUser);
      return;
    }

    // GET /search/users
    if (method === 'GET' && pathname === '/search/users') {
      const q = parsedUrl.searchParams.get('q') || '';
      const cleaned = q
        .replace(/\bin:(email|login|name)\b/gi, '')
        .trim()
        .toLowerCase();

      const matched = this.users.filter((u) => {
        if (!cleaned) return true;
        return (
          u.email.toLowerCase().includes(cleaned) ||
          u.login.toLowerCase().includes(cleaned) ||
          (u.name && u.name.toLowerCase().includes(cleaned))
        );
      });

      this.sendJson(res, 200, {
        total_count: matched.length,
        incomplete_results: false,
        items: matched.map((u, idx) => ({
          id: u.id ?? idx + 1,
          login: u.login,
          email: u.email,
          name: u.name || u.login,
          html_url: `https://github.com/${u.login}`,
        })),
      });
      return;
    }

    // GET /search/commits
    if (method === 'GET' && pathname === '/search/commits') {
      const q = parsedUrl.searchParams.get('q') || '';
      const authorEmailMatch = q.match(/author-email:([^\s]+)/i);
      const authorMatch = q.match(/author:([^\s]+)/i);
      const emailTarget = authorEmailMatch ? authorEmailMatch[1].toLowerCase() : null;
      const loginTarget = authorMatch ? authorMatch[1].toLowerCase() : null;

      let matched = this.commits;
      if (emailTarget) {
        const userForEmail = this.users.find((u) => u.email.toLowerCase() === emailTarget);
        matched = matched.filter(
          (c) =>
            (c.authorEmail && c.authorEmail.toLowerCase() === emailTarget) ||
            (userForEmail && c.authorLogin.toLowerCase() === userForEmail.login.toLowerCase())
        );
      }
      if (loginTarget) {
        matched = matched.filter((c) => c.authorLogin.toLowerCase() === loginTarget);
      }

      this.sendJson(res, 200, {
        total_count: matched.length,
        incomplete_results: false,
        items: matched.map((c) => ({
          sha: c.sha,
          html_url: c.html_url,
          author: { login: c.authorLogin },
          committer: { login: c.authorLogin },
          commit: {
            message: c.message,
            author: {
              name: c.authorName || c.authorLogin,
              email: c.authorEmail || `${c.authorLogin}@workops.test`,
              date: c.authoredAt,
            },
          },
        })),
      });
      return;
    }

    // GET /search/issues
    if (method === 'GET' && pathname === '/search/issues') {
      const q = parsedUrl.searchParams.get('q') || '';
      const perPage = Math.max(1, Math.min(parseInt(parsedUrl.searchParams.get('per_page') || '30', 10) || 30, 100));
      const page = Math.max(1, parseInt(parsedUrl.searchParams.get('page') || '1', 10) || 1);

      const authorMatch = q.match(/author:([^\s]+)/i);
      const orgMatch = q.match(/org:([^\s]+)/i);
      const repoMatch = q.match(/repo:([^\s]+)/i);
      const createdMatch = q.match(/created:([^\s]+)/i);
      const updatedMatch = q.match(/updated:([^\s]+)/i);
      const isPrOnly = /\b(type:pr|is:pr)\b/i.test(q);

      let matched = isPrOnly || q.length > 0 ? [...this.prs] : [...this.prs];

      if (authorMatch) {
        const author = authorMatch[1].toLowerCase();
        matched = matched.filter((p) => p.authorLogin.toLowerCase() === author);
      }
      if (orgMatch) {
        const org = orgMatch[1].toLowerCase();
        matched = matched.filter((p) => {
          const parts = p.repository_url.replace(/\/+$/, '').split('/');
          const repoOrg = parts.length >= 2 ? parts[parts.length - 2].toLowerCase() : '';
          return repoOrg === org;
        });
      }
      if (repoMatch) {
        const repoSlug = repoMatch[1].toLowerCase();
        matched = matched.filter((p) => p.repository_url.toLowerCase().endsWith(`/${repoSlug}`));
      }
      if (createdMatch) {
        const range = this.parseDateRange(createdMatch[1]);
        matched = matched.filter((p) => this.inDateRange(p.created_at, range));
      }
      if (updatedMatch) {
        const range = this.parseDateRange(updatedMatch[1]);
        matched = matched.filter((p) => this.inDateRange(p.updated_at || p.created_at, range));
      }

      matched.sort((a, b) => b.created_at.localeCompare(a.created_at));
      const totalCount = matched.length;
      const start = (page - 1) * perPage;
      const sliced = matched.slice(start, start + perPage);

      this.sendJson(res, 200, {
        total_count: totalCount,
        incomplete_results: false,
        items: sliced.map((p) => ({
          id: p.id,
          number: p.number,
          title: p.title,
          html_url: p.html_url,
          state: p.state,
          created_at: p.created_at,
          updated_at: p.updated_at || p.created_at,
          closed_at: p.closed_at ?? null,
          pull_request: p.pull_request ?? { merged_at: null },
          body: p.body ?? null,
          repository_url: p.repository_url,
          user: { login: p.authorLogin },
        })),
      });
      return;
    }

    // GET /repos/:owner/:repo/commits
    const commitsMatch = pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/commits$/);
    if (method === 'GET' && commitsMatch) {
      const owner = decodeURIComponent(commitsMatch[1]);
      const repo = decodeURIComponent(commitsMatch[2]);
      const repoFull = `${owner}/${repo}`.toLowerCase();

      const author = (parsedUrl.searchParams.get('author') || '').trim().toLowerCase();
      const since = parsedUrl.searchParams.get('since') || '';
      const until = parsedUrl.searchParams.get('until') || '';
      const branch = (parsedUrl.searchParams.get('sha') || '').trim().toLowerCase();
      const perPage = Math.max(1, Math.min(parseInt(parsedUrl.searchParams.get('per_page') || '100', 10) || 100, 100));
      const page = Math.max(1, parseInt(parsedUrl.searchParams.get('page') || '1', 10) || 1);

      let matched = this.commits.filter((c) => c.repo.toLowerCase() === repoFull);
      if (author) {
        matched = matched.filter(
          (c) =>
            c.authorLogin.toLowerCase() === author ||
            (c.authorEmail && c.authorEmail.toLowerCase() === author)
        );
      }
      if (branch) {
        matched = matched.filter((c) => !c.branch || c.branch.toLowerCase() === branch);
      }
      if (since) {
        const sinceMs = Date.parse(since);
        if (Number.isFinite(sinceMs)) {
          matched = matched.filter((c) => Date.parse(c.authoredAt) >= sinceMs);
        }
      }
      if (until) {
        const untilMs = Date.parse(until);
        if (Number.isFinite(untilMs)) {
          matched = matched.filter((c) => Date.parse(c.authoredAt) <= untilMs);
        }
      }

      matched.sort((a, b) => b.authoredAt.localeCompare(a.authoredAt));
      const start = (page - 1) * perPage;
      const sliced = matched.slice(start, start + perPage);

      this.sendJson(
        res,
        200,
        sliced.map((c) => ({
          sha: c.sha,
          html_url: c.html_url,
          author: { login: c.authorLogin },
          commit: {
            message: c.message,
            author: {
              name: c.authorName || c.authorLogin,
              email: c.authorEmail || `${c.authorLogin}@workops.test`,
              date: c.authoredAt,
            },
          },
        }))
      );
      return;
    }

    // GET /repos/:owner/:repo/pulls
    const pullsMatch = pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/pulls$/);
    if (method === 'GET' && pullsMatch) {
      const owner = decodeURIComponent(pullsMatch[1]);
      const repo = decodeURIComponent(pullsMatch[2]);
      const repoSuffix = `/${owner}/${repo}`.toLowerCase();
      const stateFilter = (parsedUrl.searchParams.get('state') || 'open').toLowerCase();

      let matched = this.prs.filter((p) => p.repository_url.toLowerCase().endsWith(repoSuffix));
      if (stateFilter !== 'all') {
        matched = matched.filter((p) => p.state.toLowerCase() === stateFilter);
      }

      this.sendJson(
        res,
        200,
        matched.map((p) => ({
          id: p.id,
          number: p.number,
          title: p.title,
          html_url: p.html_url,
          state: p.state,
          created_at: p.created_at,
          updated_at: p.updated_at || p.created_at,
          closed_at: p.closed_at ?? null,
          merged_at: p.pull_request?.merged_at ?? null,
          body: p.body ?? null,
          user: { login: p.authorLogin },
        }))
      );
      return;
    }

    this.sendJson(res, 404, { message: `Unhandled GitHub route: ${method} ${pathname}` });
  }

  private parseDateRange(expr: string): { from?: number; to?: number } {
    const parts = expr.split('..');
    if (parts.length === 2) {
      const fromStr = parts[0].trim();
      const toStr = parts[1].trim();
      const from = fromStr && fromStr !== '*' ? Date.parse(fromStr.length === 10 ? `${fromStr}T00:00:00.000Z` : fromStr) : undefined;
      const to = toStr && toStr !== '*' ? Date.parse(toStr.length === 10 ? `${toStr}T23:59:59.999Z` : toStr) : undefined;
      return {
        from: from !== undefined && Number.isFinite(from) ? from : undefined,
        to: to !== undefined && Number.isFinite(to) ? to : undefined,
      };
    }
    const single = Date.parse(expr.length === 10 ? `${expr}T00:00:00.000Z` : expr);
    if (!Number.isFinite(single)) return {};
    return { from: single, to: single + 86_400_000 - 1 };
  }

  private inDateRange(isoDate: string, range: { from?: number; to?: number }): boolean {
    const ts = Date.parse(isoDate);
    if (!Number.isFinite(ts)) return false;
    if (range.from !== undefined && ts < range.from) return false;
    if (range.to !== undefined && ts > range.to) return false;
    return true;
  }
}
