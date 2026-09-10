import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useLocale, useMessages } from 'gt-react-native';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { useConvexAuth, useMutation, useQuery } from 'convex/react';

import { useSession } from '@/features/auth/session-provider';
import { api } from '@/features/convex/api';
import { recordClientDiagnostic } from '@/features/diagnostics/buffer';
import { appEnv } from '@/lib/env';
import { createLogger } from '@/lib/logger';

import { ensureNotificationChannels } from './channels';
import { resolveNotificationNavigation } from './navigation';
import {
  pushRegistrationReadiness,
  resolveExpoProjectId,
  type PushRegistrationPlatform,
} from './push-registration';
import { setPushDeviceUnregisterHandler } from './registration-runtime';

const logger = createLogger('notifications');
const missingProjectIdWarningKeys = new Set<string>();

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

function notificationPlatform(): PushRegistrationPlatform {
  switch (Platform.OS) {
    case 'ios':
    case 'android':
    case 'web':
      return Platform.OS;
    default:
      return 'unknown';
  }
}

function readExpoProjectId(): string | undefined {
  return resolveExpoProjectId({
    easConfig: Constants.easConfig,
    expoConfig: Constants.expoConfig,
  });
}

function logRegistrationSkip(input: {
  instanceUrl: string;
  platform: PushRegistrationPlatform;
  reason: 'web' | 'simulator' | 'missing_project_id' | 'unsupported_platform';
}) {
  if (input.reason === 'missing_project_id') {
    const warningKey = `${input.platform}:${input.instanceUrl}`;

    if (missingProjectIdWarningKeys.has(warningKey)) {
      return;
    }

    missingProjectIdWarningKeys.add(warningKey);
    logger.warn('Push notification registration skipped because Expo project ID is missing', {
      instanceUrl: input.instanceUrl,
      platform: input.platform,
    });
    recordClientDiagnostic(
      'notification_registration',
      'Expo project ID is missing for push registration',
      {
        instanceUrl: input.instanceUrl,
        platform: input.platform,
      },
    );
    return;
  }

  logger.debug('Push notification registration skipped', {
    instanceUrl: input.instanceUrl,
    platform: input.platform,
    reason: input.reason,
  });
}

async function requestExpoPushToken(input: {
  instanceUrl: string;
  locale: string;
  translate: (message: string) => string;
}): Promise<string | null> {
  const platform = notificationPlatform();
  const readiness = pushRegistrationReadiness({
    isDevice: Device.isDevice,
    platform,
    projectId: readExpoProjectId(),
  });

  if (!readiness.canRegister) {
    logRegistrationSkip({
      instanceUrl: input.instanceUrl,
      platform,
      reason: readiness.reason,
    });
    return null;
  }

  // Channels must exist before the first notification arrives; Android
  // drops messages addressed to an unknown channelId onto the default one.
  await ensureNotificationChannels({ locale: input.locale, translate: input.translate });

  const existingPermission = await Notifications.getPermissionsAsync();
  const finalPermission =
    existingPermission.status === 'granted'
      ? existingPermission
      : await Notifications.requestPermissionsAsync();

  if (finalPermission.status !== 'granted') {
    recordClientDiagnostic('notification_registration', 'Notification permission was not granted', {
      status: finalPermission.status,
    });
    return null;
  }

  const token = await Notifications.getExpoPushTokenAsync({
    projectId: readiness.projectId,
  });

  return token.data;
}

/**
 * Keeps the app icon badge equal to the unread activity count. The server
 * sends the same number with each push; this covers the other direction
 * (items read in-app or on another device) so the badge never goes stale.
 */
function useAppIconBadgeSync(enabled: boolean) {
  const summary = useQuery(api.activity.summaryForViewer, enabled ? {} : 'skip');
  const unreadCount = enabled ? summary?.unreadCount : undefined;

  useEffect(() => {
    if (unreadCount === undefined || Platform.OS === 'web') {
      return;
    }

    void Notifications.setBadgeCountAsync(unreadCount).catch((error) => {
      logger.debug('Failed to sync app icon badge', { error });
    });
  }, [unreadCount]);
}

