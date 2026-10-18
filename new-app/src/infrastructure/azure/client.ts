/**
 * Azure DevOps HTTP Client
 * Low-level HTTP client for Azure DevOps REST API
 */

export interface AzureClientConfig {
  organization: string;
  pat?: string;
  baseUrl?: string;
  maxRetries?: number;
  initialRetryDelayMs?: number;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: any;
  timeout?: number;
}

/** Error that knows whether a retry could help. */
class AzureClientError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
    this.name = 'AzureClientError';
  }
}

export class AzureDevOpsClient {
  constructor(private readonly config: AzureClientConfig) {}

  /** Read live so a settings change applies without rebuilding the client. */
  get organization(): string {
    return this.config.organization;
  }

  /**
   * Constructor PAT wins when explicitly provided (including empty string);
   * otherwise fall back to the environment so a runtime-saved PAT applies.
   */
  private get pat(): string {
    return this.config.pat ?? process.env.AZURE_DEVOPS_PAT?.trim() ?? '';
  }

  get baseUrl(): string {
    return this.config.baseUrl || 'https://dev.azure.com';
  }

  private get maxRetries(): number {
    return this.config.maxRetries ?? 3;
  }

  private get initialRetryDelayMs(): number {
    return this.config.initialRetryDelayMs ?? 1000;
  }

  private get authHeader(): string {
    // Basic auth: PAT as password, empty username
    return `Basic ${Buffer.from(`:${this.pat}`).toString('base64')}`;
  }

  /**
   * Make an HTTP request with retry logic
   */
  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    if (!this.pat?.trim()) {
      throw new AzureClientError(
        'AZURE_DEVOPS_PAT is not configured. Set it in .env or the Settings page.',
        false
      );
    }

    const url = `${this.baseUrl}/${this.organization}${path}`;
    const method = options.method || 'GET';
    // GETs and WIQL searches are read-only; creation and JSON PATCH writes are
    // not replay-safe after a timeout or HTTP 5xx. Azure may have committed them.
    const replaySafe = method === 'GET' ||
      (method === 'POST' && /\/_apis\/wit\/wiql(?:\?|$)/i.test(path));
    const customHeaders = options.headers || {};
    const headers: Record<string, string> = {
      'Authorization': this.authHeader,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...customHeaders,
    };
    for (const key of Object.keys(customHeaders)) {
      if (key.toLowerCase() === 'content-type' && key !== 'Content-Type') {
        delete headers['Content-Type'];
      }
    }

    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), options.timeout ?? 30000);

        let response: Response;
        try {
          response = await fetch(url, {
            method: options.method || 'GET',
            headers,
            body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
            signal: controller.signal,
          });
        } finally {
          // A rejected fetch used to leave its abort timer running until expiry.
          clearTimeout(timeoutId);
        }

        // Handle rate limiting
        if (response.status === 429) {
          if (!replaySafe) {
            throw new AzureClientError('Azure DevOps rate-limited a write request. Its result is unverified; inspect Azure before retrying.', false);
          }
          if (attempt >= this.maxRetries) {
            throw new AzureClientError('Azure DevOps rate limit exceeded (HTTP 429); retry later.', false);
          }
          const retryAfter = response.headers.get('Retry-After');
          const seconds = retryAfter ? Number(retryAfter) : NaN;
          const delay = Number.isFinite(seconds) && seconds >= 0
            ? Math.min(seconds * 1000, 60000)
            : this.calculateBackoff(attempt);
          await this.sleep(delay);
          continue;
        }

        if (response.status >= 500) {
          if (!replaySafe) {
            throw new AzureClientError(`Azure DevOps returned HTTP ${response.status} for a write. The outcome is uncertain; inspect Azure before retrying.`, false);
          }
          if (attempt >= this.maxRetries) {
            throw new AzureClientError(`Azure DevOps returned HTTP ${response.status} after retries.`, false);
          }
          await this.sleep(this.calculateBackoff(attempt));
          continue;
        }

        // Handle auth errors (never retryable)
        if (response.status === 401) {
          throw new AzureClientError('Authentication failed. Check your PAT permissions.', false);
        }

        if (response.status === 403) {
          throw new AzureClientError('Access denied. Check PAT scopes (Work Items Read/Write required).', false);
        }

        const responseBody = await response.text();
        
        if (!response.ok) {
          let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
          try {
            const errorData = JSON.parse(responseBody);
            if (errorData.message) errorMessage = errorData.message;
          } catch {
            errorMessage = responseBody || errorMessage;
          }
          throw new AzureClientError(errorMessage, false);
        }

        if (!responseBody) {
          return {} as T;
        }

        return JSON.parse(responseBody);
      } catch (error) {
        let err = error instanceof Error ? error : new Error(String(error));

        // Non-retryable client errors fail fast.
        if (err instanceof AzureClientError && !err.retryable) {
          throw err;
        }

        // Normalize low-level network failures into an actionable message.
        if (err.name === 'AbortError') {
          err = new AzureClientError(`Request timed out after ${options.timeout ?? 30000}ms: ${path}`, true);
        } else if (!err.message.includes('HTTP ') && !err.message.startsWith('Authentication') && !err.message.startsWith('Access denied')) {
          err = new AzureClientError(`Network error contacting Azure DevOps: ${err.message}`, true);
        }

        if (!replaySafe) {
          throw new AzureClientError(`Azure DevOps write response unavailable. The outcome may have been committed; inspect Azure before retrying. ${err.message}`, false);
        }
        lastError = err;
        if (attempt < this.maxRetries) {
          await this.sleep(this.calculateBackoff(attempt));
        }
      }
    }

    throw lastError || new Error('Max retries exceeded');
  }

  private calculateBackoff(attempt: number): number {
    const baseDelay = this.initialRetryDelayMs * Math.pow(2, attempt);
    const jitter = Math.random() * 1000;
    return baseDelay + jitter;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * GET request
   */
  async get<T>(path: string, options: Omit<RequestOptions, 'method'> = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: 'GET' });
  }

  /**
   * POST request
   */
  async post<T>(
    path: string,
    body: any,
    options: Omit<RequestOptions, 'method' | 'body'> = {}
  ): Promise<T> {
    const isWorkItemCreate = path.includes('/_apis/wit/workitems/$');
    const headers = isWorkItemCreate
      ? { 'Content-Type': 'application/json-patch+json', ...options.headers }
      : options.headers;

    return this.request<T>(path, { ...options, method: 'POST', body, headers });
  }

  /**
   * PATCH request
   */
  async patch<T>(
    path: string,
    body: any,
    options: Omit<RequestOptions, 'method' | 'body'> = {}
  ): Promise<T> {
    return this.request<T>(path, {
      ...options,
      method: 'PATCH',
      body,
      headers: {
        'Content-Type': 'application/json-patch+json',
        ...options.headers,
      },
    });
  }

  /**
   * Delete request
   */
  async delete<T>(path: string, options: Omit<RequestOptions, 'method'> = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: 'DELETE' });
  }
}