import { beforeEach, describe, expect, test, vi } from 'vitest';
import { buildClerkInstanceConfig } from '@beisammen/contracts';

const native = vi.hoisted(() => ({
  configure: vi.fn(), reportError: vi.fn(), reportGlobal: vi.fn(), dispatchEvents: vi.fn(), logEvent: vi.fn(),
  getItem: vi.fn(), setItem: vi.fn(),
}));
vi.mock('expo-observe', () => ({
  Observe: {
    configure: native.configure, reportError: native.reportError, dispatchEvents: native.dispatchEvents,
    logEvent: native.logEvent,
  },
  AppMetrics: { reportError: native.reportGlobal },
}));
vi.mock('expo-secure-store', () => ({ getItem: native.getItem, setItem: native.setItem }));

async function setup(dev = false) {
  vi.stubGlobal('__DEV__', dev);
  let handler: (error: Error, fatal?: boolean) => void = () => {};
  const previous = vi.fn();
  vi.stubGlobal('ErrorUtils', { setGlobalHandler: (next: typeof handler) => { handler = next; } });
  const runtime = await import('./runtime');
  runtime.initializeObserve(previous);
  const { reportAppError } = await import('./errors');
  return { ...runtime, reportAppError, previous, unhandled: (error: Error, fatal?: boolean) => handler(error, fatal) };
}

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

