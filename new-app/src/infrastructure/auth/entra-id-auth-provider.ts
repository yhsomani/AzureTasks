import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { JwksKeyCache } from './jwks-cache.js';
import { AuthenticatedUser, normalizeRole, Role } from './rbac.js';
import { Request, Response, NextFunction, RequestHandler } from 'express';

export interface EntraIdAuthConfig {
  tenantId?: string;
  clientId: string;
  clientSecret?: string;
  issuer?: string;
  jwksUri?: string;
  redirectUri?: string;
  audience?: string;
  authority?: string;
}

export interface TokenVerificationResult {
  valid: boolean;
  status: number;
  error?: string;
  claims?: any;
  user?: AuthenticatedUser;
}

export class EntraIdAuthProvider {
  public readonly jwksCache: JwksKeyCache;
  public readonly issuer?: string;
  public readonly clientId: string;
  public readonly audience?: string;
  public readonly redirectUri?: string;
  public readonly tenantId: string;
  private readonly authority: string;

  constructor(public readonly config: EntraIdAuthConfig) {
    this.clientId = config.clientId;
    this.audience = config.audience;
    this.redirectUri = config.redirectUri;
    this.tenantId = config.tenantId || 'common';
    this.issuer = config.issuer;

    this.authority =
      config.authority ||
      config.issuer ||
      `https://login.microsoftonline.com/${this.tenantId}`;

    const jwksUri =
      config.jwksUri ||
      (this.issuer
        ? `${this.issuer.replace(/\/+$/, '')}/discovery/keys`
        : `https://login.microsoftonline.com/${this.tenantId}/discovery/v2.0/keys`);

    this.jwksCache = new JwksKeyCache(jwksUri);
  }

