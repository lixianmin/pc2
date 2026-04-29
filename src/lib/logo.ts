import fs from 'fs';
import path from 'path';

export enum LogLevel { Debug = 1, Info = 2, Warn = 3, Error = 4 }

const LEVEL_LABELS: Record<LogLevel, string> = {
  [LogLevel.Debug]: '[D]',
  [LogLevel.Info]: '[I]',
  [LogLevel.Warn]: '[W]',
  [LogLevel.Error]: '[E]',
};

export interface LogoOptions {
  logDir?: string;
  maxFileSize?: number;
  maxArchives?: number;
  console?: boolean;
  level?: LogLevel;
}

class RollingFileWriter {
  private writeCount = 0;
  // Check file size every N writes — avoids stat() on every write
  private readonly checkInterval = 100;

  constructor(
    private filePath: string,
    private maxFileSize: number,
    private maxArchives: number,
  ) {}

  write(line: string): void {
    fs.appendFileSync(this.filePath, line + '\n');
    this.writeCount++;
    if (this.writeCount % this.checkInterval === 0) {
      this.checkRolling();
    }
  }

  private checkRolling(): void {
    try {
      const stat = fs.statSync(this.filePath);
      if (stat.size >= this.maxFileSize) {
        this.roll();
      }
    } catch (e) {
      // Rolling check is best-effort; log errors but don't crash
      console.error('[logo] checkRolling error:', e);
    }
  }

  private roll(): void {
    const archiveDir = path.join(path.dirname(this.filePath), 'archive');
    fs.mkdirSync(archiveDir, { recursive: true });
    const baseName = path.basename(this.filePath, '.log');
    const date = formatArchiveDate();
    let seq = 1;
    while (fs.existsSync(path.join(archiveDir, `${baseName}${date}_${String(seq).padStart(3, '0')}.log`))) {
      seq++;
    }
    const archivePath = path.join(archiveDir, `${baseName}${date}_${String(seq).padStart(3, '0')}.log`);
    fs.renameSync(this.filePath, archivePath);
    this.cleanOldArchives(archiveDir, baseName);
    this.writeCount = 0;
  }

  private cleanOldArchives(archiveDir: string, baseName: string): void {
    const files = fs.readdirSync(archiveDir)
      .filter(f => f.startsWith(baseName))
      .sort();
    while (files.length > this.maxArchives) {
      const toDelete = files.shift()!;
      fs.unlinkSync(path.join(archiveDir, toDelete));
    }
  }

  close(): void {
    // appendFileSync is synchronous, so all writes are already flushed.
    // Just clear the writer map to prevent further writes.
  }
}

export function formatTimestamp(date: Date = new Date()): string {
  // UTC+8 offset in minutes (8 hours * 60)
  const offset = 8 * 60;
  const local = new Date(date.getTime() + offset * 60 * 1000 + date.getTimezoneOffset() * 60 * 1000);
  const y = local.getFullYear();
  const M = String(local.getMonth() + 1).padStart(2, '0');
  const d = String(local.getDate()).padStart(2, '0');
  const h = String(local.getHours()).padStart(2, '0');
  const m = String(local.getMinutes()).padStart(2, '0');
  const s = String(local.getSeconds()).padStart(2, '0');
  return `${y}-${M}-${d}T${h}:${m}:${s}`;
}

function formatArchiveDate(): string {
  const now = new Date();
  return now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace(/-/g, '');
}

export class Logo {
  private writers: Map<string, RollingFileWriter> = new Map();
  private initialized = false;
  private logDir = 'logs';
  // 10 MB — large enough for ~100K log lines, small enough to open quickly
  private maxFileSize = 10 * 1024 * 1024;
  // Keep last 5 archive files before deleting oldest
  private maxArchives = 5;
  private consoleEnabled = true;
  private level = LogLevel.Info;

  init(opts?: LogoOptions): void {
    if (opts?.logDir !== undefined) this.logDir = opts.logDir;
    if (opts?.maxFileSize !== undefined) this.maxFileSize = opts.maxFileSize;
    if (opts?.maxArchives !== undefined) this.maxArchives = opts.maxArchives;
    if (opts?.console !== undefined) this.consoleEnabled = opts.console;
    if (opts?.level !== undefined) this.level = opts.level;
    fs.mkdirSync(this.logDir, { recursive: true });
    this.initialized = true;
  }

  debug(msg: string, ...args: unknown[]): void {
    this.log(LogLevel.Debug, msg, args);
  }

  info(msg: string, ...args: unknown[]): void {
    this.log(LogLevel.Info, msg, args);
  }

  warn(msg: string, ...args: unknown[]): void {
    this.log(LogLevel.Warn, msg, args);
  }

  error(msg: string, ...args: unknown[]): void {
    this.log(LogLevel.Error, msg, args);
  }

  close(): void {
    for (const w of this.writers.values()) w.close();
    this.writers.clear();
  }

  private log(level: LogLevel, msg: string, args: unknown[]): void {
    if (level < this.level) return;
    if (!this.initialized) this.init();

    const timestamp = formatTimestamp();
    const caller = this.getCallerInfo();
    const label = LEVEL_LABELS[level];
    const serialized = args.map(a => {
      if (a === null) return 'null';
      if (a === undefined) return 'undefined';
      if (typeof a === 'object') {
        if (a instanceof Error) return a.message;
        return JSON.stringify(a);
      }
      return String(a);
    }).join(' ');
    const line = `${timestamp} ${caller.file}:${caller.line} ${label} ${msg}${serialized ? ' ' + serialized : ''}`;

    const files: string[] = [];
    if (level >= LogLevel.Error) files.push('error.log', 'warn.log', 'info.log');
    else if (level >= LogLevel.Warn) files.push('warn.log', 'info.log');
    else files.push('info.log');

    for (const f of files) {
      this.getWriter(f).write(line);
    }

    if (this.consoleEnabled) {
      process.stderr.write(line + '\n');
    }
  }

  private getWriter(filename: string): RollingFileWriter {
    let w = this.writers.get(filename);
    if (!w) {
      w = new RollingFileWriter(
        path.join(this.logDir, filename),
        this.maxFileSize,
        this.maxArchives,
      );
      this.writers.set(filename, w);
    }
    return w;
  }

  private getCallerInfo(): { file: string; line: number } {
    const err = new Error();
    const lines = err.stack?.split('\n') || [];
    for (const line of lines) {
      const match = line.match(/at .+ \((.+):(\d+):\d+\)/) ?? line.match(/at (.+):(\d+):\d+/);
      if (match) {
        const filePath = match[1];
        const lineNum = parseInt(match[2], 10);
        const file = path.basename(filePath);
        if (file !== 'logo.ts') {
          return { file, line: lineNum };
        }
      }
    }
    return { file: 'unknown', line: 0 };
  }
}

export const logo = new Logo();
