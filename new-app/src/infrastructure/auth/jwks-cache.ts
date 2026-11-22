import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';

export interface JwkKey {
  kty: string;
  use?: string;
  alg?: string;
  kid: string;
  n?: string;
  e?: string;
  x5c?: string[];
  [key: string]: any;
}

export interface JwksResponse {
  keys: JwkKey[];
}

export class JwksKeyCache {
  private cache: Map<string, { keyObject: crypto.KeyObject; rawJwk: JwkKey; cachedAt: number }> = new Map();

  constructor(
    public readonly jwksUri: string,
    public readonly ttlMs: number = 3600 * 1000 // 1 hour TTL default
  ) {}

  public setKey(kid: string, keyObject: crypto.KeyObject, rawJwk?: JwkKey): void {
    this.cache.set(kid, {
      keyObject,
      rawJwk: rawJwk || { kid, kty: 'RSA' },
      cachedAt: Date.now(),
    });
  }

  public async getKey(kid: string, networkDown = false): Promise<crypto.KeyObject> {
    const cached = this.cache.get(kid);
    const now = Date.now();

    if (networkDown) {
      if (cached) {
        return cached.keyObject;
      }
      throw new Error('502 Bad Gateway: JWKS unreachable and cache expired');
    }

    if (cached && now - cached.cachedAt < this.ttlMs) {
      return cached.keyObject;
    }

    // Refresh from JWKS URI
    try {
      await this.refresh();
      const fresh = this.cache.get(kid);
      if (fresh) {
        return fresh.keyObject;
      }
      // If kid wasn't returned by IdP
      if (cached) {
        return cached.keyObject;
      }
      throw new Error(`Public key with kid '${kid}' not found in JWKS`);
    } catch (err: any) {
      if (cached) {
        return cached.keyObject;
      }
      throw new Error(`502 Bad Gateway: JWKS unreachable and cache expired: ${err.message}`);
    }
  }

  public async refresh(): Promise<void> {
    if (!this.jwksUri) {
      throw new Error('JWKS URI is not configured');
    }

    const json = await this.fetchJson(this.jwksUri);
    if (!json || !Array.isArray(json.keys)) {
      throw new Error('Invalid JWKS response format: missing keys array');
    }

    const now = Date.now();
    for (const key of json.keys) {
      if (!key.kid) continue;
      try {
        const keyObject = crypto.createPublicKey({ key, format: 'jwk' });
        this.cache.set(key.kid, {
          keyObject,
          rawJwk: key,
          cachedAt: now,
        });
      } catch {
        // Skip malformed individual keys
      }
    }
  }

  private fetchJson(urlStr: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(urlStr);
      const isHttps = urlObj.protocol === 'https:';
      const client = isHttps ? https : http;

      const req = client.get(urlStr, { timeout: 5000 }, (res) => {
        if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
          return reject(new Error(`JWKS endpoint returned HTTP ${res.statusCode}`));
        }

        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e: any) {
            reject(new Error(`Failed to parse JWKS JSON: ${e.message}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('JWKS endpoint request timed out'));
      });
    });
  }
}