describe('Observe runtime', () => {
  test('waits for instance restoration, retains route filters and enables release reports', async () => {
    const app = await setup();
    app.reportAppError('media.upload', new Error('secret'));
    expect(native.reportError).not.toHaveBeenCalled();
    expect(native.configure).toHaveBeenLastCalledWith(expect.objectContaining({ dispatchingEnabled: false }));
    await app.setObserveInstance(true);
    app.reportAppError('media.upload', new Error('secret'), { stage: 'put' });
    expect(native.reportError).toHaveBeenCalledWith(expect.objectContaining({ message: 'media.upload (stage=put)' }));
    expect(native.logEvent).toHaveBeenCalledWith('app.error', {
      body: 'media.upload (stage=put)',
      attributes: { operation: 'media.upload', stage: 'put' },
      severity: 'error',
    });
    native.logEvent.mockImplementation(() => { throw new Error('native unavailable'); });
    expect(() => app.reportAppError('media.upload', new Error('secret'), { stage: 'complete' })).not.toThrow();
    expect(native.reportError).toHaveBeenCalledTimes(2);
    expect(native.configure).toHaveBeenLastCalledWith(expect.objectContaining({
      dispatchingEnabled: true, dispatchInDebug: false, sampleRate: 1,
      integrations: { 'expo-router': { filteredParams: expect.arrayContaining(['instance', 'invite', 'circleId']) } },
    }));
  });

  test('debug builds never dispatch or record custom errors', async () => {
    const app = await setup(true);
    await app.setObserveInstance(true);
    app.reportAppError('media.upload', new Error('secret'));
    app.unhandled(new Error('original'), false);
    expect(native.reportError).not.toHaveBeenCalled();
    expect(native.reportGlobal).not.toHaveBeenCalled();
    expect(native.configure.mock.calls.every(([config]) => !config.dispatchingEnabled)).toBe(true);
    expect(app.previous).toHaveBeenCalledOnce();
  });

  test('captures early render errors without exposing provider error details', async () => {
    const app = await setup();
    app.reportAppError('app.render', new Error('private bootstrap details'));
    expect(native.reportError).toHaveBeenCalledWith(expect.objectContaining({ message: 'app.render' }));
  });

  test('preserves original RN error/fatal behavior even if native reporting throws', async () => {
    const app = await setup();
    const original = new TypeError('private original');
    native.reportGlobal.mockImplementation(() => { throw new Error('SDK unavailable'); });
    expect(() => app.unhandled(original, true)).not.toThrow();
    expect(app.previous).toHaveBeenCalledWith(original, true);
    expect(native.reportGlobal).toHaveBeenCalledWith(expect.objectContaining({
      source: 'global', type: 'TypeError', message: 'app.unhandled', isFatal: true,
    }));
  });

  test('self-hosted switch disables immediately and stays disabled for this launch', async () => {
    const app = await setup();
    await app.setObserveInstance(true);
    const switching = app.setObserveInstance(false);
    app.reportAppError('media.upload', new Error('secret'));
    expect(native.reportError).not.toHaveBeenCalled();
    expect(native.configure).toHaveBeenLastCalledWith(expect.objectContaining({ dispatchingEnabled: false }));
    await switching;
    await app.setObserveInstance(true);
    expect(native.setItem).toHaveBeenCalledWith('beisammen.observe.purge', '1');
    expect(native.configure).toHaveBeenLastCalledWith(expect.objectContaining({ dispatchingEnabled: false }));
  });

  test('drops previous self-hosted pending exports while disabled before cloud resumes', async () => {
    const app = await setup();
    native.getItem.mockReturnValue('1');
    native.dispatchEvents.mockImplementation(async () => {
      expect(native.configure).toHaveBeenLastCalledWith(expect.objectContaining({ dispatchingEnabled: false }));
      app.reportAppError('media.upload', new Error('secret'));
      expect(native.reportError).not.toHaveBeenCalled();
    });
    await app.setObserveInstance(true);
    expect(native.dispatchEvents).toHaveBeenCalledOnce();
    expect(native.setItem).toHaveBeenCalledWith('beisammen.observe.purge', '');
    expect(native.configure).toHaveBeenLastCalledWith(expect.objectContaining({ dispatchingEnabled: true }));
  });

  test('an instance switch during a pending drop cannot re-enable dispatch or erase the marker', async () => {
    const app = await setup();
    native.getItem.mockReturnValue('1');
    let resolve!: () => void;
    native.dispatchEvents.mockReturnValue(new Promise<void>((done) => { resolve = done; }));
    const enabling = app.setObserveInstance(true);
    await app.setObserveInstance(false);
    resolve();
    await enabling;
    expect(native.setItem).not.toHaveBeenCalledWith('beisammen.observe.purge', '');
    expect(native.configure).toHaveBeenLastCalledWith(expect.objectContaining({ dispatchingEnabled: false }));
  });

  test('storage and dispatch failures leave reporting disabled', async () => {
    const app = await setup();
    native.getItem.mockImplementation(() => { throw new Error('locked keychain'); });
    await app.setObserveInstance(true);
    app.reportAppError('media.upload', new Error('secret'));
    expect(native.reportError).not.toHaveBeenCalled();
    native.getItem.mockReturnValue('1');
    native.dispatchEvents.mockRejectedValue(new Error('SDK unavailable'));
    await app.setObserveInstance(true);
    expect(native.configure).toHaveBeenLastCalledWith(expect.objectContaining({ dispatchingEnabled: false }));
    expect(native.setItem).not.toHaveBeenCalledWith('beisammen.observe.purge', '');
  });

  test('a custom server claiming cloud status is still excluded', async () => {
    const app = await setup();
    const cloud = buildClerkInstanceConfig({
      id: 'default', name: 'beisammen', baseUrl: 'https://cloud.example',
      convexUrl: 'https://example.convex.cloud', authPublishableKey: 'pk_test_example',
      deploymentKind: 'cloud', minimumAppVersion: '1.0.0',
    });
    expect(app.isDefaultCloudInstance(cloud, cloud)).toBe(true);
    expect(app.isDefaultCloudInstance({ ...cloud, instance: { ...cloud.instance, baseUrl: 'https://private.example' } }, cloud)).toBe(false);
    const selfHosted = { ...cloud, deployment: { ...cloud.deployment, kind: 'self-hosted' as const } };
    expect(app.isDefaultCloudInstance(selfHosted, selfHosted)).toBe(false);
  });
});
