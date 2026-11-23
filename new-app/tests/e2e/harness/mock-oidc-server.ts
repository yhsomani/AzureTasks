import http from 'node:http';
import crypto from 'node:crypto';
import { AddressInfo } from 'node:net';
import { UserRole } from './fixtures/tenants-teams-users.js';

export interface TokenClaims {
  sub: string;
  email: string;
  name: string;
  roles: UserRole[];
  tenantId: string;
  iss: string;
  aud: string;
  iat: number;
  exp: number;
  [key: string]: any;
}

export class MockOidcServer {
  private server: http.Server | null = null;
  private port: number = 0;
  private privateKey: crypto.KeyObject;
  private publicKey: crypto.KeyObject;
  private wrongPrivateKey: crypto.KeyObject;
  private kid: string = 'workops-e2e-key-1';

  constructor() {
    const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    this.privateKey = pair.privateKey;
    this.publicKey = pair.publicKey;

    const wrongPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    this.wrongPrivateKey = wrongPair.privateKey;
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
          res.end(JSON.stringify({ error: err?.message || 'Mock OIDC error' }));
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

  public getIssuer(): string {
    return this.getBaseUrl();
  }

  public getJwksUri(): string {
    return `${this.getBaseUrl()}/discovery/keys`;
  }

  public issueToken(
    claims: Partial<TokenClaims>,
    options?: { expired?: boolean; wrongKey?: boolean }
  ): string {
    const now = Math.floor(Date.now() / 1000);
    const fullClaims: TokenClaims = {
      sub: claims.sub || 'user-default-01',
      email: claims.email || 'user@workops.test',
      name: claims.name || 'Default User',
      roles: claims.roles || ['Developer'],
      tenantId: claims.tenantId || 'tenant-enterprise-01',
      iss: this.getIssuer(),
      aud: 'workops-api',
      iat: options?.expired ? now - 7200 : now,
      exp: options?.expired ? now - 3600 : now + 3600,
      ...claims,
    };

    const header = {
      alg: 'RS256',
      typ: 'JWT',
      kid: options?.wrongKey ? 'wrong-key-id' : this.kid,
    };

    const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
    const encodedPayload = Buffer.from(JSON.stringify(fullClaims)).toString('base64url');
    const signingInput = `${encodedHeader}.${encodedPayload}`;

    const signer = crypto.createSign('RSA-SHA256');
    signer.update(signingInput);
    const keyToUse = options?.wrongKey ? this.wrongPrivateKey : this.privateKey;
    const signature = signer.sign(keyToUse).toString('base64url');

    return `${signingInput}.${signature}`;
  }

  public issueAdminToken(user = 'admin@workops.test'): string {
    return this.issueToken({
      email: user,
      name: 'System Admin',
      roles: ['Admin'],
      tenantId: 'tenant-enterprise-01',
    });
  }

  public issueLeadToken(user = 'lead@workops.test'): string {
    return this.issueToken({
      email: user,
      name: 'Tech Lead',
      roles: ['Lead'],
      tenantId: 'tenant-enterprise-01',
    });
  }

  public issueDeveloperToken(user = 'dev1@workops.test'): string {
    return this.issueToken({
      email: user,
      name: 'Dev One',
      roles: ['Developer'],
      tenantId: 'tenant-enterprise-01',
    });
  }

  public issueAuditorToken(user = 'auditor@workops.test'): string {
    return this.issueToken({
      email: user,
      name: 'Compliance Auditor',
      roles: ['Auditor'],
      tenantId: 'tenant-enterprise-01',
    });
  }

  public verifyToken(token: string): TokenClaims | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      const [headerB64, payloadB64, sigB64] = parts;

      const verifier = crypto.createVerify('RSA-SHA256');
      verifier.update(`${headerB64}.${payloadB64}`);
      const valid = verifier.verify(this.publicKey, Buffer.from(sigB64, 'base64url'));
      if (!valid) return null;

      const claims = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as TokenClaims;
      const now = Math.floor(Date.now() / 1000);
      if (claims.exp && claims.exp < now) return null;

      return claims;
    } catch {
      return null;
    }
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const rawUrl = req.url || '/';
    const urlObj = new URL(rawUrl, `http://127.0.0.1:${this.port}`);
    const pathname = urlObj.pathname;

    if (pathname === '/.well-known/openid-configuration') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        issuer: this.getIssuer(),
        jwks_uri: this.getJwksUri(),
        token_endpoint: `${this.getBaseUrl()}/oauth/token`,
        authorization_endpoint: `${this.getBaseUrl()}/oauth/authorize`,
        response_types_supported: ['code', 'id_token', 'token id_token'],
        id_token_signing_alg_values_supported: ['RS256'],
        scopes_supported: ['openid', 'profile', 'email'],
      }));
      return;
    }

    if (pathname === '/discovery/keys') {
      const jwk = this.publicKey.export({ format: 'jwk' });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        keys: [
          {
            kty: jwk.kty,
            use: 'sig',
            alg: 'RS256',
            kid: this.kid,
            n: jwk.n,
            e: jwk.e,
          },
        ],
      }));
      return;
    }

    if (pathname === '/oauth/token' && req.method === 'POST') {
      const token = this.issueAdminToken();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        access_token: token,
        token_type: 'Bearer',
        expires_in: 3600,
        id_token: token,
      }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Mock OIDC Server OK', path: pathname }));
  }
}
