export interface ClientRequestOptions extends RequestInit {
  auth?: 'operator' | 'viewer' | 'none';
  authToken?: string;
  bearerToken?: string;
  headers?: Record<string, string>;
}

export class HttpClientHelper {
  constructor(
    private readonly getBaseUrl: () => string,
    private readonly getOperatorToken: () => string = () => 'test-operator-secret-123'
  ) {}

  public async request(path: string, options: ClientRequestOptions = {}): Promise<Response> {
    const base = this.getBaseUrl();
    const url = path.startsWith('http') ? path : `${base}${path.startsWith('/') ? '' : '/'}${path}`;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...(options.headers || {}),
    };

    if (options.body && typeof options.body === 'object' && !(options.body instanceof Uint8Array)) {
      if (!headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
      }
      options.body = JSON.stringify(options.body);
    }

    if (options.bearerToken) {
      headers['Authorization'] = `Bearer ${options.bearerToken}`;
    } else if (options.auth !== 'none') {
      const token = options.authToken || this.getOperatorToken();
      if (token) {
        const username = options.auth === 'viewer' ? 'viewer' : 'admin';
        headers['Authorization'] = `Basic ${Buffer.from(`${username}:${token}`).toString('base64')}`;
      }
    }

    return fetch(url, {
      ...options,
      headers,
    });
  }

  public async get(path: string, options: ClientRequestOptions = {}): Promise<Response> {
    return this.request(path, { ...options, method: 'GET' });
  }

  public async post(path: string, body?: any, options: ClientRequestOptions = {}): Promise<Response> {
    return this.request(path, { ...options, method: 'POST', body });
  }

  public async put(path: string, body?: any, options: ClientRequestOptions = {}): Promise<Response> {
    return this.request(path, { ...options, method: 'PUT', body });
  }

  public async delete(path: string, options: ClientRequestOptions = {}): Promise<Response> {
    return this.request(path, { ...options, method: 'DELETE' });
  }
}
