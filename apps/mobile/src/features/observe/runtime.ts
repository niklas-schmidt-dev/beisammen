import { AppMetrics, Observe, type ObserveConfig } from 'expo-observe';
import * as SecureStore from 'expo-secure-store';
import type { InstanceConfig } from '@beisammen/contracts';

import { createErrorReporter, sanitizeError, setErrorReportSink } from './errors';

const PURGE_KEY = 'beisammen.observe.purge';
const buildEnvironment = process.env.EXPO_PUBLIC_APP_ENV;
const environment = ['development', 'preview', 'store-sandbox', 'production'].includes(buildEnvironment ?? '')
  ? buildEnvironment
  : (__DEV__ ? 'development' : 'production');

// configure replaces the entire native config; always include the route filter.
const config: ObserveConfig = {
  environment,
  dispatchInDebug: false,
  sampleRate: 1,
  integrations: {
    'expo-router': {
      filteredParams: [
        'assetId', 'circleId', 'filterKey', 'instance', 'invite', 'memoryId', 'shareId',
        'token', 'url', 'email', 'code',
      ],
    },
  },
};

let enabled = false;
let blockedForSession = false;
let generation = 0;

type GlobalErrorHandler = (error: Error, isFatal?: boolean) => void;

export function isDefaultCloudInstance(instance: InstanceConfig, defaultInstance: InstanceConfig): boolean {
  return defaultInstance.deployment.kind === 'cloud'
    && instance.deployment.kind === 'cloud'
    && instance.instance.baseUrl === defaultInstance.instance.baseUrl;
}

/** Called by index.js before loading Expo Router or application modules. */
export function initializeObserve(previousHandler?: GlobalErrorHandler): void {
  // SDK 57.0.13 has no beforeSend/errorHandlingEnabled option. Replace its
  // auto-installed handler with sanitized capture, then call the original RN
  // handler with the ORIGINAL error so RedBox and fatal termination still work.
  // Keep this SDK-dependent adapter isolated; verify it on Observe upgrades.
  if (typeof ErrorUtils !== 'undefined') {
    ErrorUtils.setGlobalHandler((original, isFatal) => {
      try {
        if (!__DEV__) {
          const error = sanitizeError('app.unhandled', original);
          AppMetrics.reportError({
            source: 'global', type: error.name, message: error.message,
            stacktrace: error.stack, isFatal: isFatal ?? false,
          });
        }
      } catch {
        // Reporting failure must not replace the original exception.
      } finally {
        previousHandler?.(original, isFatal);
      }
    });
  }
  try {
    Observe.configure({ ...config, dispatchingEnabled: false });
  } catch { /* Leave manual reporting disabled if native configuration fails. */ }
  const handled = createErrorReporter((error) => Observe.reportError(error), () => enabled);
  // Root providers can fail before instance restoration. Retain that sanitized
  // error locally, like unhandled errors, for a subsequent eligible dispatch.
  const render = createErrorReporter((error) => Observe.reportError(error), () => !__DEV__);
  setErrorReportSink((operation, error) => {
    (operation === 'app.render' ? render : handled)(operation, error);
  });
}

/**
 * Enable only after restoring the actual default cloud instance. On any other
 * instance, stay disabled for this launch. A persisted marker makes the next
 * cloud launch discard pending self-hosted exports before enabling dispatch.
 */
export async function setObserveInstance(allowed: boolean): Promise<void> {
  const current = ++generation;
  if (!allowed) blockedForSession = true;
  enabled = false;
  try {
    Observe.configure({ ...config, dispatchingEnabled: false });
    if (!allowed) {
      SecureStore.setItem(PURGE_KEY, '1');
      return;
    }
    if (blockedForSession || __DEV__) return;
    if (SecureStore.getItem(PURGE_KEY)) {
      // SDK 57 clearStoredEntries is a no-op on iOS. A disabled dispatch drops
      // pending exports on both platforms without deleting the live session.
      // This runs on a fresh cloud launch, where native retry gates are reset.
      await Observe.dispatchEvents();
      if (current !== generation) return;
      // A synchronous marker update prevents a concurrent instance switch from
      // having its new purge marker erased by an older asynchronous deletion.
      SecureStore.setItem(PURGE_KEY, '');
    }
    if (current !== generation) return;
    Observe.configure({ ...config, dispatchingEnabled: true });
    enabled = true;
  } catch {
    // Fail closed if the instance/purge state or native SDK is unavailable.
  }
}
