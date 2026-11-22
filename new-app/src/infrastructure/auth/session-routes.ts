import { Router, Request, Response } from 'express';
import { EntraIdAuthProvider } from './entra-id-auth-provider.js';
import crypto from 'node:crypto';

export interface SessionRouteDependencies {
  authProvider?: EntraIdAuthProvider;
}

export function createAuthRouter(deps: SessionRouteDependencies): Router {
  const router = Router();

  // GET /auth/login - Initiate OIDC PKCE login flow
  router.get('/login', (req: Request, res: Response) => {
    if (!deps.authProvider) {
      return res.status(503).json({
        success: false,
        error: 'OIDC Identity Provider is not configured',
      });
    }

    const state = crypto.randomUUID();
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto
      .createHash('sha256')
      .update(verifier)
      .digest('base64url');

    // Store verifier and state in temporary cookies for callback verification
    res.cookie('pkce_verifier', verifier, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 10 * 60 * 1000, // 10 minutes
    });

    res.cookie('oauth_state', state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 10 * 60 * 1000, // 10 minutes
    });

    const authUrl = deps.authProvider.getAuthorizationUrl({
      state,
      codeChallenge: challenge,
      codeChallengeMethod: 'S256',
    });

    if (req.headers.accept?.includes('application/json')) {
      return res.json({ success: true, authorizationUrl: authUrl, state });
    }

    res.redirect(authUrl);
  });

  // GET /auth/callback - OAuth2 PKCE callback
  router.get('/callback', async (req: Request, res: Response) => {
    if (!deps.authProvider) {
      return res.status(503).json({
        success: false,
        error: 'OIDC Identity Provider is not configured',
      });
    }

    const code = req.query.code as string;
    const returnedState = req.query.state as string;

    if (!code) {
      return res.status(400).json({
        success: false,
        error: 'Missing authorization code in callback',
      });
    }

    let expectedState: string | undefined;
    let verifier: string | undefined;

    if ((req as any).cookies) {
      expectedState = (req as any).cookies.oauth_state;
      verifier = (req as any).cookies.pkce_verifier;
    }
    if (req.headers.cookie) {
      if (!expectedState) {
        const stateMatch = req.headers.cookie.match(/oauth_state=([^;]+)/);
        if (stateMatch) expectedState = decodeURIComponent(stateMatch[1]);
      }
      if (!verifier) {
        const match = req.headers.cookie.match(/pkce_verifier=([^;]+)/);
        if (match) verifier = decodeURIComponent(match[1]);
      }
    }

    if (!returnedState || !expectedState || returnedState !== expectedState) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or missing OAuth2 state parameter (CSRF detected)',
      });
    }

    try {
      const tokens = await deps.authProvider.exchangeCodeForTokens(code, verifier);
      res.clearCookie('pkce_verifier');
      res.clearCookie('oauth_state');

      // Set session cookie
      res.cookie('workops_session', tokens.idToken || tokens.accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: (tokens.expiresIn || 3600) * 1000,
      });

      if (req.headers.accept?.includes('application/json')) {
        return res.json({ success: true, ...tokens });
      }

      res.redirect('/');
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: `OIDC code exchange failed: ${err.message}`,
      });
    }
  });

  // POST /auth/logout - Terminate session
  router.post('/logout', (_req: Request, res: Response) => {
    res.clearCookie('workops_session');
    res.clearCookie('workops_token');
    res.json({
      success: true,
      message: 'Logged out successfully',
    });
  });

  return router;
}
