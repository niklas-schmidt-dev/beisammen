import * as Updates from 'expo-updates';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { createLogger } from '@/lib/logger';

const logger = createLogger('appConfig.ota');
const CHECK_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Checks for OTA updates on launch and whenever the app returns to the
 * foreground (throttled), and applies them without a manual restart:
 *
 * - An update found by the launch check reloads immediately; the user has
 *   barely seen the old bundle at that point.
 * - An update found later (foreground check) reloads the next time the app
 *   goes to the background, so nobody is interrupted mid-typing or
 *   mid-upload. Until then the app-config gate can offer a manual restart.
 */
export function useOtaUpdates(): void {
  const lastCheckAt = useRef(0);
  const reloadOnBackground = useRef(false);

  useEffect(() => {
    // Disabled in dev clients and local builds without an update URL.
    if (!Updates.isEnabled) {
      return;
    }

    let cancelled = false;
    let isLaunchCheck = true;

    const reload = async (reason: string) => {
      logger.info('Applying OTA update', { reason });

      try {
        await Updates.reloadAsync();
      } catch (error) {
        logger.warn('OTA reload failed, applies on next launch', { error });
      }
    };

    const check = async () => {
      const now = Date.now();
      const onLaunch = isLaunchCheck;
      isLaunchCheck = false;

      if (now - lastCheckAt.current < CHECK_INTERVAL_MS) {
        return;
      }

      lastCheckAt.current = now;

      try {
        const result = await Updates.checkForUpdateAsync();

        if (cancelled || !result.isAvailable) {
          return;
        }

        await Updates.fetchUpdateAsync();

        if (cancelled) {
          return;
        }

        if (onLaunch) {
          await reload('launch');
          return;
        }

        reloadOnBackground.current = true;
        logger.info('OTA update downloaded, applies when the app goes to the background');
      } catch (error) {
        logger.warn('OTA update check failed', { error });
      }
    };

    void check();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void check();
      } else if (state === 'background' && reloadOnBackground.current) {
        reloadOnBackground.current = false;
        void reload('background');
      }
    });

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);
}