export function usePushNotifications() {
  const router = useRouter();
  const locale = useLocale();
  const translate = useMessages();
  const { instance, session } = useSession();
  const convexAuth = useConvexAuth();
  const registerDevice = useMutation(api.notifications.registerDevice);
  const unregisterDevice = useMutation(api.notifications.unregisterDevice);
  const lastRegistrationKeyRef = useRef<string | null>(null);
  const registeredDeviceRef = useRef<{ instanceUrl: string; token: string } | null>(null);
  const activeInstanceUrl = instance.instance.baseUrl;
  const activeInstanceUrlRef = useRef(activeInstanceUrl);
  activeInstanceUrlRef.current = activeInstanceUrl;

  useAppIconBadgeSync(Boolean(session) && convexAuth.isAuthenticated);

  useEffect(() => {
    const handledResponseIds = new Set<string>();

    function handleResponse(response: Notifications.NotificationResponse): boolean {
      const responseId = response.notification.request.identifier;

      if (handledResponseIds.has(responseId)) {
        return false;
      }

      handledResponseIds.add(responseId);
      const navigation = resolveNotificationNavigation(
        response.notification.request.content.data as Record<string, unknown> | undefined,
        { activeInstanceUrl: activeInstanceUrlRef.current },
      );

      switch (navigation.kind) {
        case 'navigate':
          router.push(navigation.href as never);
          return true;
        case 'wrong_instance':
          // The share lives on a backend this device is no longer connected
          // to; the activity tab is the closest safe landing spot.
          logger.info('Notification belongs to another instance', {
            instanceUrl: navigation.instanceUrl,
          });
          router.push('/activity' as never);
          return true;
        case 'ignore':
          return false;
      }
    }

    function clearLastResponse() {
      void Notifications.clearLastNotificationResponseAsync().catch((error) => {
        logger.warn('Failed to clear last notification response', { error });
      });
    }

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      if (handleResponse(response)) {
        clearLastResponse();
      }
    });

    void Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (response && handleResponse(response)) {
          clearLastResponse();
        }
      })
      .catch((error) => {
        logger.warn('Failed to read last notification response', { error });
      });

    return () => {
      subscription.remove();
    };
  }, [router]);

  useEffect(() => {
    return setPushDeviceUnregisterHandler(async () => {
      const registration = registeredDeviceRef.current;

      if (!registration) {
        return;
      }

      await unregisterDevice({
        instanceUrl: registration.instanceUrl,
        token: registration.token,
      });
      registeredDeviceRef.current = null;
      lastRegistrationKeyRef.current = null;
      await Notifications.setBadgeCountAsync(0).catch(() => undefined);
    });
  }, [unregisterDevice]);

  useEffect(() => {
    if (!session || !convexAuth.isAuthenticated) {
      lastRegistrationKeyRef.current = null;
      return;
    }

    const instanceUrl = activeInstanceUrl;
    // Re-register when the language changes so the server renders push copy
    // in the language the user actually reads.
    const registrationKey = `${instanceUrl}:${session.subject}:${locale}`;

    if (lastRegistrationKeyRef.current === registrationKey) {
      return;
    }

    let isCancelled = false;
    lastRegistrationKeyRef.current = registrationKey;

    async function register() {
      try {
        const token = await requestExpoPushToken({ instanceUrl, locale, translate });

        if (!token || isCancelled) {
          return;
        }

        await registerDevice({
          instanceUrl,
          token,
          platform: notificationPlatform(),
          appVersion: appEnv.appVersion,
          locale,
        });
        registeredDeviceRef.current = { instanceUrl, token };
        logger.info('Registered push notification device', {
          instanceUrl,
          platform: notificationPlatform(),
          locale,
        });
      } catch (error) {
        lastRegistrationKeyRef.current = null;
        logger.warn('Push notification registration failed', {
          instanceUrl,
          error,
        });
        recordClientDiagnostic('notification_registration', 'Push registration failed', {
          instanceUrl,
          error,
        });
      }
    }

    void register();

    return () => {
      isCancelled = true;
    };
  }, [activeInstanceUrl, convexAuth.isAuthenticated, locale, registerDevice, session, translate]);
}
