/** Only these fixed operation names may leave the device. Never use user input here. */
export type ErrorOperation =
  | 'app.unhandled' | 'app.render'
  | 'media.picker' | 'media.upload' | 'media.upload_retry'
  | 'media.recovery_read' | 'media.recovery_write' | 'media.recovery_cleanup'
  | 'media.resolve' | 'media.video_load' | 'media.video_playback' | 'media.live_photo'
  | 'crypto.bootstrap' | 'crypto.keychain' | 'crypto.circle_key' | 'crypto.rotation'
  | 'billing.identify' | 'billing.sync'
  | 'auth.sign_out' | 'auth.cleanup'
  | 'notifications.register'
  | 'share.update' | 'share.delete' | 'share.publish';

/**
 * Structured, privacy-safe facts about a failure. Keys are fixed; values are
 * short machine tokens (pipeline stage, media kind, counters), never names,
 * paths, URLs or messages. Anything else is dropped by `sanitizeContext`.
 */
export type ErrorContextKey = 'stage' | 'kind' | 'count' | 'index' | 'attempt' | 'status';
export type ErrorContext = Partial<Record<ErrorContextKey, string | number | boolean>>;
export type ErrorAttributes = Record<string, string | number | boolean>;

const CONTEXT_KEYS: ReadonlySet<string> = new Set<ErrorContextKey>([
  'stage', 'kind', 'count', 'index', 'attempt', 'status',
]);
const TOKEN_PATTERN = /^[a-z0-9_.:-]{1,48}$/i;
// Expo module errors carry a machine code such as ERR_UNEXPECTED or ERR_FAILED_TO_READ_IMAGE.
const CODE_PATTERN = /^[A-Z][A-Z0-9_]{2,63}$/;
// Apple error domains keep their numeric code in the localized message, e.g.
// "PHPhotosErrorDomain-Fehler 3164." or "The operation couldn't be completed. (NSURLErrorDomain error -1009.)".
const NATIVE_DOMAIN_PATTERN = /\b([A-Za-z]{2,40}ErrorDomain)\b\D{0,24}?(-?\d{1,8})\b/;
// Our own upload client reports "S3 upload failed with status 403."
const HTTP_STATUS_PATTERN = /\bstatus (\d{3})\b/;

const ERROR_TYPES = new Set([
  'Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError',
  'EvalError', 'AggregateError',
]);

/**
 * Extract fixed machine identifiers from an error: the Expo/Convex error code,
 * an Apple error domain with its numeric code, and an HTTP status. These are
 * OS and SDK constants, never user content, so they may leave the device.
 */
export function describeError(original: unknown): ErrorAttributes {
  const details: ErrorAttributes = {};
  try {
    if (!original || typeof original !== 'object') return details;
    const { code, message } = original as { code?: unknown; message?: unknown };
    if (typeof code === 'string' && CODE_PATTERN.test(code)) details.code = code;
    const text = typeof message === 'string' ? message.slice(0, 2048) : '';
    const native = text.match(NATIVE_DOMAIN_PATTERN);
    if (native) details.native = `${native[1]}:${native[2]}`;
    const http = text.match(HTTP_STATUS_PATTERN);
    if (http) details.http = Number(http[1]);
  } catch {
    // Hostile getters must not break reporting.
  }
  return details;
}

export function sanitizeContext(context: ErrorContext | undefined): ErrorAttributes {
  const safe: ErrorAttributes = {};
  if (!context) return safe;
  try {
    for (const [key, value] of Object.entries(context)) {
      if (!CONTEXT_KEYS.has(key)) continue;
      if (typeof value === 'boolean') safe[key] = value;
      else if (typeof value === 'number' && Number.isFinite(value)) safe[key] = value;
      else if (typeof value === 'string' && TOKEN_PATTERN.test(value)) safe[key] = value;
    }
  } catch {
    // Ignore unreadable context.
  }
  return safe;
}

