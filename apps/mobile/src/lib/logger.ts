import { appEnv } from '@/lib/env';
import { reportLoggedError } from '@/features/observe/log-errors';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'silent';
export type LogContext = Record<string, unknown>;

interface LogEntry {
  timestamp: string;
  level: Exclude<LogLevel, 'silent'>;
  namespace: string;
  message: string;
  context?: Record<string, unknown>;
}

interface LogSink {
  log: (entry: LogEntry) => void;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  silent: 60,
};

function normalizeLogLevel(value: string | undefined): LogLevel | null {
  switch (value?.trim().toLowerCase()) {
    case 'trace':
    case 'debug':
    case 'info':
    case 'warn':
    case 'error':
    case 'silent':
      return value.trim().toLowerCase() as LogLevel;
    default:
      return null;
  }
}

function resolveMinLevel(): LogLevel {
  const configured = normalizeLogLevel(appEnv.logLevel);
  if (configured) {
    return configured;
  }

  return __DEV__ ? 'trace' : 'info';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();

  return (
    normalized === 'token' ||
    normalized.endsWith('token') ||
    normalized === 'authorization' ||
    normalized === 'cookie' ||
    normalized.endsWith('cookie') ||
    normalized === 'authurl' ||
    normalized === 'callbackurl' ||
    normalized === 'downloadurl' ||
    normalized === 'signedurl' ||
    normalized === 'uploadurl' ||
    normalized === 'password' ||
    normalized.endsWith('password') ||
    normalized === 'secret' ||
    normalized.endsWith('secret')
  );
}

function serializeError(error: Error): Record<string, unknown> {
  return {
    name: error.name,
    message: error.message,
    stack: __DEV__ ? error.stack : undefined,
  };
}

function sanitizeValue(value: unknown, key?: string, depth = 0): unknown {
  if (
    key &&
    isSensitiveKey(key) &&
    value !== null &&
    typeof value !== 'boolean'
  ) {
    return '[REDACTED]';
  }

  if (value instanceof Error) {
    return serializeError(value);
  }

  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (value === undefined) {
    return undefined;
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (typeof value === 'function') {
    return `[Function ${value.name || 'anonymous'}]`;
  }

  if (depth >= 4) {
    return '[MaxDepth]';
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry, undefined, depth + 1));
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .map(([entryKey, entryValue]) => [
          entryKey,
          sanitizeValue(entryValue, entryKey, depth + 1),
        ])
        .filter(([, entryValue]) => entryValue !== undefined),
    );
  }

  return String(value);
}

function sanitizeContext(context: LogContext): Record<string, unknown> | undefined {
  const sanitized = sanitizeValue(context);

  if (!sanitized || !isPlainObject(sanitized)) {
    return undefined;
  }

  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function createConsoleSink(): LogSink {
  return {
    log(entry) {
      const prefix = `[${entry.timestamp}] ${entry.level.toUpperCase()} ${entry.namespace}: ${entry.message}`;
      const writer =
        entry.level === 'error'
          ? console.error
          : entry.level === 'warn'
            ? console.warn
            : entry.level === 'info'
              ? console.info
              : console.debug;

      if (entry.context) {
        writer(prefix, entry.context);
        return;
      }

      writer(prefix);
    },
  };
}

const loggerConfig = {
  enabled: true,
  minLevel: resolveMinLevel(),
  globalContext: {
    appEnv: appEnv.appEnv,
    dev: __DEV__,
  } satisfies LogContext,
  sinks: [createConsoleSink()] satisfies LogSink[],
};

function shouldLog(level: Exclude<LogLevel, 'silent'>): boolean {
  return (
    loggerConfig.enabled &&
    LOG_LEVELS[level] >= LOG_LEVELS[loggerConfig.minLevel]
  );
}

export interface Logger {
  child: (scope: string, context?: LogContext) => Logger;
  withContext: (context: LogContext) => Logger;
  trace: (message: string, context?: LogContext) => void;
  debug: (message: string, context?: LogContext) => void;
  info: (message: string, context?: LogContext) => void;
  warn: (message: string, context?: LogContext) => void;
  error: (message: string, context?: LogContext) => void;
}

class AppLogger implements Logger {
  constructor(
    private readonly namespace: string,
    private readonly baseContext: LogContext = {},
  ) {}

  child(scope: string, context: LogContext = {}): Logger {
    return new AppLogger(`${this.namespace}.${scope}`, {
      ...this.baseContext,
      ...context,
    });
  }

  withContext(context: LogContext): Logger {
    return new AppLogger(this.namespace, {
      ...this.baseContext,
      ...context,
    });
  }

  trace(message: string, context?: LogContext): void {
    this.write('trace', message, context);
  }

  debug(message: string, context?: LogContext): void {
    this.write('debug', message, context);
  }

  info(message: string, context?: LogContext): void {
    this.write('info', message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.write('warn', message, context);
  }

  error(message: string, context?: LogContext): void {
    this.write('error', message, context);
  }

  private write(
    level: Exclude<LogLevel, 'silent'>,
    message: string,
    context?: LogContext,
  ) {
    if (level === 'warn' || level === 'error') {
      reportLoggedError(this.namespace, message, { ...this.baseContext, ...context });
    }
    if (!shouldLog(level)) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      namespace: this.namespace,
      message,
      context: sanitizeContext({
        ...loggerConfig.globalContext,
        ...this.baseContext,
        ...context,
      }),
    };

    for (const sink of loggerConfig.sinks) {
      sink.log(entry);
    }
  }
}

export function createLogger(namespace: string, context?: LogContext): Logger {
  return new AppLogger(namespace, context);
}
