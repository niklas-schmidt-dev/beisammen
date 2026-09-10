import { beforeEach, expect, test, vi } from 'vitest';

vi.mock('@/lib/env', () => ({ appEnv: { appEnv: 'production', logLevel: 'silent' } }));

beforeEach(() => { vi.stubGlobal('__DEV__', false); });

test('selected caught failures report independently of console level; context and ordinary auth failures stay local', async () => {
  const { setErrorReportSink, createErrorReporter } = await import('./errors');
  const { createLogger } = await import('@/lib/logger');
  const send = vi.fn();
  setErrorReportSink(createErrorReporter(send, () => true));
  const error = new Error('https://private.example?token=secret');
  createLogger('media.shareUpload', { circleId: 'private-circle' }).warn('Upload item failed', {
    error, fileName: 'private.jpg', email: 'anna@example.com',
  });
  createLogger('auth.sign-in').error('Password auth failed', { error });
  createLogger('media.shareUpload').warn('Unreviewed private message', { error });
  expect(send).toHaveBeenCalledOnce();
  expect(send.mock.calls[0][0].message).toBe('media.upload');
  expect(JSON.stringify(send.mock.calls)).not.toMatch(/private|secret|anna/);
});

test('fixed pipeline facts from the log context are forwarded as attributes', async () => {
  const { setErrorReportSink, createErrorReporter } = await import('./errors');
  const { createLogger } = await import('@/lib/logger');
  const send = vi.fn();
  setErrorReportSink(createErrorReporter(send, () => true));
  const error = Object.assign(new Error('(PHPhotosErrorDomain-Fehler 3164.)'), { code: 'ERR_UNEXPECTED' });
  createLogger('media.shareUpload').warn('Upload item failed', {
    error, fileName: 'private.jpg', stage: 'prepare', kind: 'video', index: 7, count: 30,
  });
  expect(send).toHaveBeenCalledOnce();
  expect(send.mock.calls[0][1]).toEqual({
    operation: 'media.upload', stage: 'prepare', kind: 'video', index: 7, count: 30,
    code: 'ERR_UNEXPECTED', native: 'PHPhotosErrorDomain:3164',
  });
  expect(JSON.stringify(send.mock.calls)).not.toMatch(/private/);
});