  /**
   * Construct OAuth2 PKCE Authorization Endpoint URL.
   */
  public getAuthorizationUrl(options: {
    state?: string;
    codeChallenge?: string;
    codeChallengeMethod?: 'S256' | 'plain';
    scope?: string;
    redirectUri?: string;
  } = {}): string {
    const base = this.issuer
      ? `${this.issuer.replace(/\/+$/, '')}/oauth/authorize`
      : `${this.authority.replace(/\/+$/, '')}/oauth2/v2.0/authorize`;

    const redirect = options.redirectUri || this.redirectUri || 'http://localhost:3000/auth/callback';
    const scope = options.scope || 'openid profile email';
    const state = options.state || crypto.randomUUID();

    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'code',
      redirect_uri: redirect,
      scope,
      state,
      response_mode: 'query',
    });

    if (options.codeChallenge) {
      params.set('code_challenge', options.codeChallenge);
      params.set('code_challenge_method', options.codeChallengeMethod || 'S256');
    }

    return `${base}?${params.toString()}`;
  }

  /**
   * Exchange OAuth2 PKCE authorization code for access and ID tokens.
   */
  public async exchangeCodeForTokens(
    code: string,
    codeVerifier?: string,
    redirectUri?: string
  ): Promise<{ accessToken: string; idToken: string; expiresIn: number; refreshToken?: string }> {
    const tokenUrl = this.issuer
      ? `${this.issuer.replace(/\/+$/, '')}/oauth/token`
      : `${this.authority.replace(/\/+$/, '')}/oauth2/v2.0/token`;

    const bodyParams = new URLSearchParams({
      client_id: this.clientId,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri || this.redirectUri || 'http://localhost:3000/auth/callback',
    });

    if (codeVerifier) {
      bodyParams.set('code_verifier', codeVerifier);
    }

    if (this.config.clientSecret) {
      bodyParams.set('client_secret', this.config.clientSecret);
    }

    const res = await this.postJson(tokenUrl, bodyParams.toString());
    return {
      accessToken: res.access_token,
      idToken: res.id_token || res.access_token,
      expiresIn: res.expires_in || 3600,
      refreshToken: res.refresh_token,
    };
  }

  /**
   * Cryptographically verify a JWT Bearer Token issued by Entra ID or Mock OIDC.
   */
  public async verifyToken(token: string): Promise<TokenVerificationResult> {
    if (!token || typeof token !== 'string') {
      return { valid: false, status: 401, error: 'TOKEN_MISSING' };
    }

    const parts = token.trim().split('.');
    if (parts.length !== 3) {
      return { valid: false, status: 401, error: 'TOKEN_INVALID_FORMAT' };
    }

    const [headerB64, payloadB64, sigB64] = parts;
    let header: any;
    let payload: any;

    try {
      header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
      payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    } catch {
      return { valid: false, status: 401, error: 'TOKEN_MALFORMED' };
    }

    // 1. Check expiration claim
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      return { valid: false, status: 401, error: 'TOKEN_EXPIRED' };
    }

    // 2. Check issuer claim
    if (this.issuer && payload.iss && payload.iss !== this.issuer) {
      return { valid: false, status: 401, error: 'INVALID_ISSUER' };
    }

    // 3. Check audience claim
    const expectedAudience = this.audience || this.clientId;
    if (expectedAudience && payload.aud) {
      const audMatches = Array.isArray(payload.aud)
        ? payload.aud.includes(expectedAudience)
        : payload.aud === expectedAudience;

      if (!audMatches) {
        return { valid: false, status: 403, error: 'INVALID_AUDIENCE' };
      }
    }

    // 4. Verify signature using public key from JWKS
    const kid = header.kid;
    try {
      // In test environments or when mock/fake kid is passed without mock server running,
      // prevent long-hanging HTTP GET requests against Microsoft JWKS endpoints
      const isTestEnv = Boolean(process.env.NODE_ENV === 'test' || process.env.VITEST);
      const publicKey = await this.jwksCache.getKey(kid, isTestEnv);
      const verifier = crypto.createVerify('RSA-SHA256');
      verifier.update(`${headerB64}.${payloadB64}`);
      const isValid = verifier.verify(publicKey, Buffer.from(sigB64, 'base64url'));

      if (!isValid) {
        return { valid: false, status: 401, error: 'INVALID_SIGNATURE' };
      }
    } catch (err: any) {
      return { valid: false, status: 401, error: `INVALID_SIGNATURE: ${err.message}` };
    }

    // 5. Map payload to AuthenticatedUser
    const rawRoles = payload.roles || payload.role || [];
    const rolesArray: string[] = Array.isArray(rawRoles) ? rawRoles : [rawRoles];
    const roles: Role[] = rolesArray.map((r) => normalizeRole(r));

    const user: AuthenticatedUser = {
      id: payload.sub || payload.oid || 'unknown-user',
      email: (payload.email || payload.preferred_username || payload.upn || '').trim().toLowerCase(),
      name: payload.name || payload.displayName || 'WorkOps User',
      roles: roles.length > 0 ? roles : ['Developer'],
      tenantId: payload.tenantId || payload.tid || this.tenantId,
    };

    return {
      valid: true,
      status: 200,
      claims: payload,
      user,
    };
  }

  /**
   * Express middleware for JWT validation.
   */
  public createMiddleware(): RequestHandler {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      const authHeader = req.headers.authorization;
      let token: string | undefined;

      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.slice(7).trim();
      } else if (req.headers.cookie) {
        const cookies = req.headers.cookie.split(';');
        for (const cookie of cookies) {
          const [name, val] = cookie.trim().split('=');
          if (name === 'workops_session' || name === 'workops_token') {
            token = decodeURIComponent(val);
            break;
          }
        }
      }

      if (!token) {
        return next();
      }

      const result = await this.verifyToken(token);
      if (!result.valid) {
        res.status(result.status).json({
          success: false,
          error: result.error,
        });
        return;
      }

      req.user = result.user;
      next();
    };
  }

  private postJson(urlStr: string, body: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(urlStr);
      const isHttps = urlObj.protocol === 'https:';
      const client = isHttps ? https : http;

      const req = client.request(
        urlStr,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(body),
          },
          timeout: 5000,
        },
        (res) => {
          let data = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            try {
              resolve(JSON.parse(data));
            } catch {
              resolve({ raw: data });
            }
          });
        }
      );

      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }
}
