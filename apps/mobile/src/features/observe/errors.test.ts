import { describe, expect, test, vi } from 'vitest';
import { createErrorReporter, sanitizeError } from './errors';

describe('safe Observe errors', () => {
  test('removes private data while preserving Hermes source-map coordinates', () => {
    const error = new TypeError('Could not decrypt anna@example.com: recovery-secret');
    error.stack = [
      error.toString(),
      '    at privateCaption (address at /private/user-id/main.jsbundle:1:481231)',
      '    at signedDownload (https://private.example/index.ios.bundle?token=secret:7:42)',
      'privateName@https://private.example/index.android.bundle:3:23',
      '    at nativeFailure (/private/photo-name.jpg:2:14)',
    ].join('\n');
    const safe = sanitizeError('media.upload', error);
    expect(safe.message).toBe('media.upload');
    expect(safe.name).toBe('TypeError');
    expect(safe.stack).toBe([
      'TypeError: media.upload',
      '    at anonymous (address at main.jsbundle:1:481231)',
      '    at anonymous (index.ios.bundle:7:42)',
      '    at anonymous (index.android.bundle:3:23)',
    ].join('\n'));
    expect(error.message).toContain('recovery-secret');
  });

  test.each(['private string', { token: 'private', stack: 'private' }, null, 42])(
    'never stringifies a non-Error (%j) or invents a reporter stack', (original) => {
      const safe = sanitizeError('crypto.bootstrap', original);
      expect(safe.message).toBe('crypto.bootstrap');
      expect(safe.stack).toBeUndefined();
    },
  );

  test('custom names, causes, multiline messages and hostile getters stay local', () => {
    const original = new Error('line one\nsecret', { cause: { key: 'private' } });
    original.name = 'private@example.com';
    Object.defineProperty(original, 'stack', { get() { throw new Error('private'); } });
    const safe = sanitizeError('crypto.bootstrap', original);
    expect(safe.name).toBe('Error');
    expect(safe.message).toBe('crypto.bootstrap');
    expect(safe.stack).toBeUndefined();
    expect(safe.cause).toBeUndefined();
    expect(() => sanitizeError('app.unhandled', new Proxy({}, { getPrototypeOf() { throw 1; } }))).not.toThrow();
  });

  test('ignores cancellations and repeated failures; permits distinct source locations', () => {
    const send = vi.fn();
    const report = createErrorReporter(send, () => true);
    report('media.upload', Object.assign(new Error('cancel'), { name: 'AbortError' }));
    report('billing.sync', { userCancelled: true });
    for (const column of [100, 100, 200]) {
      const error = new Error('different private details');
      error.stack = `Error: hidden\n    at a (address at index.android.bundle:1:${column})`;
      report('media.upload', error);
    }
    expect(send).toHaveBeenCalledTimes(2);
  });

  test('limits a burst of distinct failures and resumes in the next minute', () => {
    let time = 100;
    const send = vi.fn();
    const report = createErrorReporter(send, () => true, () => time);
    for (let column = 0; column < 100; column++) {
      const error = new Error('secret');
      error.stack = `Error: hidden\n    at a (index.bundle:1:${column})`;
      report('media.upload', error);
    }
    expect(send).toHaveBeenCalledTimes(20);
    time += 60_000;
    report('media.upload', new Error('secret'));
    expect(send).toHaveBeenCalledTimes(21);
  });

  test('disabled reporting and failing transports never affect the caller', () => {
    const send = vi.fn(() => { throw new Error('transport failed'); });
    createErrorReporter(send, () => false)('media.upload', new Error('private'));
    expect(send).not.toHaveBeenCalled();
    expect(() => createErrorReporter(send, () => true)('media.upload', new Error('private'))).not.toThrow();
  });
});
