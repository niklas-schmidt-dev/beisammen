import * as Notifications from 'expo-notifications';
import { msg } from 'gt-react-native';
import { Platform } from 'react-native';

import { Colors } from '@/constants/theme';
import { createLogger } from '@/lib/logger';

const logger = createLogger('notifications.channels');

export type NotificationChannelId = 'shares' | 'engagement' | 'circle';

/**
 * Android notification channels. Ids must match convex/lib/notifications.ts
 * (`NOTIFICATION_CHANNELS`); the server picks the channel per notification
 * kind and Android lets users mute each channel independently in system
 * settings. Names are shown in those system settings, so they are translated
 * with the app UI; re-running only updates the metadata of existing channels.
 */
export const NOTIFICATION_CHANNEL_DEFINITIONS: Array<{
  id: NotificationChannelId;
  name: string;
  description: string;
  importance: Notifications.AndroidImportance;
}> = [
  {
    id: 'shares',
    name: msg('Neue Beiträge'),
    description: msg('Fotos und Videos, die in deinen Circles geteilt werden.'),
    importance: Notifications.AndroidImportance.HIGH,
  },
  {
    id: 'engagement',
    name: msg('Kommentare und Reaktionen'),
    description: msg('Antworten und Reaktionen auf Beiträge.'),
    importance: Notifications.AndroidImportance.DEFAULT,
  },
  {
    id: 'circle',
    name: msg('Circle-Mitglieder'),
    description: msg('Wenn jemand einem deiner Circles beitritt.'),
    importance: Notifications.AndroidImportance.DEFAULT,
  },
];

let ensuredForLocale: string | null = null;

export async function ensureNotificationChannels(input: {
  locale: string;
  translate: (message: string) => string;
}): Promise<void> {
  if (Platform.OS !== 'android' || ensuredForLocale === input.locale) {
    return;
  }

  ensuredForLocale = input.locale;

  for (const channel of NOTIFICATION_CHANNEL_DEFINITIONS) {
    try {
      await Notifications.setNotificationChannelAsync(channel.id, {
        name: input.translate(channel.name),
        description: input.translate(channel.description),
        importance: channel.importance,
        lightColor: Colors.light.primary,
        showBadge: true,
        sound: 'default',
      });
    } catch (error) {
      ensuredForLocale = null;
      logger.warn('Failed to create notification channel', { channelId: channel.id, error });
    }
  }
}
