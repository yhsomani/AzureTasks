/**
 * Atomic File Writer Utility
 * Provides safe atomic file writes with fsync and automatic cleanup on error.
 * Protects against partial writes and data corruption.
 */

import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'node:crypto';

export interface AtomicWriteOptions {
  /**
   * File mode/permissions (default: 0o666).
   * Use 0o600 for sensitive files like config/secrets.
   */
  mode?: number;

  /**
   * Encoding for text writes (default: 'utf-8')
   */
  encoding?: BufferEncoding;

  /**
   * Custom temp file suffix. Default generates UUID-based suffix.
   * Format: ${targetPath}.${suffix}.tmp
   */
  tempSuffix?: string;

  /**
   * Whether to create parent directories (default: true)
   */
  ensureDir?: boolean;
}

export class AtomicFileWriter {
  /**
   * Atomically write text content to a file.
   * Creates a temp file, writes with fsync, then renames atomically.
   * Cleans up temp file on error.
   *
   * @param targetPath - The final file path
   * @param content - The text content to write
   * @param options - Write options (mode, encoding, tempSuffix, ensureDir)
   * @throws Error if write fails (temp file is cleaned up)
   */
  static writeText(
    targetPath: string,
    content: string,
    options: AtomicWriteOptions = {}
  ): void {
    const {
      mode = 0o666,
      encoding = 'utf-8',
      tempSuffix = randomUUID(),
      ensureDir = true,
    } = options;

    const targetDir = path.dirname(targetPath);
    if (ensureDir) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const tempPath = `${targetPath}.${tempSuffix}.tmp`;
    let fd: number | undefined;

    try {
      fd = fs.openSync(tempPath, 'wx', mode);
      fs.writeFileSync(fd, content, encoding);
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      fs.renameSync(tempPath, targetPath);
    } catch (error) {
      // Clean up file descriptor if still open
      if (fd !== undefined) {
        try {
          fs.closeSync(fd);
        } catch {
          /* ignore cleanup error */
        }
      }

      // Clean up temp file
      try {
        fs.unlinkSync(tempPath);
      } catch {
        /* no temp file remains */
      }

      throw error;
    }
  }

  /**
   * Atomically write binary (Buffer) content to a file.
   * Creates a temp file, writes with fsync, then renames atomically.
   * Cleans up temp file on error.
   *
   * @param targetPath - The final file path
   * @param content - The buffer content to write
   * @param options - Write options (mode, tempSuffix, ensureDir)
   * @throws Error if write fails (temp file is cleaned up)
   */
  static writeBuffer(
    targetPath: string,
    content: Buffer,
    options: Omit<AtomicWriteOptions, 'encoding'> = {}
  ): void {
    const {
      mode = 0o666,
      tempSuffix = randomUUID(),
      ensureDir = true,
    } = options;

    const targetDir = path.dirname(targetPath);
    if (ensureDir) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const tempPath = `${targetPath}.${tempSuffix}.tmp`;
    let fd: number | undefined;

    try {
      fd = fs.openSync(tempPath, 'wx', mode);
      fs.writeFileSync(fd, content);
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      fs.renameSync(tempPath, targetPath);
    } catch (error) {
      // Clean up file descriptor if still open
      if (fd !== undefined) {
        try {
          fs.closeSync(fd);
        } catch {
          /* ignore cleanup error */
        }
      }

      // Clean up temp file
      try {
        fs.unlinkSync(tempPath);
      } catch {
        /* no temp file remains */
      }

      throw error;
    }
  }

  /**
   * Atomically write JSON data to a file.
   * Convenience method combining JSON.stringify with writeText.
   *
   * @param targetPath - The final file path
   * @param data - The data to stringify and write
   * @param options - Write options (mode, tempSuffix, ensureDir)
   * @param space - Indentation for JSON.stringify (default: 2)
   * @throws Error if write fails (temp file is cleaned up)
   */
  static writeJson(
    targetPath: string,
    data: unknown,
    options: AtomicWriteOptions = {},
    space: number | string = 2
  ): void {
    const content = JSON.stringify(data, null, space);
    this.writeText(targetPath, content, options);
  }

  /**
   * Safely rename a file to a target location with atomic semantics.
   * On most systems, renameSync is atomic. This wrapper provides
   * consistent error handling and can be extended for cross-filesystem support.
   *
   * @param sourcePath - The current file path
   * @param targetPath - The target file path
   * @throws Error if rename fails
   */
  static atomicRename(sourcePath: string, targetPath: string): void {
    try {
      fs.renameSync(sourcePath, targetPath);
    } catch (error) {
      throw new Error(
        `Failed to atomically rename "${sourcePath}" to "${targetPath}": ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Clean up a temporary file, suppressing errors if the file doesn't exist.
   * Useful for error handlers and finally blocks.
   *
   * @param tempPath - The path to clean up
   * @returns true if file was deleted, false if it didn't exist
   */
  static cleanupTemp(tempPath: string): boolean {
    try {
      fs.unlinkSync(tempPath);
      return true;
    } catch {
      return false;
    }
  }
}
