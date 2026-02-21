import { Request, Response, NextFunction } from 'express';
import { getLogger } from '../utils';

const logger = getLogger('rate-limit');

interface RateLimitOptions {
  windowMs: number;      // Time window in milliseconds
  maxRequests: number;   // Max requests per window
  message?: string;      // Custom error message
  skipSuccessfulRequests?: boolean; // Don't count successful requests
}

interface RateLimitStore {
  [key: string]: {
    count: number;
    resetTime: number;
  };
}

/**
 * Simple in-memory rate limiter
 * For production, consider using redis-based rate limiting
 */
export function createRateLimiter(options: RateLimitOptions) {
  const {
    windowMs,
    maxRequests,
    message = 'Too many requests, please try again later',
    skipSuccessfulRequests = false
  } = options;

  const store: RateLimitStore = {};

  // Clean up expired entries periodically (unref so it doesn't block process exit)
  setInterval(() => {
    const now = Date.now();
    Object.keys(store).forEach(key => {
      if (store[key] && store[key].resetTime < now) {
        delete store[key];
      }
    });
  }, windowMs).unref();

  return (req: Request, res: Response, next: NextFunction): void => {
    // Use IP address as the key (consider using user ID for authenticated routes)
    const key = req.ip || 'unknown';
    const now = Date.now();

    if (!store[key] || store[key].resetTime < now) {
      store[key] = {
        count: 0,
        resetTime: now + windowMs
      };
    }

    const current = store[key];

    // Check if limit exceeded
    if (current.count >= maxRequests) {
      const retryAfter = Math.ceil((current.resetTime - now) / 1000);

      logger.warn('Rate limit exceeded', {
        ip: key,
        count: current.count,
        limit: maxRequests,
        retryAfter
      });

      res.setHeader('X-RateLimit-Limit', maxRequests.toString());
      res.setHeader('X-RateLimit-Remaining', '0');
      res.setHeader('X-RateLimit-Reset', current.resetTime.toString());
      res.setHeader('Retry-After', retryAfter.toString());

      res.status(429).json({
        error: message,
        retryAfter
      });
      return;
    }

    // Increment counter
    if (!skipSuccessfulRequests) {
      current.count++;
    } else {
      // If skipping successful requests, increment after response
      const originalSend = res.send;
      res.send = function(data): Response {
        // Only count if the response was not successful
        if (res.statusCode >= 400) {
          current.count++;
        }
        return originalSend.call(this, data);
      };
    }

    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', maxRequests.toString());
    res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - current.count).toString());
    res.setHeader('X-RateLimit-Reset', current.resetTime.toString());

    next();
  };
}

/**
 * Rate limiters for different operations
 */

// Strict limit for resource-intensive operations
export const strictRateLimit = createRateLimiter({
  windowMs: 1 * 60 * 1000,  // 1 minute
  maxRequests: 5,
  message: 'Too many requests for this operation. Please wait before trying again.'
});

// Moderate limit for regular operations
export const moderateRateLimit = createRateLimiter({
  windowMs: 1 * 60 * 1000,  // 1 minute
  maxRequests: 30,
  message: 'Too many requests. Please slow down.'
});

// Lenient limit for read operations
export const lenientRateLimit = createRateLimiter({
  windowMs: 1 * 60 * 1000,  // 1 minute
  maxRequests: 100,
  message: 'Too many requests. Please try again later.'
});

// Special rate limiter for agent operations (per project)
export function createProjectRateLimiter(options: Omit<RateLimitOptions, 'message'>) {
  const store: RateLimitStore = {};

  return (req: Request, res: Response, next: NextFunction): void => {
    const projectId = req.params['id'];
    if (!projectId) {
      return next();
    }

    const key = `project:${projectId}`;
    const now = Date.now();

    if (!store[key] || store[key].resetTime < now) {
      store[key] = {
        count: 0,
        resetTime: now + options.windowMs
      };
    }

    const current = store[key];

    if (current.count >= options.maxRequests) {
      const retryAfter = Math.ceil((current.resetTime - now) / 1000);

      logger.warn('Project rate limit exceeded', {
        projectId,
        count: current.count,
        limit: options.maxRequests,
        retryAfter
      });

      res.status(429).json({
        error: `Too many operations for this project. Please wait ${retryAfter} seconds.`,
        retryAfter
      });
      return;
    }

    current.count++;
    next();
  };
}

// Rate limiter for expensive agent operations
export const agentOperationRateLimit = createProjectRateLimiter({
  windowMs: 5 * 60 * 1000,  // 5 minutes
  maxRequests: 10,          // Max 10 agent operations per project per 5 minutes
});

// Rate limiter for roadmap generation
export const roadmapGenerationRateLimit = createProjectRateLimiter({
  windowMs: 10 * 60 * 1000,  // 10 minutes
  maxRequests: 3,            // Max 3 roadmap generations per project per 10 minutes
});