// =============================================================================
// FOUNDRY — Structured Logger
// JSON-based structured logging for production observability.
// =============================================================================

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  requestId?: string;
  founderId?: string;
  productId?: string;
  path?: string;
  method?: string;
  statusCode?: number;
  durationMs?: number;
  error?: {
    message: string;
    stack?: string;
    name?: string;
  };
  [key: string]: unknown;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const MIN_LEVEL = LOG_LEVELS[(process.env.LOG_LEVEL as LogLevel) ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug')];
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

function emit(entry: LogEntry): void {
  if (LOG_LEVELS[entry.level] < MIN_LEVEL) return;

  if (IS_PRODUCTION) {
    // Structured JSON for production log aggregation
    const output = JSON.stringify(entry);
    if (entry.level === 'error') {
      process.stderr.write(output + '\n');
    } else {
      process.stdout.write(output + '\n');
    }
  } else {
    // Human-readable for development
    const prefix = `[${entry.level.toUpperCase()}]`;
    const ctx = [
      entry.requestId ? `req=${entry.requestId}` : null,
      entry.founderId ? `founder=${entry.founderId}` : null,
      entry.path ? `${entry.method ?? ''} ${entry.path}` : null,
      entry.durationMs != null ? `${entry.durationMs}ms` : null,
    ]
      .filter(Boolean)
      .join(' ');

    const line = ctx ? `${prefix} ${entry.message} (${ctx})` : `${prefix} ${entry.message}`;

    if (entry.level === 'error') {
      console.error(line);
      if (entry.error?.stack) console.error(entry.error.stack);
    } else if (entry.level === 'warn') {
      console.warn(line);
    } else {
      console.log(line);
    }
  }
}

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, error?: unknown, meta?: Record<string, unknown>): void;
  child(defaults: Record<string, unknown>): Logger;
}

function serializeError(err: unknown): LogEntry['error'] | undefined {
  if (!err) return undefined;
  if (err instanceof Error) {
    return { message: err.message, stack: err.stack, name: err.name };
  }
  return { message: String(err) };
}

export function createLogger(defaults: Record<string, unknown> = {}): Logger {
  return {
    debug(message, meta) {
      emit({ level: 'debug', message, timestamp: new Date().toISOString(), ...defaults, ...meta });
    },
    info(message, meta) {
      emit({ level: 'info', message, timestamp: new Date().toISOString(), ...defaults, ...meta });
    },
    warn(message, meta) {
      emit({ level: 'warn', message, timestamp: new Date().toISOString(), ...defaults, ...meta });
    },
    error(message, err, meta) {
      emit({
        level: 'error',
        message,
        timestamp: new Date().toISOString(),
        error: serializeError(err),
        ...defaults,
        ...meta,
      });
    },
    child(childDefaults) {
      return createLogger({ ...defaults, ...childDefaults });
    },
  };
}

/** Root application logger */
export const log = createLogger({ service: 'foundry' });
