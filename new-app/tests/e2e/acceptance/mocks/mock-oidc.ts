import crypto from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface OidcUserProfile {
  sub?: string;
  email: string;
  name?: string;
  roles?: string[];
  tid?: string;
}

export interface MintTokenOptions {
  sub?: string;
  email?: string;
  name?: string;
  roles?: string[];
  tid?: string;
  tenantId?: string;
  aud?: string | string[];
  iss?: string;
  kid?: string;
  expiresInSeconds?: number;
  nbfOffsetSeconds?: number;
  omitNbf?: boolean;
  expired?: boolean;
  wrongAudience?: boolean;
  wrongAlg?: boolean;
  wrongSignature?: boolean;
  wrongIssuer?: boolean;
  extraClaims?: Record<string, unknown>;
}

export interface OidcRequestRecord {
  method: string;
  path: string;
  query: Record<string, string>;
  timestamp: string;
}

interface StoredAuthCode {
  code: string;
  user: OidcUserProfile;
  clientId: string;
  redirectUri: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  nonce?: string;
}

export class MockOidcServer {
  private server: http.Server | null = null;
  private issuerUrl = '';
  private readonly primaryKeys: crypto.KeyPairKeyObjectResult;
  private readonly rogueKeys: crypto.KeyPairKeyObjectResult;
  private readonly kid: string;
  private readonly defaultAudience: string;
  private readonly defaultClientId: string;
  private nextUser: OidcUserProfile = {
    sub: 'oidc-admin-1',
    email: 'admin@workops.test',
    name: 'OIDC Admin',
    roles: ['Admin'],
    tid: 'tenant-enterprise-01',
  };
  private authCodes = new Map<string, StoredAuthCode>();
  private requests: OidcRequestRecord[] = [];

  constructor(options: { audience?: string; clientId?: string; defaultUser?: OidcUserProfile } = {}) {
    this.primaryKeys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    this.rogueKeys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    this.kid = `mock-oidc-key-${crypto.randomUUID().slice(0, 8)}`;
    this.defaultAudience = options.audience || 'workops-api';
    this.defaultClientId = options.clientId || 'workops-client';
    if (options.defaultUser) {
      this.nextUser = { ...options.defaultUser };
    }
  }

