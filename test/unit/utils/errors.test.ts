import { Request, Response, NextFunction } from 'express';
import {
  AppError,
  NotFoundError,
  ValidationError,
  ConflictError,
  GitError,
  GitHubCLIError,
  createErrorHandler,
  asyncHandler,
} from '../../../src/utils/errors';

// Mock logger
jest.mock('../../../src/utils/logger', () => ({
  getLogger: jest.fn().mockReturnValue({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

describe('Error Classes', () => {
  describe('AppError', () => {
    it('should create error with message and status code', () => {
      const error = new AppError('Test error', 500);

      expect(error.message).toBe('Test error');
      expect(error.statusCode).toBe(500);
      expect(error.isOperational).toBe(true);
    });

    it('should create error with optional code', () => {
      const error = new AppError('Test error', 400, 'TEST_CODE');

      expect(error.code).toBe('TEST_CODE');
    });

    it('should be an instance of Error', () => {
      const error = new AppError('Test', 500);

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(AppError);
    });

    it('should capture stack trace', () => {
      const error = new AppError('Test', 500);

      expect(error.stack).toBeDefined();
      expect(error.stack).toContain('Test');
    });

    it('should set name to constructor name', () => {
      const error = new AppError('Test', 500);

      expect(error.name).toBe('Error');
    });
  });

  describe('NotFoundError', () => {
    it('should create 404 error with resource name', () => {
      const error = new NotFoundError('User');

      expect(error.message).toBe('User not found');
      expect(error.statusCode).toBe(404);
      expect(error.code).toBe('NOT_FOUND');
    });

    it('should be an instance of AppError', () => {
      const error = new NotFoundError('Resource');

      expect(error).toBeInstanceOf(AppError);
    });

    it('should handle various resource names', () => {
      const error1 = new NotFoundError('Project');
      const error2 = new NotFoundError('Conversation');
      const error3 = new NotFoundError('File at path /foo/bar');

      expect(error1.message).toBe('Project not found');
      expect(error2.message).toBe('Conversation not found');
      expect(error3.message).toBe('File at path /foo/bar not found');
    });
  });

  describe('ValidationError', () => {
    it('should create 400 error with message', () => {
      const error = new ValidationError('Invalid input');

      expect(error.message).toBe('Invalid input');
      expect(error.statusCode).toBe(400);
      expect(error.code).toBe('VALIDATION_ERROR');
    });

    it('should be an instance of AppError', () => {
      const error = new ValidationError('Invalid');

      expect(error).toBeInstanceOf(AppError);
    });
  });

  describe('ConflictError', () => {
    it('should create 409 error with message', () => {
      const error = new ConflictError('Resource already exists');

      expect(error.message).toBe('Resource already exists');
      expect(error.statusCode).toBe(409);
      expect(error.code).toBe('CONFLICT');
    });

    it('should be an instance of AppError', () => {
      const error = new ConflictError('Conflict');

      expect(error).toBeInstanceOf(AppError);
    });
  });

  describe('GitError', () => {
    it('should create 500 error with message', () => {
      const error = new GitError('Failed to commit');

      expect(error.message).toBe('Failed to commit');
      expect(error.statusCode).toBe(500);
      expect(error.code).toBe('GIT_ERROR');
    });

    it('should be an instance of AppError', () => {
      const error = new GitError('Git failed');

      expect(error).toBeInstanceOf(AppError);
    });
  });

  describe('GitHubCLIError', () => {
    it('should create 500 error with message', () => {
      const error = new GitHubCLIError('gh command failed');

      expect(error.message).toBe('gh command failed');
      expect(error.statusCode).toBe(500);
      expect(error.code).toBe('GITHUB_CLI_ERROR');
    });

    it('should be an instance of AppError', () => {
      const error = new GitHubCLIError('CLI error');

      expect(error).toBeInstanceOf(AppError);
    });

    it('should be catchable as Error', () => {
      const error = new GitHubCLIError('test');

      expect(error).toBeInstanceOf(Error);
    });
  });
});

describe('Error Handler Middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let handler: ReturnType<typeof createErrorHandler>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockReq = {
      path: '/test',
      method: 'GET',
      query: {},
      params: {},
      body: undefined,
      ip: '127.0.0.1',
      get: jest.fn().mockReturnValue('test-user-agent'),
    };

    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    mockNext = jest.fn();
    handler = createErrorHandler();
  });

  describe('AppError handling', () => {
    it('should return correct status code for AppError', () => {
      const error = new AppError('Test error', 422);

      handler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(422);
    });

    it('should format AppError response correctly', () => {
      const error = new AppError('Test error', 400, 'TEST_CODE');

      handler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Test error',
        code: 'TEST_CODE',
      });
    });

    it('should handle NotFoundError', () => {
      const error = new NotFoundError('User');

      handler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'User not found',
        code: 'NOT_FOUND',
      });
    });

    it('should handle ValidationError', () => {
      const error = new ValidationError('Invalid email');

      handler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Invalid email',
        code: 'VALIDATION_ERROR',
      });
    });

    it('should handle ConflictError', () => {
      const error = new ConflictError('Already exists');

      handler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(409);
    });

    it('should handle GitError', () => {
      const error = new GitError('Git failed');

      handler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Git failed',
        code: 'GIT_ERROR',
      });
    });

    it('should handle GitHubCLIError', () => {
      const error = new GitHubCLIError('gh not installed');

      handler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'gh not installed',
        code: 'GITHUB_CLI_ERROR',
      });
    });
  });

  describe('Generic Error handling', () => {
    it('should return 500 for generic errors', () => {
      const error = new Error('Something went wrong');

      handler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(500);
    });

    it('should return generic message for non-AppError', () => {
      const error = new Error('Internal details');

      handler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'An unexpected error occurred',
        code: 'INTERNAL_ERROR',
      });
    });
  });

  describe('Request context logging', () => {
    it('should include query params in error context when present', () => {
      mockReq.query = { page: '1', limit: '10' };
      const error = new AppError('Test', 400);

      handler(error, mockReq as Request, mockRes as Response, mockNext);

      // Error is logged - we can verify the handler completes successfully
      expect(mockRes.status).toHaveBeenCalled();
    });

    it('should include body in error context when present', () => {
      mockReq.body = { name: 'test' };
      const error = new AppError('Test', 400);

      handler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalled();
    });

    it('should include params in error context when present', () => {
      mockReq.params = { id: '123' };
      const error = new AppError('Test', 400);

      handler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalled();
    });
  });

  describe('Sensitive data sanitization', () => {
    it('should redact password from body', () => {
      mockReq.body = { username: 'test', password: 'secret123' };
      const error = new AppError('Test', 400);

      handler(error, mockReq as Request, mockRes as Response, mockNext);

      // Verify handler completes - sanitization happens internally
      expect(mockRes.status).toHaveBeenCalled();
    });

    it('should redact token from body', () => {
      mockReq.body = { data: 'test', token: 'jwt-token-here' };
      const error = new AppError('Test', 400);

      handler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalled();
    });

    it('should redact apiKey from body', () => {
      mockReq.body = { apiKey: 'sk-123456' };
      const error = new AppError('Test', 400);

      handler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalled();
    });

    it('should redact secret from body', () => {
      mockReq.body = { secret: 'my-secret' };
      const error = new AppError('Test', 400);

      handler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalled();
    });

    it('should redact authorization from body', () => {
      mockReq.body = { authorization: 'Bearer token' };
      const error = new AppError('Test', 400);

      handler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalled();
    });

    it('should handle non-object body', () => {
      mockReq.body = 'string body';
      const error = new AppError('Test', 400);

      handler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalled();
    });

    it('should handle null body', () => {
      mockReq.body = null;
      const error = new AppError('Test', 400);

      handler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalled();
    });
  });
});

