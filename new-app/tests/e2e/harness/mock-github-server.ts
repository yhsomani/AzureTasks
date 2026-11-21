import http from 'node:http';
import { AddressInfo } from 'node:net';
import { MockGitHubPR, MockGitHubCommit, SEED_PRS, SEED_COMMITS } from './fixtures/github-prs.js';

export interface GitHubRequestLogEntry {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  timestamp: number;
}

export class MockGitHubServer {
  private server: http.Server | null = null;
  private port: number = 0;
  private users: Map<string, string> = new Map(); // email -> login
  private prs: MockGitHubPR[] = [];
  private commits: MockGitHubCommit[] = [];
  private incompleteResults: boolean = false;
  private requestLog: GitHubRequestLogEntry[] = [];
  private activeFault: { type: '401' | '403' | '429' | '500'; count: number; retryAfterSec?: number } | null = null;

  constructor() {
    this.reset();
  }

  public reset(): void {
    this.users.clear();
    this.users.set('dev1@workops.test', 'dev1-workops');
    this.users.set('dev2@workops.test', 'dev2-workops');
    this.users.set('admin@workops.test', 'admin-workops');
    this.prs = JSON.parse(JSON.stringify(SEED_PRS));
    this.commits = JSON.parse(JSON.stringify(SEED_COMMITS));
    this.incompleteResults = false;
    this.requestLog = [];
    this.activeFault = null;
  }

  public seedUsers(users: Array<{ email: string; username: string }>): void {
    for (const u of users) {
      this.users.set(u.email.toLowerCase(), u.username);
    }
  }

  public seedPullRequests(prs: Array<Partial<MockGitHubPR>>): void {
    let nextId = 600;
    for (const pr of prs) {
      const id = pr.id ?? nextId++;
      this.prs.push({
        id,
        number: pr.number ?? id,
        title: pr.title ?? `PR #${id}`,
        state: pr.state ?? 'closed',
        merged_at: pr.merged_at ?? '2026-10-14T16:00:00Z',
        created_at: pr.created_at ?? '2026-10-14T09:00:00Z',
        updated_at: pr.updated_at ?? '2026-10-14T16:00:00Z',
        closed_at: pr.closed_at ?? '2026-10-14T16:00:00Z',
        html_url: pr.html_url ?? `https://github.com/workops/core/pull/${id}`,
        user: pr.user ?? { login: 'dev1-workops', id: 9001 },
        author_email: pr.author_email,
      });
    }
  }

  public seedCommits(commits: Array<Partial<MockGitHubCommit>>): void {
    for (const c of commits) {
      this.commits.push({
        sha: c.sha ?? `sha-${Math.random().toString(16).substring(2, 10)}`,
        commit: {
          author: {
            name: c.commit?.author?.name ?? 'Test Author',
            email: c.commit?.author?.email ?? 'dev1@workops.test',
            date: c.commit?.author?.date ?? new Date().toISOString(),
          },
          message: c.commit?.message ?? 'test commit',
        },
        author: c.author ?? { login: 'dev1-workops' },
      });
    }
  }

  public setIncompleteResults(flag: boolean): void {
    this.incompleteResults = flag;
  }

  public setFault(type: '401' | '403' | '429' | '500', count = 1, retryAfterSec = 2): void {
    this.activeFault = { type, count, retryAfterSec };
  }

  public clearFault(): void {
    this.activeFault = null;
  }

  public getRequestLog(): GitHubRequestLogEntry[] {
    return [...this.requestLog];
  }

  public async start(): Promise<string> {
    if (this.server) {
      return `http://127.0.0.1:${this.port}`;
    }

    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        try {
          await this.handleRequest(req, res);
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ message: err?.message || 'Mock GitHub error' }));
        }
      });

      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server!.address() as AddressInfo;
        this.port = addr.port;
        resolve(`http://127.0.0.1:${this.port}`);
      });

      this.server.on('error', reject);
    });
  }

  public async stop(): Promise<void> {
    if (!this.server) return;
    return new Promise((resolve, reject) => {
      this.server!.close((err) => {
        this.server = null;
        if (err) reject(err);
        else resolve();
      });
    });
  }

  public getBaseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const rawUrl = req.url || '/';
    const method = req.method?.toUpperCase() || 'GET';

    this.requestLog.push({
      method,
      url: rawUrl,
      headers: req.headers,
      timestamp: Date.now(),
    });

    if (this.activeFault && this.activeFault.count > 0) {
      this.activeFault.count--;
      const { type, retryAfterSec } = this.activeFault;
      if (type === '401') {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Bad credentials' }));
        return;
      }
      if (type === '403') {
        res.writeHead(403, {
          'Content-Type': 'application/json',
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 60),
        });
        res.end(JSON.stringify({ message: 'API rate limit exceeded' }));
        return;
      }
      if (type === '429') {
        res.writeHead(429, {
          'Content-Type': 'application/json',
          'Retry-After': String(retryAfterSec || 2),
        });
        res.end(JSON.stringify({ message: 'Too many requests' }));
        return;
      }
      if (type === '500') {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Internal Server Error' }));
        return;
      }
    }

    const urlObj = new URL(rawUrl, `http://127.0.0.1:${this.port}`);
    const pathname = urlObj.pathname;

    // Search users: GET /search/users?q=...
    if (pathname === '/search/users') {
      const q = urlObj.searchParams.get('q') || '';
      const emailMatch = q.match(/([^\s+]+)[\s+]+in:email/i) || q.match(/([^\s+]+@[^\s+]+)/i);
      const email = emailMatch ? emailMatch[1].toLowerCase() : q.trim().toLowerCase();
      const login = this.users.get(email);

      const items = login
        ? [{ login, id: 10001, node_id: 'MDQ6VXNlcjEwMDAx', type: 'User' }]
        : [];

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        total_count: items.length,
        incomplete_results: this.incompleteResults,
        items,
      }));
      return;
    }

    // Search commits: GET /search/commits?q=...
    if (pathname === '/search/commits') {
      const q = urlObj.searchParams.get('q') || '';
      let filtered = [...this.commits];
      const authorEmailMatch = q.match(/author-email:([^\s]+)/i);
      if (authorEmailMatch) {
        const email = authorEmailMatch[1].toLowerCase();
        filtered = filtered.filter((c) => c.commit.author.email.toLowerCase() === email);
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        total_count: filtered.length,
        incomplete_results: this.incompleteResults,
        items: filtered,
      }));
      return;
    }

    // Search issues / PRs: GET /search/issues?q=...
    if (pathname === '/search/issues') {
      const q = urlObj.searchParams.get('q') || '';
      let filtered = [...this.prs];

      const authorMatch = q.match(/author:([^\s]+)/i);
      if (authorMatch) {
        const author = authorMatch[1].toLowerCase();
        filtered = filtered.filter((pr) => pr.user.login.toLowerCase() === author);
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        total_count: filtered.length,
        incomplete_results: this.incompleteResults,
        items: filtered,
      }));
      return;
    }

    // Repos commits: GET /repos/:owner/:repo/commits
    if (pathname.includes('/commits') && !pathname.startsWith('/search/')) {
      const author = urlObj.searchParams.get('author');
      let filtered = [...this.commits];
      if (author) {
        filtered = filtered.filter((c) => c.author?.login.toLowerCase() === author.toLowerCase());
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(filtered));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Mock GitHub Server OK', path: pathname }));
  }
}
