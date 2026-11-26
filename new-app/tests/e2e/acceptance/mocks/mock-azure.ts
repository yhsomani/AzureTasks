import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface MockWorkItemRelation {
  rel: string;
  url: string;
  attributes?: Record<string, unknown>;
}

export interface MockWorkItem {
  id: number;
  rev: number;
  fields: Record<string, unknown>;
  relations?: MockWorkItemRelation[];
  url: string;
}

export interface MockIdentity {
  id: string;
  displayName: string;
  uniqueName: string;
  email?: string;
  descriptor?: string;
  subjectDescriptor?: string;
  isActive?: boolean;
}

export interface AzureRequestRecord {
  method: string;
  path: string;
  query: Record<string, string>;
  body: unknown;
  headers: Record<string, string | string[] | undefined>;
  timestamp: string;
}

export interface JsonPatchOperation {
  op: 'add' | 'replace' | 'remove' | 'test';
  path: string;
  value?: unknown;
}

interface FaultRule {
  remaining: number;
  statusCode: number;
  matchPath?: string | RegExp;
  message?: string;
}

export interface MockAzureSeedOptions {
  organization?: string;
  projects?: Array<{ name: string; id?: string; workItemTypes?: string[] }>;
  workItems?: Array<Partial<MockWorkItem> & { id: number; fields: Record<string, unknown> }>;
  identities?: MockIdentity[];
}

export class MockAzureServer {
  private server: http.Server | null = null;
  private baseUrl = '';
  private organization = 'test-org';
  private projects = new Map<string, { id: string; name: string; workItemTypes: Set<string> }>();
  private workItems = new Map<number, MockWorkItem>();
  private identities = new Map<string, MockIdentity>();
  private requests: AzureRequestRecord[] = [];
  private nextWorkItemId = 1000;
  private unavailable = false;
  private unavailableStatus = 503;
  private faultQueue: FaultRule[] = [];
  private initialSeed: MockAzureSeedOptions;

  constructor(seed: MockAzureSeedOptions = {}) {
    this.initialSeed = seed;
    this.applySeed(seed);
  }

  private applySeed(seed: MockAzureSeedOptions): void {
    this.organization = seed.organization || 'test-org';
    this.projects.clear();
    this.workItems.clear();
    this.identities.clear();
    this.nextWorkItemId = 1000;

    const defaultProjects = seed.projects ?? [
      { name: 'TestProject', id: 'proj-test-01', workItemTypes: ['Task', '3in1 Task', 'User Story', 'Bug'] },
      { name: '3in1_Agile_Projects', id: 'proj-agile-01', workItemTypes: ['Task', '3in1 Task', 'User Story', 'Bug'] },
    ];

    for (const p of defaultProjects) {
      this.seedProject(p.name, p.workItemTypes ?? ['Task', '3in1 Task', 'User Story', 'Bug'], p.id);
    }

    if (seed.workItems) {
      for (const item of seed.workItems) {
        this.seedWorkItem(item);
      }
    }

    if (seed.identities) {
      for (const identity of seed.identities) {
        this.seedIdentity(identity);
      }
    }
  }

