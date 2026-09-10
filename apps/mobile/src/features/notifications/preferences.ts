import { msg } from 'gt-react-native';

import type { NotificationKind, NotificationPreference } from '@beisammen/contracts';

export const NOTIFICATION_PREFERENCE_ROWS: Array<{
  kind: NotificationKind;
  label: string;
  description: string;
}> = [
  {
    kind: 'share.published',
    label: msg('Neue Beiträge'),
    description: msg('Wenn jemand in einem deiner Circles Fotos oder Videos teilt.'),
  },
  {
    kind: 'comment.created',
    label: msg('Kommentare'),
    description: msg('Wenn jemand auf einen Beitrag oder ein einzelnes Medium antwortet.'),
  },
  {
    kind: 'reaction.set',
    label: msg('Reaktionen'),
    description: msg('Wenn jemand mit einem Emoji auf deine Beiträge reagiert.'),
  },
  {
    kind: 'member.joined',
    label: msg('Neue Mitglieder'),
    description: msg('Wenn jemand einer Einladung in einen deiner Circles folgt.'),
  },
];

export function notificationPreferenceEnabled(
  preferences: NotificationPreference[] | undefined,
  kind: NotificationKind,
): boolean {
  return preferences?.find((preference) => preference.kind === kind)?.enabled ?? true;
}