  public async start(): Promise<string> {
    if (this.server) return this.issuerUrl;

    this.server = http.createServer((req, res) => {
      void this.handleRequest(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(0, '127.0.0.1', () => resolve());
    });

    const address = this.server.address() as AddressInfo;
    this.issuerUrl = `http://127.0.0.1:${address.port}`;
    return this.issuerUrl;
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

  public getIssuerUrl(): string {
    return this.issuerUrl;
  }

  public getKid(): string {
    return this.kid;
  }

  public setNextUser(user: OidcUserProfile): void {
    this.nextUser = { ...user };
  }

  public getRequests(): OidcRequestRecord[] {
    return [...this.requests];
  }

  public clearRequests(): void {
    this.requests = [];
  }

  public reset(): void {
    this.requests = [];
    this.authCodes.clear();
    this.nextUser = {
      sub: 'oidc-admin-1',
      email: 'admin@workops.test',
      name: 'OIDC Admin',
      roles: ['Admin'],
      tid: 'tenant-enterprise-01',
    };
  }

  public getJwks(): { keys: Array<Record<string, unknown>> } {
    const exported = this.primaryKeys.publicKey.export({ format: 'jwk' }) as Record<string, unknown>;
    return {
      keys: [
        {
          ...exported,
          kty: 'RSA',
          use: 'sig',
          alg: 'RS256',
          kid: this.kid,
        },
      ],
    };
  }

  public mintToken(options: MintTokenOptions = {}): string {
    const now = Math.floor(Date.now() / 1000);
    const exp = options.expired
      ? now - 1800
      : now + (options.expiresInSeconds ?? 3600);
    const iat = options.expired ? now - 5400 : now;
    const nbf = options.expired
      ? now - 5400
      : now + (options.nbfOffsetSeconds ?? 0);

    const header: Record<string, unknown> = {
      alg: options.wrongAlg ? 'HS256' : 'RS256',
      typ: 'JWT',
      kid: options.kid ?? this.kid,
    };

    const tid = options.tid ?? options.tenantId ?? this.nextUser.tid ?? 'tenant-enterprise-01';
    const payload: Record<string, unknown> = {
      sub: options.sub ?? this.nextUser.sub ?? 'oidc-user-1',
      email: options.email ?? this.nextUser.email,
      name: options.name ?? this.nextUser.name ?? 'OIDC User',
      roles: options.roles ?? this.nextUser.roles ?? ['Admin'],
      tid,
      tenantId: tid,
      iss: options.wrongIssuer
        ? 'https://untrusted-issuer.invalid'
        : options.iss ?? (this.issuerUrl || 'http://127.0.0.1'),
      aud: options.wrongAudience
        ? 'wrong-audience-id'
        : options.aud ?? this.defaultAudience,
      iat,
      exp,
      ...(options.extraClaims ?? {}),
    };

    if (!options.omitNbf) {
      payload.nbf = nbf;
    }

    const headerB64 = Buffer.from(JSON.stringify(header), 'utf8').toString('base64url');
    const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const signingInput = `${headerB64}.${payloadB64}`;

    if (options.wrongAlg) {
      const hmacSig = crypto.createHmac('sha256', 'insecure-symmetric-secret').update(signingInput).digest('base64url');
      return `${signingInput}.${hmacSig}`;
    }

    const signingKey = options.wrongSignature ? this.rogueKeys.privateKey : this.primaryKeys.privateKey;
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(signingInput);
    const signature = signer.sign(signingKey).toString('base64url');
    return `${signingInput}.${signature}`;
  }

  private async readBody(req: http.IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  private sendJson(res: http.ServerResponse, statusCode: number, payload: unknown): void {
    const body = JSON.stringify(payload);
    res.writeHead(statusCode, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const rawUrl = req.url || '/';
    const parsedUrl = new URL(rawUrl, this.issuerUrl || 'http://127.0.0.1');
    const pathname = parsedUrl.pathname;
    const method = (req.method || 'GET').toUpperCase();

    const queryObj: Record<string, string> = {};
    parsedUrl.searchParams.forEach((v, k) => {
      queryObj[k] = v;
    });

    this.requests.push({
      method,
      path: pathname,
      query: queryObj,
      timestamp: new Date().toISOString(),
    });

    // GET /.well-known/openid-configuration
    if (method === 'GET' && pathname === '/.well-known/openid-configuration') {
      this.sendJson(res, 200, {
        issuer: this.issuerUrl,
        authorization_endpoint: `${this.issuerUrl}/oauth/authorize`,
        token_endpoint: `${this.issuerUrl}/oauth/token`,
        jwks_uri: `${this.issuerUrl}/discovery/keys`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        scopes_supported: ['openid', 'profile', 'email'],
      });
      return;
    }

    // GET /discovery/keys or /.well-known/jwks.json
    if (method === 'GET' && (pathname === '/discovery/keys' || pathname === '/.well-known/jwks.json')) {
      this.sendJson(res, 200, this.getJwks());
      return;
    }

    // GET /oauth/authorize
    if (method === 'GET' && (pathname === '/oauth/authorize' || pathname === '/oauth2/v2.0/authorize')) {
      const redirectUri = parsedUrl.searchParams.get('redirect_uri');
      const state = parsedUrl.searchParams.get('state') || '';
      const clientId = parsedUrl.searchParams.get('client_id') || this.defaultClientId;
      const codeChallenge = parsedUrl.searchParams.get('code_challenge') || undefined;
      const codeChallengeMethod = parsedUrl.searchParams.get('code_challenge_method') || undefined;
      const nonce = parsedUrl.searchParams.get('nonce') || undefined;
      const loginHint = parsedUrl.searchParams.get('login_hint');

      if (!redirectUri) {
        this.sendJson(res, 400, { error: 'invalid_request', error_description: 'redirect_uri is required' });
        return;
      }

      const code = `auth-code-${crypto.randomUUID()}`;
      const user: OidcUserProfile = loginHint
        ? { ...this.nextUser, email: loginHint, sub: `oidc-${loginHint}` }
        : { ...this.nextUser };

      this.authCodes.set(code, {
        code,
        user,
        clientId,
        redirectUri,
        codeChallenge,
        codeChallengeMethod,
        nonce,
      });

      const target = new URL(redirectUri);
      target.searchParams.set('code', code);
      if (state) target.searchParams.set('state', state);

      res.writeHead(302, { Location: target.toString() });
      res.end();
      return;
    }

    // POST /oauth/token
    if (method === 'POST' && (pathname === '/oauth/token' || pathname === '/oauth2/v2.0/token')) {
      const rawBody = await this.readBody(req);
      let params: URLSearchParams;
      if (req.headers['content-type']?.includes('application/json')) {
        try {
          const json = JSON.parse(rawBody) as Record<string, string>;
          params = new URLSearchParams(json);
        } catch {
          params = new URLSearchParams();
        }
      } else {
        params = new URLSearchParams(rawBody);
      }

      const grantType = params.get('grant_type') || 'authorization_code';
      const code = params.get('code') || '';
      const codeVerifier = params.get('code_verifier') || '';

      if (grantType !== 'authorization_code') {
        this.sendJson(res, 400, { error: 'unsupported_grant_type' });
        return;
      }

      const stored = this.authCodes.get(code);
      if (!stored) {
        this.sendJson(res, 400, { error: 'invalid_grant', error_description: 'Unknown authorization code' });
        return;
      }

      if (stored.codeChallenge && codeVerifier) {
        const expected = stored.codeChallengeMethod === 'plain'
          ? codeVerifier
          : crypto.createHash('sha256').update(codeVerifier).digest('base64url');
        if (expected !== stored.codeChallenge) {
          this.sendJson(res, 400, { error: 'invalid_grant', error_description: 'PKCE verification failed' });
          return;
        }
      }

      this.authCodes.delete(code);

      const idToken = this.mintToken({
        sub: stored.user.sub,
        email: stored.user.email,
        name: stored.user.name,
        roles: stored.user.roles,
        tid: stored.user.tid,
        ...(stored.nonce ? { extraClaims: { nonce: stored.nonce } } : {}),
      });

      this.sendJson(res, 200, {
        token_type: 'Bearer',
        expires_in: 3600,
        access_token: idToken,
        id_token: idToken,
      });
      return;
    }

    this.sendJson(res, 404, { error: 'not_found', path: pathname });
  }
}
