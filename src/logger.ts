import { appendFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';

const levels = ['debug', 'info', 'warn', 'error'] as const;
type LogLevel = (typeof levels)[number];

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function normalizeLevel(value: string): LogLevel {
  return levels.includes(value.toLowerCase() as LogLevel)
    ? (value.toLowerCase() as LogLevel)
    : 'info';
}

function redact(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    const url = new URL(value);
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return value;
  }
}

export class Logger {
  private readonly minimumLevel: number;
  private readonly level: LogLevel;

  constructor(
    private readonly directory: string,
    configuredLevel = 'info',
    private readonly retentionDays = 30,
  ) {
    this.level = normalizeLevel(configuredLevel);
    this.minimumLevel = levels.indexOf(this.level);
  }

  async debug(
    message: string,
    fields?: Record<string, unknown>,
  ): Promise<void> {
    await this.write('debug', message, fields);
  }

  async info(message: string, fields?: Record<string, unknown>): Promise<void> {
    await this.write('info', message, fields);
  }

  async warn(message: string, fields?: Record<string, unknown>): Promise<void> {
    await this.write('warn', message, fields);
  }

  async error(
    message: string,
    fields?: Record<string, unknown>,
  ): Promise<void> {
    await this.write('error', message, fields);
  }

  private async write(
    level: LogLevel,
    message: string,
    fields?: Record<string, unknown>,
  ): Promise<void> {
    if (levels.indexOf(level) < this.minimumLevel) {
      return;
    }

    const redactedFields = Object.fromEntries(
      Object.entries(fields ?? {}).map(([key, value]) => [key, redact(value)]),
    );
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...redactedFields,
    };
    const line = JSON.stringify(entry);
    await mkdir(this.directory, { recursive: true });
    await appendFile(
      join(this.directory, `gexdis-${today()}.log`),
      `${line}\n`,
    );
    this.writeConsole(level, line);
    await this.removeExpiredFiles();
  }

  private writeConsole(level: LogLevel, line: string): void {
    if (level === 'error') {
      console.error(line);
    } else if (level === 'warn') {
      console.warn(line);
    } else if (level === 'info') {
      console.info(line);
    } else {
      console.debug(line);
    }
  }

  private async removeExpiredFiles(): Promise<void> {
    const entries = await readdir(this.directory, { withFileTypes: true });
    const cutoff = Date.now() - this.retentionDays * 24 * 60 * 60 * 1000;
    await Promise.all(
      entries
        .filter(
          (entry) =>
            entry.isFile() &&
            /^gexdis-\d{4}-\d{2}-\d{2}\.log$/.test(entry.name),
        )
        .filter(
          (entry) =>
            entry.name.slice(7, 17) <
            new Date(cutoff).toISOString().slice(0, 10),
        )
        .map((entry) => unlink(join(this.directory, entry.name))),
    );
  }
}
