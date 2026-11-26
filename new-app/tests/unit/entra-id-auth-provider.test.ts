import { describe, expect, it, beforeAll } from 'vitest';
import crypto from 'node:crypto';
import { EntraIdAuthProvider } from '../../src/infrastructure/auth/entra-id-auth-provider.js';
import { JwksKeyCache } from '../../src/infrastructure/auth/jwks-cache.js';

describe('Milestone 4 — Feature 23: Entra ID (Azure AD) SSO (OIDC)', () => {
  let privateKey: crypto.KeyObject;
  let publicKey: crypto.KeyObject;
  let wrongPrivateKey: crypto.KeyObject;
  const kid = 'test-key-id-1';
  const issuer = 'https://login.microsoftonline.com/tenant-123/v2.0';
  const clientId = 'workops-client-id';
  const audience = 'workops-api';

  beforeAll(() => {
    const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    privateKey = pair.privateKey;
    publicKey = pair.publicKey;

    const wrongPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    wrongPrivateKey = wrongPair.privateKey;
  });

  function createTestJwt(claims: Record<string, any>, key = privateKey, keyId = kid): string {
    const header = { alg: 'RS256', typ: 'JWT', kid: keyId };
    const hB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
    const pB64 = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const input = `${hB64}.${pB64}`;

    const signer = crypto.createSign('RSA-SHA256');
    signer.update(input);
    const sig = signer.sign(key).toString('base64url');
    return `${input}.${sig}`;
  }

  describe('Authorization Endpoint URL Construction', () => {
    it('constructs authorization URL with PKCE parameters', () => {
      const provider = new EntraIdAuthProvider({
        clientId,
        issuer,
        audience,
        redirectUri: 'http://localhost:3000/auth/callback',
      });

      const url = provider.getAuthorizationUrl({
        state: 'state-123',
        codeChallenge: 'challenge-xyz',
        codeChallengeMethod: 'S256',
        scope: 'openid profile email',
      });

      expect(url).toContain('/oauth/authorize');
      expect(url).toContain('client_id=workops-client-id');
      expect(url).toContain('response_type=code');
      expect(url).toContain('code_challenge=challenge-xyz');
      expect(url).toContain('code_challenge_method=S256');
      expect(url).toContain('state=state-123');
      expect(url).toContain('redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fauth%2Fcallback');
    });
  });

  describe('JWT Verification & Claims Processing', () => {
    it('verifies a valid RS256 JWT and extracts AuthenticatedUser claims', async () => {
      const provider = new EntraIdAuthProvider({ clientId, issuer, audience });
      provider.jwksCache.setKey(kid, publicKey);

      const now = Math.floor(Date.now() / 1000);
      const token = createTestJwt({
        sub: 'user-id-001',
        email: 'alex.lead@workops.test',
        name: 'Alex Lead',
        roles: ['Lead'],
        tenantId: 'tenant-enterprise-01',
        iss: issuer,
        aud: audience,
        iat: now - 60,
        exp: now + 3600,
      });

      const result = await provider.verifyToken(token);
      expect(result.valid).toBe(true);
      expect(result.status).toBe(200);
      expect(result.user).toBeDefined();
      expect(result.user?.id).toBe('user-id-001');
      expect(result.user?.email).toBe('alex.lead@workops.test');
      expect(result.user?.name).toBe('Alex Lead');
      expect(result.user?.roles).toContain('Lead');
      expect(result.user?.tenantId).toBe('tenant-enterprise-01');
    });

    it('rejects an expired token with HTTP 401 TOKEN_EXPIRED', async () => {
      const provider = new EntraIdAuthProvider({ clientId, issuer, audience });
      provider.jwksCache.setKey(kid, publicKey);

      const now = Math.floor(Date.now() / 1000);
      const token = createTestJwt({
        sub: 'user-002',
        email: 'dev@workops.test',
        roles: ['Developer'],
        iss: issuer,
        aud: audience,
        iat: now - 7200,
        exp: now - 3600,
      });

      const result = await provider.verifyToken(token);
      expect(result.valid).toBe(false);
      expect(result.status).toBe(401);
      expect(result.error).toBe('TOKEN_EXPIRED');
    });

    it('rejects a forged signature with HTTP 401 INVALID_SIGNATURE', async () => {
      const provider = new EntraIdAuthProvider({ clientId, issuer, audience });
      provider.jwksCache.setKey(kid, publicKey);

      const now = Math.floor(Date.now() / 1000);
      // Signed with a different private key
      const token = createTestJwt(
        {
          sub: 'forged-user',
          email: 'attacker@workops.test',
          roles: ['Admin'],
          iss: issuer,
          aud: audience,
          iat: now,
          exp: now + 3600,
        },
        wrongPrivateKey,
        kid
      );

      const result = await provider.verifyToken(token);
      expect(result.valid).toBe(false);
      expect(result.status).toBe(401);
      expect(result.error).toContain('INVALID_SIGNATURE');
    });

    it('rejects mismatched issuer with HTTP 401 INVALID_ISSUER', async () => {
      const provider = new EntraIdAuthProvider({ clientId, issuer, audience });
      provider.jwksCache.setKey(kid, publicKey);

      const now = Math.floor(Date.now() / 1000);
      const token = createTestJwt({
        sub: 'user-003',
        email: 'dev@workops.test',
        roles: ['Developer'],
        iss: 'https://untrusted-idp.com',
        aud: audience,
        iat: now,
        exp: now + 3600,
      });

      const result = await provider.verifyToken(token);
      expect(result.valid).toBe(false);
      expect(result.status).toBe(401);
      expect(result.error).toBe('INVALID_ISSUER');
    });

    it('rejects mismatched audience claim with HTTP 403 INVALID_AUDIENCE', async () => {
      const provider = new EntraIdAuthProvider({ clientId, issuer, audience });
      provider.jwksCache.setKey(kid, publicKey);

      const now = Math.floor(Date.now() / 1000);
      const token = createTestJwt({
        sub: 'user-004',
        email: 'dev@workops.test',
        roles: ['Developer'],
        iss: issuer,
        aud: 'other-app-audience',
        iat: now,
        exp: now + 3600,
      });

      const result = await provider.verifyToken(token);
      expect(result.valid).toBe(false);
      expect(result.status).toBe(403);
      expect(result.error).toBe('INVALID_AUDIENCE');
    });

    it('rejects malformed or empty tokens', async () => {
      const provider = new EntraIdAuthProvider({ clientId, issuer, audience });

      const res1 = await provider.verifyToken('');
      expect(res1.valid).toBe(false);
      expect(res1.status).toBe(401);

      const res2 = await provider.verifyToken('not.enough.parts.extra');
      expect(res2.valid).toBe(false);
      expect(res2.status).toBe(401);
    });

    it('rejects tokens with non-RS256 alg or missing kid header', async () => {
      const provider = new EntraIdAuthProvider({ clientId, issuer, audience });
      provider.jwksCache.setKey(kid, publicKey);
      const now = Math.floor(Date.now() / 1000);

      for (const alg of ['none', 'HS256']) {
        const hB64 = Buffer.from(JSON.stringify({ alg, typ: 'JWT', kid })).toString('base64url');
        const pB64 = Buffer.from(JSON.stringify({ sub: 'u', iss: issuer, aud: audience, exp: now + 3600 })).toString('base64url');
        const res = await provider.verifyToken(`${hB64}.${pB64}.sig`);
        expect(res.valid).toBe(false);
        expect(res.status).toBe(401);
        expect(res.error).toBe('INVALID_ALGORITHM');
      }

      const noKidHeader = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
      const pB64 = Buffer.from(JSON.stringify({ sub: 'u', iss: issuer, aud: audience, exp: now + 3600 })).toString('base64url');
      const resNoKid = await provider.verifyToken(`${noKidHeader}.${pB64}.sig`);
      expect(resNoKid.valid).toBe(false);
      expect(resNoKid.status).toBe(401);
      expect(resNoKid.error).toBe('TOKEN_MISSING_KID');
    });

    it('rejects tokens missing exp, iss, or aud claims when configured', async () => {
      const provider = new EntraIdAuthProvider({ clientId, issuer, audience });
      provider.jwksCache.setKey(kid, publicKey);
      const now = Math.floor(Date.now() / 1000);

      const noExp = createTestJwt({ sub: 'u', iss: issuer, aud: audience, iat: now });
      const resNoExp = await provider.verifyToken(noExp);
      expect(resNoExp.valid).toBe(false);
      expect(resNoExp.status).toBe(401);
      expect(resNoExp.error).toBe('TOKEN_MISSING_EXP');

      const noIss = createTestJwt({ sub: 'u', aud: audience, iat: now, exp: now + 3600 });
      const resNoIss = await provider.verifyToken(noIss);
      expect(resNoIss.valid).toBe(false);
      expect(resNoIss.status).toBe(401);
      expect(resNoIss.error).toBe('INVALID_ISSUER');

      const noAud = createTestJwt({ sub: 'u', iss: issuer, iat: now, exp: now + 3600 });
      const resNoAud = await provider.verifyToken(noAud);
      expect(resNoAud.valid).toBe(false);
      expect(resNoAud.status).toBe(403);
      expect(resNoAud.error).toBe('INVALID_AUDIENCE');
    });

    it('validates nbf claim with 60s clock skew tolerance', async () => {
      const provider = new EntraIdAuthProvider({ clientId, issuer, audience });
      provider.jwksCache.setKey(kid, publicKey);
      const now = Math.floor(Date.now() / 1000);

      const tooEarly = createTestJwt({
        sub: 'u',
        iss: issuer,
        aud: audience,
        nbf: now + 120,
        exp: now + 3600,
      });
      const resEarly = await provider.verifyToken(tooEarly);
      expect(resEarly.valid).toBe(false);
      expect(resEarly.status).toBe(401);
      expect(resEarly.error).toBe('TOKEN_NOT_YET_VALID');

      const withinSkew = createTestJwt({
        sub: 'u',
        email: 'skew@workops.test',
        roles: ['Developer'],
        iss: issuer,
        aud: audience,
        nbf: now + 30,
        exp: now + 3600,
      });
      const resSkew = await provider.verifyToken(withinSkew);
      expect(resSkew.valid).toBe(true);
      expect(resSkew.status).toBe(200);
    });
  });

  describe('JwksKeyCache', () => {
    it('returns cached key on network failure if key exists', async () => {
      const cache = new JwksKeyCache('http://127.0.0.1:9999/discovery/keys');
      cache.setKey('key-1', publicKey);

      const key = await cache.getKey('key-1', true);
      expect(key).toBe(publicKey);
    });

    it('throws 502 Bad Gateway on network failure when key is not cached', async () => {
      const cache = new JwksKeyCache('http://127.0.0.1:9999/discovery/keys');
      await expect(cache.getKey('missing-key', true)).rejects.toThrow('502 Bad Gateway');
    });
  });
});
