/**
 * Logger
 * Structured console logger with secret scrubbing and an in-memory ring buffer
 * for the web UI log stream.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'success';

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
}

type LogListener = (entry: LogEntry) => void;

class Logger {
  private verbose = false;
  private secrets: string[] = [];
  private recentLogs: LogEntry[] = [];
  private listeners: Set<LogListener> = new Set();
  private readonly maxRecent = 500;

  setVerbose(verbose: boolean): void {
    this.verbose = verbose;
  }

  registerSecret(secret: string): void {
    if (!secret) return;
    const trimmed = secret.trim();
    if (!trimmed) return;
    this.secrets.push(trimmed);
    // Also scrub the base64 encoding (used in the auth header)
    try {
      const b64 = Buffer.from(`:${trimmed}`).toString('base64');
      this.secrets.push(b64);
    } catch {
      // ignore
    }
  }

  private scrub(message: string): string {
    let out = message;
    for (const secret of this.secrets) {
      if (secret) out = out.split(secret).join('***');
    }
    return out;
  }

  private emit(level: LogLevel, message: string): void {
    const scrubbed = this.scrub(message);
    const entry: LogEntry = { level, message: scrubbed, timestamp: new Date().toISOString() };

    this.recentLogs.push(entry);
    if (this.recentLogs.length > this.maxRecent) {
      this.recentLogs = this.recentLogs.slice(-this.maxRecent);
    }

    for (const listener of this.listeners) {
      try {
        listener(entry);
      } catch {
        // ignore listener errors
      }
    }

    const line = `[${level.toUpperCase()}] ${scrubbed}`;
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  }

  debug(message: string): void {
    if (this.verbose) this.emit('debug', message);
  }
  info(message: string): void {
    this.emit('info', message);
  }
  warn(message: string): void {
    this.emit('warn', message);
  }
  error(message: string): void {
    this.emit('error', message);
  }
  success(message: string): void {
    this.emit('success', message);
  }
  raw(message: string): void {
    console.log(message);
  }

  getRecentLogs(limit?: number): LogEntry[] {
    if (limit && limit > 0) return this.recentLogs.slice(-limit);
    return [...this.recentLogs];
  }

  addListener(listener: LogListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const logger = new Logger();
