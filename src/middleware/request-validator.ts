import { Request, Response, NextFunction, RequestHandler } from 'express';
import { ValidationError } from '../utils/errors';

/**
 * Validation rules for common request parameters
 */

function checkNilValue(value: unknown, fieldName: string, required?: boolean): boolean {
  if (value !== undefined && value !== null) {
    return false;
  }

  if (required) {
    throw new ValidationError(`${fieldName} is required`);
  }

  return true;
}

function checkStringConstraints(str: string, fieldName: string, options?: {
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
  required?: boolean;
}): void {
  if (options?.required && str.length === 0) {
    throw new ValidationError(`${fieldName} cannot be empty`);
  }

  if (options?.minLength && str.length < options.minLength) {
    throw new ValidationError(`${fieldName} must be at least ${options.minLength} characters`);
  }

  if (options?.maxLength && str.length > options.maxLength) {
    throw new ValidationError(`${fieldName} must not exceed ${options.maxLength} characters`);
  }

  if (options?.pattern && !options.pattern.test(str)) {
    throw new ValidationError(`${fieldName} has invalid format`);
  }
}

function checkNumberConstraints(num: number, fieldName: string, options?: {
  min?: number;
  max?: number;
  integer?: boolean;
}): void {
  if (options?.integer && !Number.isInteger(num)) {
    throw new ValidationError(`${fieldName} must be an integer`);
  }

  if (options?.min !== undefined && num < options.min) {
    throw new ValidationError(`${fieldName} must be at least ${options.min}`);
  }

  if (options?.max !== undefined && num > options.max) {
    throw new ValidationError(`${fieldName} must not exceed ${options.max}`);
  }
}

// String validation
export function validateString(value: unknown, fieldName: string, options?: {
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
  required?: boolean;
}): string | undefined {
  if (checkNilValue(value, fieldName, options?.required)) {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw new ValidationError(`${fieldName} must be a string`);
  }

  const str = value.trim();
  checkStringConstraints(str, fieldName, options);
  return str;
}

// Number validation
export function validateNumber(value: unknown, fieldName: string, options?: {
  min?: number;
  max?: number;
  integer?: boolean;
  required?: boolean;
}): number | undefined {
  if (checkNilValue(value, fieldName, options?.required)) {
    return undefined;
  }

  const num = typeof value === 'string' ? parseFloat(value) : value;

  if (typeof num !== 'number' || isNaN(num)) {
    throw new ValidationError(`${fieldName} must be a valid number`);
  }

  checkNumberConstraints(num, fieldName, options);
  return num;
}

// Boolean validation
export function validateBoolean(value: unknown, fieldName: string, options?: {
  required?: boolean;
}): boolean | undefined {
  if (value === undefined || value === null) {
    if (options?.required) {
      throw new ValidationError(`${fieldName} is required`);
    }
    return undefined;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    if (value === 'true') return true;
    if (value === 'false') return false;
  }

  throw new ValidationError(`${fieldName} must be a boolean`);
}

// Array validation
export function validateArray<T>(
  value: unknown,
  fieldName: string,
  itemValidator?: (item: unknown, index: number) => T,
  options?: {
    minLength?: number;
    maxLength?: number;
    required?: boolean;
  }
): T[] | undefined {
  if (value === undefined || value === null) {
    if (options?.required) {
      throw new ValidationError(`${fieldName} is required`);
    }
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new ValidationError(`${fieldName} must be an array`);
  }

  if (options?.minLength && value.length < options.minLength) {
    throw new ValidationError(`${fieldName} must have at least ${options.minLength} items`);
  }

  if (options?.maxLength && value.length > options.maxLength) {
    throw new ValidationError(`${fieldName} must not exceed ${options.maxLength} items`);
  }

  if (itemValidator) {
    return value.map((item, index) => {
      try {
        return itemValidator(item, index);
      } catch (error) {
        throw new ValidationError(`${fieldName}[${index}]: ${error instanceof Error ? error.message : 'Invalid item'}`);
      }
    });
  }

  return value as T[];
}

// Common validation middleware factories

export function validateCreateProject(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const body = req.body as Record<string, unknown>;

      req.body = {
        name: validateString(body.name, 'name', { required: true, minLength: 1, maxLength: 100 }),
        path: validateString(body.path, 'path', { required: true, minLength: 1 }),
        createNew: validateBoolean(body.createNew, 'createNew'),
      };

      next();
    } catch (error) {
      next(error);
    }
  };
}

export function validateProjectId(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const projectId = validateString(req.params['id'], 'projectId', {
        required: true,
        pattern: /^[a-zA-Z0-9_-]+$/,
      });

      req.params['id'] = projectId!;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function validateNumericParam(paramName: string): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const value = validateNumber(req.params[paramName], paramName, {
        required: true,
        integer: true,
        min: 0,
      });

      req.params[paramName] = String(value);
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function validateQueryLimit(maxLimit = 1000): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const limit = validateNumber(req.query.limit, 'limit', {
        integer: true,
        min: 1,
        max: maxLimit,
      });

      req.query.limit = limit !== undefined ? String(limit) : undefined;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function validateRoadmapPrompt(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const body = req.body as Record<string, unknown>;

      req.body = {
        prompt: validateString(body['prompt'], 'prompt', { required: true, minLength: 1, maxLength: 10000 }),
      };

      next();
    } catch (error) {
      next(error);
    }
  };
}

export function validateDeleteTask(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const body = req.body as Record<string, unknown>;

      req.body = {
        phaseId: validateString(body['phaseId'], 'phaseId', { required: true }),
        milestoneId: validateString(body['milestoneId'], 'milestoneId', { required: true }),
        taskIndex: validateNumber(body['taskIndex'], 'taskIndex', {
          required: true,
          integer: true,
          min: 0,
        }),
      };

      next();
    } catch (error) {
      next(error);
    }
  };
}

export function validateAgentMessage(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const body = req.body as Record<string, unknown>;

      req.body = {
        message: validateString(body['message'], 'message', { minLength: 1, maxLength: 100000 }),
        images: validateArray(body['images'], 'images', (item) => {
          if (typeof item !== 'object' || !item) {
            throw new Error('Invalid image data');
          }
          const img = item as { mediaType: unknown; data: unknown };
          return {
            mediaType: validateString(img['mediaType'], 'mediaType', { required: true }),
            data: validateString(img['data'], 'data', { required: true }),
          };
        }),
        sessionId: validateString(body['sessionId'], 'sessionId', {
          pattern: /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,
        }),
        permissionMode: validateString(body['permissionMode'], 'permissionMode', {
          pattern: /^(acceptEdits|plan)$/,
        }),
      };

      next();
    } catch (error) {
      next(error);
    }
  };
}

export function validateModelUpdate(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const body = req.body as Record<string, unknown>;

      req.body = {
        model: validateString(body['model'], 'model'),
      };

      next();
    } catch (error) {
      next(error);
    }
  };
}