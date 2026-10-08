/**
 * Exponential backoff retry utility with jitter and Retry-After support.
 */

import { logger } from './logger.js';

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffFactor?: number;
  isRetryable?: (error: unknown) => boolean;
}

export class HttpError extends Error {
  public status: number;
  public statusText: string;
  public retryAfterSeconds?: number;
  public responseBody?: string;

  constructor(status: number, statusText: string, body?: string, retryAfter?: number) {
    super(`HTTP ${status} ${statusText}${body ? `: ${body}` : ''}`);
    this.name = 'HttpError';
    this.status = status;
    this.statusText = statusText;
    this.responseBody = body;
    this.retryAfterSeconds = retryAfter;
  }
}

export function isTransientError(error: unknown): boolean {
  if (error instanceof HttpError) {
    // 429 Too Many Requests, or 5xx Server Errors are transient
    if (error.status === 429 || (error.status >= 500 && error.status <= 599)) {
      return true;
    }
    // 400, 401, 403, 404 are permanent
    return false;
  }

  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    const transientCodes = ['econnreset', 'etimedout', 'econnrefused', 'eai_again', 'fetch failed'];
    return transientCodes.some(code => msg.includes(code));
  }

  return false;
}

export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  const initialDelayMs = options.initialDelayMs ?? 1000;
  const maxDelayMs = options.maxDelayMs ?? 15000;
  const backoffFactor = options.backoffFactor ?? 2;
  const isRetryable = options.isRetryable ?? isTransientError;

  let attempt = 0;

  while (true) {
    try {
      return await operation(attempt + 1);
    } catch (error) {
      attempt++;
      if (attempt > maxRetries || !isRetryable(error)) {
        throw error;
      }

      let delayMs = initialDelayMs * Math.pow(backoffFactor, attempt - 1);

      // Check for Retry-After header if HttpError
      if (error instanceof HttpError && error.retryAfterSeconds) {
        delayMs = Math.max(delayMs, error.retryAfterSeconds * 1000);
      }

      // Add jitter (+/- 20%)
      const jitter = delayMs * 0.2 * (Math.random() * 2 - 1);
      delayMs = Math.min(maxDelayMs, Math.max(100, delayMs + jitter));

      logger.warn(
        `Transient error detected on attempt ${attempt}/${maxRetries}. Retrying in ${(delayMs / 1000).toFixed(1)}s... Error: ${
          error instanceof Error ? error.message : String(error)
        }`
      );

      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}
