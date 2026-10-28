/**
 * Async Request Handler Wrapper
 * Eliminates boilerplate try-catch patterns in Express route handlers
 * Provides consistent error handling and response formatting
 */

import { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Extract error message from unknown caught value
 */
function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === 'string') {
    return err;
  }
  return 'An unknown error occurred';
}

/**
 * Options for asyncHandler behavior
 */
export interface AsyncHandlerOptions {
  /**
   * HTTP status code for errors (default: 500)
   */
  statusCode?: number;

  /**
   * Custom error response builder
   */
  errorResponseBuilder?: (err: unknown) => Record<string, any>;

  /**
   * Custom error logger
   */
  errorLogger?: (err: unknown, req: Request) => void;
}

/**
 * Wrap an async Express request handler to catch and handle errors
 * Eliminates the need for individual try-catch blocks in each route
 *
 * @param handler - The async request handler function
 * @param options - Optional configuration for error handling
 * @returns A wrapped RequestHandler that catches errors and responds consistently
 *
 * @example
 * router.post('/create-tasks', asyncHandler(async (req, res) => {
 *   const result = await useCase.execute(req.body);
 *   res.json({ success: true, data: result });
 * }));
 *
 * @example
 * router.get('/status', asyncHandler(
 *   async (req, res) => {
 *     const data = await deps.getStatus.execute();
 *     res.json({ success: true, data });
 *   },
 *   { statusCode: 503, errorLogger: customLogger }
 * ));
 */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
  options: AsyncHandlerOptions = {}
): RequestHandler {
  const {
    statusCode = 500,
    errorResponseBuilder,
    errorLogger,
  } = options;

  return (req: Request, res: Response, next: NextFunction) => {
    // Execute the handler and catch any errors
    Promise.resolve(handler(req, res, next)).catch((err: unknown) => {
      // Log error if custom logger provided
      if (errorLogger) {
        errorLogger(err, req);
      }

      // Build error response
      const errorResponse = errorResponseBuilder
        ? errorResponseBuilder(err)
        : {
            success: false,
            error: getErrorMessage(err),
          };

      // Send response with appropriate status code
      res.status(statusCode).json(errorResponse);
    });
  };
}

/**
 * Specialized wrapper for read-only handlers that should return 503 on error
 * Useful for health check endpoints that fail gracefully
 *
 * @param handler - The async request handler function
 * @param options - Optional configuration
 * @returns A wrapped RequestHandler
 *
 * @example
 * router.get('/ready', readyHandler(async (req, res) => {
 *   const status = await deps.getStatus.execute();
 *   if (!status.connected) {
 *     return res.status(503).json({ success: false, data: { status: 'unavailable' } });
 *   }
 *   res.json({ success: true, data: { status: 'ready' } });
 * }));
 */
export function readyHandler(
  handler: (req: Request, res: Response) => Promise<unknown>,
  options: AsyncHandlerOptions = {}
): RequestHandler {
  return asyncHandler(
    (req, res) => handler(req, res),
    {
      statusCode: 503,
      errorResponseBuilder: () => ({
        success: false,
        data: { status: 'unavailable', azureDevOpsConnected: false },
      }),
      ...options,
    }
  );
}

/**
 * Specialized wrapper for mutation handlers (POST, PUT, PATCH, DELETE)
 * Returns 400 for bad requests, 500 for server errors
 *
 * @param handler - The async request handler function
 * @param options - Optional configuration
 * @returns A wrapped RequestHandler
 *
 * @example
 * router.post('/create', mutationHandler(async (req, res) => {
 *   validateInput(req.body); // throws on invalid input
 *   const result = await useCase.execute(req.body);
 *   res.json({ success: true, data: result });
 * }));
 */
export function mutationHandler(
  handler: (req: Request, res: Response) => Promise<unknown>,
  options: AsyncHandlerOptions = {}
): RequestHandler {
  return asyncHandler(
    (req, res) => handler(req, res),
    {
      statusCode: 500,
      errorResponseBuilder: (err) => ({
        success: false,
        error: getErrorMessage(err),
      }),
      ...options,
    }
  );
}