  public async start(): Promise<string> {
    if (this.server) {
      return this.baseUrl;
    }

    this.server = http.createServer((req, res) => {
      void this.handleRequest(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(0, '127.0.0.1', () => {
        resolve();
      });
    });

    const address = this.server.address() as AddressInfo;
    this.baseUrl = `http://127.0.0.1:${address.port}`;
    this.refreshWorkItemUrls();
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

  public reset(newSeed?: MockAzureSeedOptions): void {
    this.requests = [];
    this.unavailable = false;
    this.unavailableStatus = 503;
    this.faultQueue = [];
    this.applySeed(newSeed ?? this.initialSeed);
    this.refreshWorkItemUrls();
  }

  public getRequests(): AzureRequestRecord[] {
    return [...this.requests];
  }

  public clearRequests(): void {
    this.requests = [];
  }

  public setUnavailable(unavailable: boolean, statusCode = 503): void {
    this.unavailable = unavailable;
    this.unavailableStatus = statusCode;
  }

  public failNext(count: number, statusCode = 500, matchPath?: string | RegExp, message?: string): void {
    if (count <= 0) return;
    this.faultQueue.push({
      remaining: count,
      statusCode,
      matchPath,
      message,
    });
  }

  public seedProject(name: string, workItemTypes: string[] = ['Task', '3in1 Task', 'User Story', 'Bug'], id?: string): void {
    this.projects.set(name.toLowerCase(), {
      id: id || `proj-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      name,
      workItemTypes: new Set(workItemTypes),
    });
  }

  public seedWorkItem(item: Partial<MockWorkItem> & { id: number; fields: Record<string, unknown> }): MockWorkItem {
    const project = String(item.fields['System.TeamProject'] || 'TestProject');
    const urlBase = this.baseUrl || 'http://127.0.0.1';
    const stored: MockWorkItem = {
      id: item.id,
      rev: item.rev ?? 1,
      fields: {
        'System.TeamProject': project,
        'System.WorkItemType': 'Task',
        'System.State': 'New',
        'System.CreatedDate': new Date().toISOString(),
        ...item.fields,
      },
      relations: item.relations ? item.relations.map((r) => ({ ...r })) : [],
      url: item.url || `${urlBase}/${this.organization}/_apis/wit/workItems/${item.id}`,
    };
    this.workItems.set(stored.id, stored);
    if (stored.id >= this.nextWorkItemId) {
      this.nextWorkItemId = stored.id + 1;
    }
    return stored;
  }

  public getWorkItem(id: number): MockWorkItem | undefined {
    return this.workItems.get(id);
  }

  public listWorkItems(): MockWorkItem[] {
    return Array.from(this.workItems.values());
  }

  public seedIdentity(identity: MockIdentity): void {
    this.identities.set(identity.id.toLowerCase(), {
      isActive: true,
      ...identity,
    });
  }

  private refreshWorkItemUrls(): void {
    if (!this.baseUrl) return;
    for (const item of this.workItems.values()) {
      item.url = `${this.baseUrl}/${this.organization}/_apis/wit/workItems/${item.id}`;
    }
  }

  private async readBody(req: http.IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf8');
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

  private checkFaults(pathname: string): { statusCode: number; message: string } | null {
    if (this.unavailable) {
      return {
        statusCode: this.unavailableStatus,
        message: `Mock Azure DevOps service unavailable (${this.unavailableStatus})`,
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
          message: rule.message || `Injected Azure DevOps fault (${rule.statusCode})`,
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
    const rawBody = await this.readBody(req);

    let parsedBody: unknown = undefined;
    if (rawBody.trim().length > 0) {
      try {
        parsedBody = JSON.parse(rawBody);
      } catch {
        parsedBody = rawBody;
      }
    }

    const queryObj: Record<string, string> = {};
    parsedUrl.searchParams.forEach((value, key) => {
      queryObj[key] = value;
    });

    this.requests.push({
      method,
      path: pathname,
      query: queryObj,
      body: parsedBody,
      headers: { ...req.headers },
      timestamp: new Date().toISOString(),
    });

    const fault = this.checkFaults(pathname);
    if (fault) {
      const extraHeaders = fault.statusCode === 429 ? { 'Retry-After': '0' } : undefined;
      this.sendJson(res, fault.statusCode, { message: fault.message }, extraHeaders);
      return;
    }

    const segments = pathname.split('/').filter(Boolean).map((s) => decodeURIComponent(s));
    const apisIndex = segments.findIndex((s) => s.toLowerCase() === '_apis');
    if (apisIndex === -1) {
      this.sendJson(res, 404, { message: `Unknown Azure DevOps endpoint: ${pathname}` });
      return;
    }

    const prefixSegments = segments.slice(0, apisIndex);
    const apiSegments = segments.slice(apisIndex + 1);
    const projectSegment = this.extractProjectFromPrefix(prefixSegments);

    // GET /_apis/projects or /_apis/projects/:project
    if (method === 'GET' && apiSegments[0] === 'projects') {
      if (apiSegments.length === 1) {
        const list = Array.from(this.projects.values()).map((p) => ({
          id: p.id,
          name: p.name,
          state: 'wellFormed',
          url: `${this.baseUrl}/${this.organization}/_apis/projects/${encodeURIComponent(p.name)}`,
        }));
        this.sendJson(res, 200, { count: list.length, value: list });
        return;
      }
      const projName = apiSegments[1];
      const proj = this.projects.get(projName.toLowerCase());
      if (!proj) {
        this.sendJson(res, 404, { message: `Project '${projName}' does not exist.` });
        return;
      }
      this.sendJson(res, 200, {
        id: proj.id,
        name: proj.name,
        state: 'wellFormed',
        url: `${this.baseUrl}/${this.organization}/_apis/projects/${encodeURIComponent(proj.name)}`,
      });
      return;
    }

    // GET /_apis/identities
    if (method === 'GET' && apiSegments[0] === 'identities') {
      const searchFilter = (parsedUrl.searchParams.get('filterValue') || parsedUrl.searchParams.get('searchFilter') || '').trim().toLowerCase();
      const identityIdsParam = parsedUrl.searchParams.get('identityIds') || '';
      const idFilterSet = new Set(
        identityIdsParam.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
      );

      let results = Array.from(this.identities.values());
      if (idFilterSet.size > 0) {
        results = results.filter((id) => idFilterSet.has(id.id.toLowerCase()));
      } else if (searchFilter) {
        results = results.filter((id) =>
          id.displayName.toLowerCase().includes(searchFilter) ||
          id.uniqueName.toLowerCase().includes(searchFilter) ||
          (id.email && id.email.toLowerCase().includes(searchFilter)) ||
          (id.descriptor && id.descriptor.toLowerCase().includes(searchFilter))
        );
      }

      this.sendJson(res, 200, {
        count: results.length,
        value: results.map((id) => ({
          id: id.id,
          descriptor: id.descriptor || `aad.${Buffer.from(id.uniqueName).toString('base64url')}`,
          subjectDescriptor: id.subjectDescriptor || id.descriptor || `aad.${Buffer.from(id.uniqueName).toString('base64url')}`,
          providerDisplayName: id.displayName,
          customDisplayName: id.displayName,
          isActive: id.isActive ?? true,
          properties: {
            Account: { $value: id.uniqueName },
            Mail: { $value: id.email || id.uniqueName },
          },
        })),
      });
      return;
    }

    // Work item tracking routes: /_apis/wit/...
    if (apiSegments[0] === 'wit') {
      // GET /:project/_apis/wit/workitemtypes/:type
      if (method === 'GET' && apiSegments[1] === 'workitemtypes' && apiSegments[2]) {
        const typeName = apiSegments[2];
        const proj = projectSegment ? this.projects.get(projectSegment.toLowerCase()) : undefined;
        if (projectSegment && !proj) {
          this.sendJson(res, 404, { message: `Project '${projectSegment}' not found.` });
          return;
        }
        const allowed = proj ? proj.workItemTypes : new Set(['Task', '3in1 Task', 'User Story', 'Bug']);
        const matchedType = Array.from(allowed).find((t) => t.toLowerCase() === typeName.toLowerCase());
        if (!matchedType) {
          this.sendJson(res, 404, { message: `Work item type '${typeName}' not found.` });
          return;
        }
        this.sendJson(res, 200, {
          name: matchedType,
          referenceName: `System.${matchedType.replace(/\s+/g, '')}`,
          description: `Mock work item type ${matchedType}`,
        });
        return;
      }

      // POST /:project/_apis/wit/wiql
      if (method === 'POST' && apiSegments[1] === 'wiql') {
        const body = (parsedBody && typeof parsedBody === 'object' ? parsedBody : {}) as { query?: string };
        const wiqlQuery = typeof body.query === 'string' ? body.query : '';
        const matched = this.executeWiql(wiqlQuery, projectSegment);
        this.sendJson(res, 200, {
          queryType: 'flat',
          asOf: new Date().toISOString(),
          workItems: matched.map((item) => ({ id: item.id, url: item.url })),
        });
        return;
      }

      // GET /_apis/wit/workitems?ids=1,2,3&$expand=relations
      if (method === 'GET' && apiSegments[1] === 'workitems' && apiSegments.length === 2) {
        const idsParam = parsedUrl.searchParams.get('ids') || '';
        const expand = (parsedUrl.searchParams.get('$expand') || '').toLowerCase();
        const includeRelations = expand === 'relations' || expand === 'all';
        const ids = idsParam
          .split(',')
          .map((s) => parseInt(s.trim(), 10))
          .filter((n) => Number.isFinite(n));

        const items = ids
          .map((id) => this.workItems.get(id))
          .filter((item): item is MockWorkItem => Boolean(item))
          .map((item) => this.formatWorkItem(item, includeRelations));

        this.sendJson(res, 200, { count: items.length, value: items });
        return;
      }

      // GET /_apis/wit/workitems/:id
      if (method === 'GET' && apiSegments[1] === 'workitems' && apiSegments[2] && !apiSegments[2].startsWith('$')) {
        const id = parseInt(apiSegments[2], 10);
        const item = Number.isFinite(id) ? this.workItems.get(id) : undefined;
        if (!item) {
          this.sendJson(res, 404, { message: `Work item ${apiSegments[2]} not found.` });
          return;
        }
        const expand = (parsedUrl.searchParams.get('$expand') || '').toLowerCase();
        const includeRelations = expand !== 'none';
        this.sendJson(res, 200, this.formatWorkItem(item, includeRelations));
        return;
      }

      // POST /:project/_apis/wit/workitems/$:type
      if (method === 'POST' && apiSegments[1] === 'workitems' && apiSegments[2]?.startsWith('$')) {
        const workItemType = apiSegments[2].slice(1);
        const patchOps = Array.isArray(parsedBody) ? (parsedBody as JsonPatchOperation[]) : [];
        const newId = this.nextWorkItemId++;
        const nowIso = new Date().toISOString();
        const item: MockWorkItem = {
          id: newId,
          rev: 1,
          fields: {
            'System.TeamProject': projectSegment || 'TestProject',
            'System.WorkItemType': workItemType,
            'System.State': 'New',
            'System.CreatedDate': nowIso,
            'System.ChangedDate': nowIso,
          },
          relations: [],
          url: `${this.baseUrl}/${this.organization}/_apis/wit/workItems/${newId}`,
        };
        this.applyPatchOps(item, patchOps);
        this.workItems.set(item.id, item);
        this.sendJson(res, 200, this.formatWorkItem(item, true));
        return;
      }

      // PATCH /_apis/wit/workitems/:id
      if (method === 'PATCH' && apiSegments[1] === 'workitems' && apiSegments[2]) {
        const id = parseInt(apiSegments[2], 10);
        const item = Number.isFinite(id) ? this.workItems.get(id) : undefined;
        if (!item) {
          this.sendJson(res, 404, { message: `Work item ${apiSegments[2]} not found.` });
          return;
        }
        const patchOps = Array.isArray(parsedBody) ? (parsedBody as JsonPatchOperation[]) : [];
        if (parsedUrl.searchParams.get('validateOnly') === 'true') {
          const preview = structuredClone(item);
          this.applyPatchOps(preview, patchOps);
          this.sendJson(res, 200, this.formatWorkItem(preview, true));
          return;
        }
        this.applyPatchOps(item, patchOps);
        item.rev += 1;
        item.fields['System.ChangedDate'] = new Date().toISOString();
        this.sendJson(res, 200, this.formatWorkItem(item, true));
        return;
      }
    }

    this.sendJson(res, 404, { message: `Unhandled Azure DevOps route: ${method} ${pathname}` });
  }

  private extractProjectFromPrefix(prefixSegments: string[]): string | undefined {
    if (prefixSegments.length === 0) return undefined;
    if (prefixSegments.length === 1) {
      const seg = prefixSegments[0];
      if (seg.toLowerCase() === this.organization.toLowerCase()) return undefined;
      return seg;
    }
    return prefixSegments[prefixSegments.length - 1];
  }

  private formatWorkItem(item: MockWorkItem, includeRelations: boolean): MockWorkItem {
    return {
      id: item.id,
      rev: item.rev,
      fields: { ...item.fields },
      ...(includeRelations ? { relations: (item.relations || []).map((r) => ({ ...r })) } : {}),
      url: item.url,
    };
  }

  private applyPatchOps(item: MockWorkItem, ops: JsonPatchOperation[]): void {
    for (const op of ops) {
      if (!op || typeof op.path !== 'string') continue;
      if (op.path.startsWith('/fields/')) {
        const fieldName = op.path.slice('/fields/'.length);
        if (op.op === 'remove') {
          delete item.fields[fieldName];
        } else {
          item.fields[fieldName] = op.value;
        }
      } else if (op.path === '/relations/-' && op.op === 'add') {
        if (!item.relations) item.relations = [];
        if (op.value && typeof op.value === 'object') {
          const rel = op.value as MockWorkItemRelation;
          item.relations.push({
            rel: rel.rel,
            url: rel.url,
            ...(rel.attributes ? { attributes: { ...rel.attributes } } : {}),
          });
        }
      } else if (op.path.startsWith('/relations/') && op.op === 'remove') {
        const idx = parseInt(op.path.slice('/relations/'.length), 10);
        if (item.relations && Number.isFinite(idx) && idx >= 0 && idx < item.relations.length) {
          item.relations.splice(idx, 1);
        }
      }
    }
  }

  private executeWiql(wiqlQuery: string, routeProject?: string): MockWorkItem[] {
    const query = wiqlQuery || '';
    const projectMatch = query.match(/\[System\.TeamProject\]\s*=\s*'((?:''|[^'])*)'/i);
    const targetProject = projectMatch ? this.unescapeWiql(projectMatch[1]) : routeProject;

    const typeMatch = query.match(/\[System\.WorkItemType\]\s*=\s*'((?:''|[^'])*)'/i);
    const targetType = typeMatch ? this.unescapeWiql(typeMatch[1]) : undefined;

    const excludeRemoved = /\[System\.State\]\s*<>\s*'Removed'/i.test(query);
    const stateEqMatch = query.match(/\[System\.State\]\s*=\s*'((?:''|[^'])*)'/i);
    const stateNeqMatch = query.match(/\[System\.State\]\s*<>\s*'((?:''|[^'])*)'/i);

    const assignedInMatch = query.match(/\[System\.AssignedTo\]\s+IN\s*\(([^)]+)\)/i);
    const assignedInList = assignedInMatch
      ? this.parseWiqlStringList(assignedInMatch[1]).map((v) => v.toLowerCase())
      : null;

    const assignedContainsMatch = query.match(/\[System\.AssignedTo\]\s+CONTAINS\s+'((?:''|[^'])*)'/i);
    const assignedContains = assignedContainsMatch ? this.unescapeWiql(assignedContainsMatch[1]).toLowerCase() : null;

    const assignedIsEmpty =
      /\[System\.AssignedTo\]\s+IS\s+EMPTY/i.test(query) ||
      /\[System\.AssignedTo\]\s*=\s*''/i.test(query);

    const titleContainsMatch = query.match(/\[System\.Title\]\s+CONTAINS\s+'((?:''|[^'])*)'/i);
    const titleContains = titleContainsMatch ? this.unescapeWiql(titleContainsMatch[1]).toLowerCase() : null;

    const titleEqMatch = query.match(/\[System\.Title\]\s*=\s*'((?:''|[^'])*)'/i);
    const titleEq = titleEqMatch ? this.unescapeWiql(titleEqMatch[1]).toLowerCase() : null;

    let candidates = Array.from(this.workItems.values());

    if (targetProject) {
      candidates = candidates.filter(
        (item) => String(item.fields['System.TeamProject'] || '').toLowerCase() === targetProject.toLowerCase()
      );
    }

    if (targetType) {
      candidates = candidates.filter(
        (item) => String(item.fields['System.WorkItemType'] || '').toLowerCase() === targetType.toLowerCase()
      );
    }

    if (excludeRemoved) {
      candidates = candidates.filter(
        (item) => String(item.fields['System.State'] || '').toLowerCase() !== 'removed'
      );
    } else if (stateNeqMatch) {
      const excluded = this.unescapeWiql(stateNeqMatch[1]).toLowerCase();
      candidates = candidates.filter(
        (item) => String(item.fields['System.State'] || '').toLowerCase() !== excluded
      );
    }

    if (stateEqMatch) {
      const required = this.unescapeWiql(stateEqMatch[1]).toLowerCase();
      candidates = candidates.filter(
        (item) => String(item.fields['System.State'] || '').toLowerCase() === required
      );
    }

    if (assignedIsEmpty) {
      candidates = candidates.filter((item) => this.extractAssignedTokens(item.fields['System.AssignedTo']).length === 0);
    } else if (assignedInList && assignedInList.length > 0) {
      candidates = candidates.filter((item) => {
        const tokens = this.extractAssignedTokens(item.fields['System.AssignedTo']);
        return tokens.some((token) => assignedInList.includes(token));
      });
    } else if (assignedContains) {
      candidates = candidates.filter((item) => {
        const tokens = this.extractAssignedTokens(item.fields['System.AssignedTo']);
        return tokens.some((token) => token.includes(assignedContains));
      });
    }

    if (titleContains) {
      candidates = candidates.filter((item) =>
        String(item.fields['System.Title'] || '').toLowerCase().includes(titleContains)
      );
    }

    if (titleEq) {
      candidates = candidates.filter((item) =>
        String(item.fields['System.Title'] || '').toLowerCase() === titleEq
      );
    }

    candidates.sort((a, b) => {
      const createdB = String(b.fields['System.CreatedDate'] || '');
      const createdA = String(a.fields['System.CreatedDate'] || '');
      const cmp = createdB.localeCompare(createdA);
      return cmp !== 0 ? cmp : b.id - a.id;
    });

    return candidates;
  }

  private extractAssignedTokens(raw: unknown): string[] {
    if (!raw) return [];
    const tokens = new Set<string>();
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (!trimmed) return [];
      tokens.add(trimmed.toLowerCase());
      const angle = trimmed.match(/<([^>]+)>/);
      if (angle) {
        tokens.add(angle[1].trim().toLowerCase());
        const display = trimmed.replace(/<[^>]+>/, '').trim();
        if (display) tokens.add(display.toLowerCase());
      }
      return Array.from(tokens);
    }
    if (typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;
      for (const key of ['uniqueName', 'displayName', 'email', 'mail', 'mailAddress', 'id', 'descriptor', 'subjectDescriptor']) {
        const val = obj[key];
        if (typeof val === 'string' && val.trim()) {
          tokens.add(val.trim().toLowerCase());
        }
      }
    }
    return Array.from(tokens);
  }

  private parseWiqlStringList(raw: string): string[] {
    const values: string[] = [];
    const regex = /'((?:''|[^'])*)'/g;
    let match: RegExpExecArray | null = null;
    while ((match = regex.exec(raw)) !== null) {
      values.push(this.unescapeWiql(match[1]));
    }
    return values;
  }

  private unescapeWiql(val: string): string {
    return val.replace(/''/g, "'");
  }
}
