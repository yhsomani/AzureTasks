/**
 * Azure DevOps REST API HTTP Client with Basic Auth, retries, rate limiting, and PAT sanitization.
 */

import { logger } from '../utils/logger.js';
import { withRetry, HttpError } from '../utils/retry.js';
import { JsonPatchOperation } from './types.js';

export interface AzureClientOptions {
  organization: string;
  pat: string;
  baseUrl?: string;
  apiVersion?: string;
  maxRetries?: number;
}

export class AzureDevOpsClient {
  private readonly organization: string;
  private readonly baseUrl: string;
  private readonly apiVersion: string;
  private readonly authHeader: string;
  private readonly maxRetries: number;

  constructor(options: AzureClientOptions) {
    if (!options.pat || options.pat.trim().length === 0) {
      throw new Error('Azure DevOps Personal Access Token (PAT) is required.');
    }
    if (!options.organization || options.organization.trim().length === 0) {
      throw new Error('Azure DevOps Organization is required.');
    }

    this.organization = options.organization.trim();
    this.baseUrl = (options.baseUrl || 'https://dev.azure.com').replace(/\/+$/, '');
    this.apiVersion = options.apiVersion || '7.0';
    this.maxRetries = options.maxRetries ?? 3;

    // Register PAT with logger to ensure zero credential leakage
    logger.registerSecret(options.pat);

    // Basic Auth header: base64(:PAT)
    const encodedPat = Buffer.from(`:${options.pat.trim()}`).toString('base64');
    this.authHeader = `Basic ${encodedPat}`;
  }

  private buildUrl(path: string, queryParams?: Record<string, string>): string {
    const cleanPath = path.replace(/^\/+/, '');
    const url = new URL(`${this.baseUrl}/${this.organization}/${cleanPath}`);
    
    // Default api-version if not explicitly present in queryParams
    if (!queryParams || !queryParams['api-version']) {
      url.searchParams.set('api-version', this.apiVersion);
    }
    
    if (queryParams) {
      for (const [key, value] of Object.entries(queryParams)) {
        url.searchParams.set(key, value);
      }
    }
    return url.toString();
  }

  public async request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
    queryParams?: Record<string, string>,
    contentType = 'application/json'
  ): Promise<T> {
    const url = this.buildUrl(path, queryParams);

    return withRetry<T>(
      async (attempt) => {
        logger.debug(`[HTTP ${method}] ${url} (Attempt ${attempt})`);

        const headers: Record<string, string> = {
          Authorization: this.authHeader,
          Accept: 'application/json',
          'Content-Type': contentType,
        };

        const init: RequestInit = {
          method,
          headers,
        };

        if (body !== undefined) {
          init.body = typeof body === 'string' ? body : JSON.stringify(body);
        }

        let response: Response;
        try {
          response = await fetch(url, init);
        } catch (netErr: any) {
          const cause = netErr?.cause ? ` (Cause: ${netErr.cause?.message || netErr.cause})` : '';
          throw new Error(`Network failure connecting to Azure DevOps: ${netErr instanceof Error ? netErr.message : String(netErr)}${cause}`);
        }

        if (response.status === 401) {
          throw new HttpError(
            401,
            'Unauthorized',
            'Azure DevOps authentication failed. The Personal Access Token (PAT) is invalid, expired, or lacks access.'
          );
        }

        if (response.status === 403) {
          throw new HttpError(
            403,
            'Forbidden',
            `Access denied. The PAT lacks required permissions on organization '${this.organization}'.`
          );
        }

        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          const retrySeconds = retryAfter ? parseInt(retryAfter, 10) : 5;
          throw new HttpError(429, 'Too Many Requests', 'Azure DevOps rate limit exceeded.', retrySeconds);
        }

        if (!response.ok) {
          let errorText = '';
          try {
            const rawText = await response.text();
            try {
              const errJson = JSON.parse(rawText) as { message?: string; typeKey?: string };
              errorText = errJson.message || rawText;
            } catch {
              errorText = rawText;
            }
          } catch {
            errorText = response.statusText;
          }
          throw new HttpError(response.status, response.statusText, errorText);
        }

        if (response.status === 204) {
          return undefined as unknown as T;
        }

        return (await response.json()) as T;
      },
      { maxRetries: this.maxRetries }
    );
  }

  public async get<T>(path: string, queryParams?: Record<string, string>): Promise<T> {
    return this.request<T>('GET', path, undefined, queryParams);
  }

  public async post<T>(
    path: string,
    body: unknown,
    queryParams?: Record<string, string>,
    contentType = 'application/json'
  ): Promise<T> {
    return this.request<T>('POST', path, body, queryParams, contentType);
  }

  public async patch<T>(
    path: string,
    patchOperations: JsonPatchOperation[],
    queryParams?: Record<string, string>
  ): Promise<T> {
    return this.request<T>(
      'PATCH',
      path,
      patchOperations,
      queryParams,
      'application/json-patch+json'
    );
  }
}