/** `media.upload (code=ERR_UNEXPECTED, native=PHPhotosErrorDomain:3164, stage=prepare)`. */
export function formatErrorMessage(operation: ErrorOperation, attributes: ErrorAttributes): string {
  const parts = Object.keys(attributes)
    .filter((key) => key !== 'operation')
    .sort()
    .map((key) => `${key}=${String(attributes[key])}`);
  return parts.length ? `${operation} (${parts.join(', ')})` : operation;
}

/**
 * Retain only generated bundle coordinates for EAS source-map symbolication,
 * plus the fixed identifiers from `describeError` and `sanitizeContext`.
 * Error headers, function names, native messages, URLs, paths and object data
 * can contain private content. Do not copy them, including Error.cause.
 */
export function sanitizeError(
  operation: ErrorOperation,
  original: unknown,
  context?: ErrorContext,
): Error & { attributes: ErrorAttributes } {
  const attributes: ErrorAttributes = {
    operation,
    ...sanitizeContext(context),
    ...describeError(original),
  };
  const safe = Object.assign(new Error(formatErrorMessage(operation, attributes)), { attributes });
  safe.stack = undefined;
  try {
    if (!(original instanceof Error)) return safe;
    safe.name = ERROR_TYPES.has(original.name) ? original.name : 'Error';
    const frames: string[] = [];
    for (const line of (original.stack ?? '').slice(0, 32_768).split('\n').slice(1, 65)) {
      // Hermes ("address at"), JSC (fn@url), and V8/RN (at fn (url)).
      const match = line.match(/(?:^|[\s/@(])((?:index(?:\.(?:ios|android))?\.bundle|main\.jsbundle|[a-f0-9-]{16,}\.js|(?:index|entry)\.js))(?:\?[^\s)]*)?:(\d{1,10}):(\d{1,10})\)?\s*$/i);
      if (!match) continue;
      const bundle = /^[a-f0-9-]{16,}\.js$/i.test(match[1]) ? 'index.bundle' : match[1];
      frames.push(`    at anonymous (${line.includes('address at ') ? 'address at ' : ''}${bundle}:${match[2]}:${match[3]})`);
      if (frames.length === 20) break;
    }
    if (frames.length) safe.stack = `${safe.name}: ${safe.message}\n${frames.join('\n')}`;
  } catch {
    // Even a thrown Proxy or an Error with hostile getters must be safe to report.
    safe.name = 'Error';
    safe.stack = undefined;
  }
  return safe;
}

export function isExpectedCancellation(error: unknown): boolean {
  try {
    return !!error && typeof error === 'object' && (
      ('name' in error && error.name === 'AbortError') ||
      ('userCancelled' in error && error.userCancelled === true)
    );
  } catch {
    return false;
  }
}

export type ErrorReporter = (operation: ErrorOperation, original: unknown, context?: ErrorContext) => void;

/** Bound memory and volume even when a broken subscription retries continuously. */
export function createErrorReporter(
  send: (error: Error, attributes: ErrorAttributes) => void,
  enabled: () => boolean,
  now: () => number = Date.now,
): ErrorReporter {
  const recent = new Map<string, number>();
  let windowStart = now();
  let count = 0;
  return (operation, original, context) => {
    try {
      if (!enabled() || isExpectedCancellation(original)) return;
      const error = sanitizeError(operation, original, context);
      const time = now();
      if (time - windowStart >= 60_000 || time < windowStart) {
        windowStart = time;
        count = 0;
        recent.clear();
      }
      // Distinct stages/codes of the same operation are distinct failures.
      const fingerprint = `${error.name}:${error.message}:${error.stack ?? ''}`;
      const last = recent.get(fingerprint);
      if (count >= 20 || (last !== undefined && time - last < 60_000)) return;
      recent.set(fingerprint, time);
      count += 1;
      send(error, error.attributes);
    } catch {
      // Diagnostics must never interrupt a user action or recursively log errors.
    }
  };
}

let sink: ErrorReporter = () => {};

export function setErrorReportSink(next: ErrorReporter): void {
  sink = next;
}

export function reportAppError(operation: ErrorOperation, error: unknown, context?: ErrorContext): void {
  try { sink(operation, error, context); } catch { /* Best effort. */ }
}
