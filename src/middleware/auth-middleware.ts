/**
 * Authentication Middleware
 * Validates session cookies and protects API routes
 */

import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/auth-service';

export const COOKIE_NAME = 'claudito_session';

export interface AuthMiddlewareDependencies {
  authService: AuthService;
}

/**
 * Parse a specific cookie value from the Cookie header
 */
export function parseCookie(
  cookieHeader: string | undefined,
  name: string
): string | null {
  if (!cookieHeader) {
    return null;
  }

  const cookies = cookieHeader.split(';');

  for (const cookie of cookies) {
    const [cookieName, ...rest] = cookie.trim().split('=');

    if (cookieName === name) {
      return rest.join('='); // Handle values with '=' in them
    }
  }

  return null;
}

/**
 * Create middleware that validates session cookies
 * Returns 401 for unauthenticated requests
 */
export function createAuthMiddleware(deps: AuthMiddlewareDependencies) {
  const { authService } = deps;

  return (req: Request, res: Response, next: NextFunction): void => {
    // Health check is public (auth is optional via ?auth=1 query param)
    if (req.path === '/health') {
      next();
      return;
    }

    const sessionId = parseCookie(req.headers.cookie, COOKIE_NAME);

    if (!sessionId || !authService.validateSession(sessionId)) {
      res.status(401).json({ error: 'Unauthorized', code: 'AUTH_REQUIRED' });
      return;
    }

    next();
  };
}

/**
 * Get the session cookie name
 */
export function getSessionCookieName(): string {
  return COOKIE_NAME;
}
