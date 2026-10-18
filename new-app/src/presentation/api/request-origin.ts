import type { RequestHandler } from 'express';

/**
 * HTTP Basic credentials may be reused by browsers for requests initiated
 * by other sites. CORS does not prevent simple cross-site write requests.
 *
 * This guard checks browser-supplied Origin/Fetch Metadata before any unsafe
 * API endpoint is invoked. Non-browser CLI/server calls without those headers
 * remain supported. For TLS-terminating proxies configure PUBLIC_ORIGIN.
 */
export function unsafeRequestOriginGuard(options: {
  publicOrigin?: string;
  allowedOrigin?: string;
} = {}): RequestHandler {
  const parseTrustedOrigin = (raw: string | undefined, name: string): string | undefined => {
    if (!raw) return undefined;
    try {
      const parsed = new URL(raw);
      if ((parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
        parsed.origin !== raw || parsed.username || parsed.password ||
        parsed.hostname.includes('*')) {
        throw new Error('Not an exact HTTP(S) origin');
      }
      return parsed.origin;
    } catch {
      throw new Error(`${name} must be an exact HTTP(S) origin without a path or trailing slash.`);
    }
  };

  const publicOrigin = parseTrustedOrigin(options.publicOrigin, 'PUBLIC_ORIGIN');
  const allowedOrigin = parseTrustedOrigin(options.allowedOrigin, 'CORS_ORIGIN');

  return (req, res, next) => {
    if (!req.path.startsWith('/api/') ||
      !['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method.toUpperCase())) {
      return next();
    }

    const origin = req.get('origin');
    const site = req.get('sec-fetch-site');
    const trustedExternalOrigin = Boolean(origin && allowedOrigin && origin === allowedOrigin);

    const deny = () => res.status(403).json({
      success: false,
      error: 'Cross-origin API mutation is not permitted.',
    });

    if (site === 'cross-site' && !trustedExternalOrigin) return deny();
    if (site && !['same-origin', 'same-site', 'none', 'cross-site'].includes(site)) return deny();
    // Sibling subdomains are "same-site" but not necessarily same-origin.
    // If an ingress strips Origin, browser Fetch Metadata must not turn that
    // request into a trusted CLI call. Truly headerless CLI callers and
    // same-origin requests without Origin remain supported.
    if (!origin && site === 'same-site') return deny();
    if (!origin) return next();

    // An exact match is necessary: no *.example.com, suffix or substring matches.
    // Do not trust X-Forwarded-Proto without an explicit deployment configuration.
    const expected = publicOrigin ?? `${req.protocol}://${req.get('host')}`;
    if (origin !== expected && origin !== allowedOrigin) return deny();

    // Reject malformed, opaque or non-HTTP(S) origins (e.g. "null").
    try {
      const parsed = new URL(origin);
      if ((parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
        parsed.origin !== origin || parsed.username || parsed.password) return deny();
    } catch {
      return deny();
    }

    next();
  };
}