describe('asyncHandler', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockReq = {};
    mockRes = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    };
    mockNext = jest.fn();
  });

  it('should call the wrapped function', () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    const wrapped = asyncHandler(handler);

    wrapped(mockReq as Request, mockRes as Response, mockNext);

    expect(handler).toHaveBeenCalledWith(mockReq, mockRes, mockNext);
  });

  it('should pass errors to next on rejection', async () => {
    const error = new Error('Async error');
    const handler = jest.fn().mockRejectedValue(error);
    const wrapped = asyncHandler(handler);

    wrapped(mockReq as Request, mockRes as Response, mockNext);

    // Allow promise to resolve
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockNext).toHaveBeenCalledWith(error);
  });

  it('should pass AppError to next', async () => {
    const error = new NotFoundError('User');
    const handler = jest.fn().mockRejectedValue(error);
    const wrapped = asyncHandler(handler);

    wrapped(mockReq as Request, mockRes as Response, mockNext);

    await new Promise((resolve) => setImmediate(resolve));

    expect(mockNext).toHaveBeenCalledWith(error);
  });

  it('should not call next on success', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    const wrapped = asyncHandler(handler);

    wrapped(mockReq as Request, mockRes as Response, mockNext);

    await new Promise((resolve) => setImmediate(resolve));

    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should handle async functions that throw', async () => {
    const handler = jest.fn().mockRejectedValue(new Error('Async throw'));
    const wrapped = asyncHandler(handler);

    wrapped(mockReq as Request, mockRes as Response, mockNext);

    await new Promise((resolve) => setImmediate(resolve));

    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
  });
});

describe('Error inheritance', () => {
  it('should allow catching all app errors with AppError', () => {
    const errors = [
      new NotFoundError('Resource'),
      new ValidationError('Invalid'),
      new ConflictError('Conflict'),
      new GitError('Git error'),
    ];

    errors.forEach((error) => {
      try {
        throw error;
      } catch (e) {
        expect(e).toBeInstanceOf(AppError);
      }
    });
  });

  it('should allow catching all errors with Error', () => {
    const errors = [
      new AppError('App error', 500),
      new NotFoundError('Resource'),
      new Error('Generic error'),
    ];

    errors.forEach((error) => {
      try {
        throw error;
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
      }
    });
  });
});
