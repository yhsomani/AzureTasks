/**
 * Safe, structured logger with strict credential scrubbing and standard log levels.
 */

export type LogLevel = 'INFO' | 'SUCCESS' | 'WARN' | 'ERROR' | 'SKIP' | 'DEBUG';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
}

class Logger {
  private secrets: Set<string> = new Set();
  private isVerbose: boolean = false;
  private listeners: Array<(entry: LogEntry) => void> = [];
  private logBuffer: LogEntry[] = [];
  private readonly maxBufferSize: number = 300;

  public registerSecret(secret?: string): void {
    if (secret && secret.trim().length >= 4) {
      this.secrets.add(secret.trim());
    }
  }

  public setVerbose(verbose: boolean): void {
    this.isVerbose = verbose;
  }

  public sanitize(text: string): string {
    let sanitized = text;
    for (const secret of this.secrets) {
      // Replace literal occurrences
      sanitized = sanitized.split(secret).join('***REDACTED***');
      // Also redact base64-encoded basic auth variants if present
      const base64Variant = Buffer.from(`:${secret}`).toString('base64');
      sanitized = sanitized.split(base64Variant).join('***REDACTED_AUTH***');
    }
    // Also scrub any bearer or basic auth headers in raw strings
    sanitized = sanitized.replace(/Authorization:\s*Basic\s+[A-Za-z0-9+/=]+/gi, 'Authorization: Basic ***REDACTED***');
    sanitized = sanitized.replace(/Authorization:\s*Bearer\s+[A-Za-z0-9._-]+/gi, 'Authorization: Bearer ***REDACTED***');
    return sanitized;
  }

  public addListener(listener: (entry: LogEntry) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  public getRecentLogs(limit = 100): LogEntry[] {
    return this.logBuffer.slice(-Math.min(limit, this.maxBufferSize));
  }

  public clearBuffer(): void {
    this.logBuffer = [];
  }

  private record(level: LogLevel, message: string): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message: this.sanitize(message),
    };

    this.logBuffer.push(entry);
    if (this.logBuffer.length > this.maxBufferSize) {
      this.logBuffer.shift();
    }

    for (const listener of this.listeners) {
      try {
        listener(entry);
      } catch {
        // Listener error should not affect logging
      }
    }
  }

  private formatMessage(level: LogLevel, message: string): string {
    const cleanMessage = this.sanitize(message);
    const colorReset = '\x1b[0m';
    let colorPrefix = '';

    switch (level) {
      case 'INFO':
        colorPrefix = '\x1b[36m'; // Cyan
        break;
      case 'SUCCESS':
        colorPrefix = '\x1b[32m'; // Green
        break;
      case 'WARN':
        colorPrefix = '\x1b[33m'; // Yellow
        break;
      case 'ERROR':
        colorPrefix = '\x1b[31m'; // Red
        break;
      case 'SKIP':
        colorPrefix = '\x1b[35m'; // Magenta
        break;
      case 'DEBUG':
        colorPrefix = '\x1b[90m'; // Gray
        break;
    }

    return `${colorPrefix}[${level}]${colorReset} ${cleanMessage}`;
  }

  public info(message: string): void {
    this.record('INFO', message);
    console.log(this.formatMessage('INFO', message));
  }

  public success(message: string): void {
    this.record('SUCCESS', message);
    console.log(this.formatMessage('SUCCESS', message));
  }

  public warn(message: string): void {
    this.record('WARN', message);
    console.warn(this.formatMessage('WARN', message));
  }

  public error(message: string, error?: unknown): void {
    let fullMsg = message;
    if (error) {
      if (error instanceof Error && error.stack) {
        fullMsg += ` | ${error.stack}`;
      } else {
        fullMsg += ` | ${String(error)}`;
      }
    }
    this.record('ERROR', fullMsg);
    console.error(this.formatMessage('ERROR', message));
    if (error) {
      if (error instanceof Error && error.stack) {
        console.error(this.sanitize(error.stack));
      } else {
        console.error(this.sanitize(String(error)));
      }
    }
  }

  public skip(message: string): void {
    this.record('SKIP', message);
    console.log(this.formatMessage('SKIP', message));
  }

  public debug(message: string): void {
    if (this.isVerbose) {
      this.record('DEBUG', message);
      console.log(this.formatMessage('DEBUG', message));
    }
  }

  public raw(message: string): void {
    console.log(this.sanitize(message));
  }
}

export const logger = new Logger();
