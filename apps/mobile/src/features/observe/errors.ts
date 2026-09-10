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

const ERROR_TYPES = new Set([
  'Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError',
  'EvalError', 'AggregateError',
]);

/**
 * Retain only generated bundle coordinates for EAS source-map symbolication.
 * Error headers, function names, native messages, URLs, paths and object data
 * can contain private content. Do not copy them, including Error.cause.
 */
export function sanitizeError(operation: ErrorOperation, original: unknown): Error {
  const safe = new Error(operation);
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
    if (frames.length) safe.stack = `${safe.name}: ${operation}\n${frames.join('\n')}`;
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

/** Bound memory and volume even when a broken subscription retries continuously. */
export function createErrorReporter(
  send: (error: Error) => void,
  enabled: () => boolean,
  now: () => number = Date.now,
) {
  const recent = new Map<string, number>();
  let windowStart = now();
  let count = 0;
  return (operation: ErrorOperation, original: unknown): void => {
    try {
      if (!enabled() || isExpectedCancellation(original)) return;
      const error = sanitizeError(operation, original);
      const time = now();
      if (time - windowStart >= 60_000 || time < windowStart) {
        windowStart = time;
        count = 0;
        recent.clear();
      }
      const fingerprint = `${error.name}:${operation}:${error.stack ?? ''}`;
      const last = recent.get(fingerprint);
      if (count >= 20 || (last !== undefined && time - last < 60_000)) return;
      recent.set(fingerprint, time);
      count += 1;
      send(error);
    } catch {
      // Diagnostics must never interrupt a user action or recursively log errors.
    }
  };
}

let sink: (operation: ErrorOperation, error: unknown) => void = () => {};

export function setErrorReportSink(next: typeof sink): void {
  sink = next;
}

export function reportAppError(operation: ErrorOperation, error: unknown): void {
  try { sink(operation, error); } catch { /* Best effort. */ }
}
