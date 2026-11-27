/**
 * Type-Safe HTTP API Client for WorkOps SPA
 */

import type {
  AzureOverviewResponse,
  AzureBuildHealthResponse,
  AzurePipelineRunsResponse,
  AzureReleasesResponse,
  AzureTestHealthResponse,
  AzureTeamsResponse,
  AzureUnassignedResponse,
  AzureProjectsResponse,
  WorkItemTask,
} from '../types/index.js';

export interface RequestOptions extends RequestInit {
  timeoutMs?: number;
  skipCache?: boolean;
}

interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  [key: string]: unknown;
}

const cache = new Map<string, { timestamp: number; data: unknown }>();
const CACHE_TTL_MS = 10_000;

export async function apiRequest<T = unknown>(
  url: string,
  options: RequestOptions = {}
): Promise<T> {
  const method = options.method?.toUpperCase() || 'GET';
  const isGet = method === 'GET';

  // SWR Cache for GET requests
  if (isGet && !options.skipCache) {
    const cached = cache.get(url);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.data as T;
    }
  }

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs || 25_000;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers = new Headers(options.headers || {});
    if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
      headers.set('Content-Type', 'application/json');
    }
    headers.set('Accept', 'application/json');

    const response = await fetch(url, {
      ...options,
      signal: options.signal || controller.signal,
      headers,
    });

    clearTimeout(timeoutId);

    if (response.status === 401) {
      throw new Error('Authentication required. Please check your credentials.');
    }
    if (response.status === 403) {
      throw new Error('Access denied. You do not have permission for this action.');
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return (await response.text()) as unknown as T;
    }

    const json = (await response.json()) as ApiResponse<T>;

    if (!response.ok || json.success === false) {
      throw new Error(json.error || json.message || `Request failed with status ${response.status}`);
    }

    const resultData = (json.data !== undefined ? json.data : json) as T;

    if (isGet) {
      cache.set(url, { timestamp: Date.now(), data: resultData });
    }

    return resultData;
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms.`);
    }
    if (err instanceof Error) {
      throw err;
    }
    throw new Error('An unexpected network error occurred.');
  }
}

export const api = {
  get: <T = unknown>(url: string, options?: RequestOptions) =>
    apiRequest<T>(url, { ...options, method: 'GET' }),
  post: <T = unknown>(url: string, body?: unknown, options?: RequestOptions) =>
    apiRequest<T>(url, {
      ...options,
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  put: <T = unknown>(url: string, body?: unknown, options?: RequestOptions) =>
    apiRequest<T>(url, {
      ...options,
      method: 'PUT',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  delete: <T = unknown>(url: string, options?: RequestOptions) =>
    apiRequest<T>(url, { ...options, method: 'DELETE' }),
  getMemberTasks: (personKey: string, options?: RequestOptions) =>
    apiRequest<{ tasks: WorkItemTask[] }>(
      `/api/tasks/member?personKey=${encodeURIComponent(personKey)}`,
      { ...options, method: 'GET' }
    ),
  invalidateCache: (pattern?: string) => {
    if (!pattern) {
      cache.clear();
      return;
    }
    for (const key of cache.keys()) {
      if (key.includes(pattern)) {
        cache.delete(key);
      }
    }
  },
  azureData: null as unknown as typeof azureDataApi,
};

export const azureDataApi = {
  getOverview: (options?: RequestOptions) =>
    api.get<AzureOverviewResponse>('/api/azure-data/overview', options),

  getBuildHealth: (params?: { projectId?: string; limit?: number }, options?: RequestOptions) => {
    const q = new URLSearchParams();
    if (params?.projectId) q.set('projectId', params.projectId);
    if (params?.limit !== undefined) q.set('limit', String(params.limit));
    const qs = q.toString();
    return api.get<AzureBuildHealthResponse>(`/api/azure-data/builds/health${qs ? `?${qs}` : ''}`, options);
  },

  getPipelineRuns: (params?: { projectId?: string; limit?: number }, options?: RequestOptions) => {
    const q = new URLSearchParams();
    if (params?.projectId) q.set('projectId', params.projectId);
    if (params?.limit !== undefined) q.set('limit', String(params.limit));
    const qs = q.toString();
    return api.get<AzurePipelineRunsResponse>(`/api/azure-data/pipelines/runs${qs ? `?${qs}` : ''}`, options);
  },

  getReleases: (params?: { projectId?: string; limit?: number }, options?: RequestOptions) => {
    const q = new URLSearchParams();
    if (params?.projectId) q.set('projectId', params.projectId);
    if (params?.limit !== undefined) q.set('limit', String(params.limit));
    const qs = q.toString();
    return api.get<AzureReleasesResponse>(`/api/azure-data/releases${qs ? `?${qs}` : ''}`, options);
  },

  getTestHealth: (options?: RequestOptions) =>
    api.get<AzureTestHealthResponse>('/api/azure-data/tests/health', options),

  getTeams: (params?: { projectId?: string; search?: string; limit?: number }, options?: RequestOptions) => {
    const q = new URLSearchParams();
    if (params?.projectId) q.set('projectId', params.projectId);
    if (params?.search) q.set('search', params.search);
    if (params?.limit !== undefined) q.set('limit', String(params.limit));
    const qs = q.toString();
    return api.get<AzureTeamsResponse>(`/api/azure-data/teams${qs ? `?${qs}` : ''}`, options);
  },

  getUnassignedWorkItems: (params?: { projectId?: string; limit?: number }, options?: RequestOptions) => {
    const q = new URLSearchParams();
    if (params?.projectId) q.set('projectId', params.projectId);
    if (params?.limit !== undefined) q.set('limit', String(params.limit));
    const qs = q.toString();
    return api.get<AzureUnassignedResponse>(`/api/azure-data/work-items/unassigned${qs ? `?${qs}` : ''}`, options);
  },

  getProjects: (options?: RequestOptions) =>
    api.get<AzureProjectsResponse>('/api/azure-data/projects', options),

};

api.azureData = azureDataApi;
