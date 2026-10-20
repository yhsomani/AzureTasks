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

export class Logger {
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
    this.secrets.push(`token ${trimmed}`);
    this.secrets.push(`Bearer ${trimmed}`);
    // Also scrub base64 encodings (used in auth headers)
    try {
      this.secrets.push(Buffer.from(trimmed).toString('base64'));
      this.secrets.push(Buffer.from(`:${trimmed}`).toString('base64'));
      this.secrets.push(Buffer.from(`admin:${trimmed}`).toString('base64'));
    } catch {
      // ignore
    }
    // Sort longer patterns first to prevent partial token scrubbing
    this.secrets.sort((a, b) => b.length - a.length);

    // Retroactively scrub existing in-memory buffer
    for (const entry of this.recentLogs) {
      entry.message = this.scrub(entry.message);
    }
  }

  sanitize(message: string): string {
    return this.scrub(message);
  }

  mask(secret: string): string {
    if (!secret) return '';
    return this.scrub(secret);
  }

  private scrub(message: string): string {
    let out = message;

    // 1. Exact-match registered secrets (including base64 encodings)
    for (const secret of this.secrets) {
      if (secret) out = out.split(secret).join('***');
    }

    // 2. Pattern-based regex scrubbing for standard credentials and authorization headers
    // Bearer tokens
    out = out.replace(/\bBearer\s+[A-Za-z0-9_\-.]+/gi, 'Bearer ***');

    // HTTP Basic Authorization headers (e.g. Azure DevOps base64 PAT credentials)
    out = out.replace(/\bBasic\s+[A-Za-z0-9+/=]{10,}/gi, 'Basic ***');

    // GitHub classic Personal Access Tokens (ghp_ prefix + 36 alphanumeric characters)
    out = out.replace(/\bghp_[A-Za-z0-9]{36}\b/g, '***');

    // GitHub fine-grained Personal Access Tokens (github_pat_ prefix + 82 chars)
    out = out.replace(/\bgithub_pat_[A-Za-z0-9_]{82}\b/g, '***');

    // Azure DevOps Personal Access Tokens (standard 52-char base32 / alphanumeric format)
    out = out.replace(/\b[a-z2-7]{52}\b/gi, '***');
    out = out.replace(/\b[A-Za-z0-9]{52}\b/g, '***');

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
    // Even unformatted CLI output must never bypass registered secret
    // scrubbing; external API error bodies can echo Authorization values.
    console.log(this.scrub(message));
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
