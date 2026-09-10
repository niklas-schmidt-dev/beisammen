import { describe, expect, test } from 'vitest';

import type { NotificationPreference } from '@beisammen/contracts';

import {
  NOTIFICATION_PREFERENCE_ROWS,
  notificationPreferenceEnabled,
} from './preferences';

describe('notification preferences', () => {
  test('defines copy for every notification kind', () => {
    expect(NOTIFICATION_PREFERENCE_ROWS.map((row) => row.kind)).toEqual([
      'share.published',
      'comment.created',
      'reaction.set',
      'member.joined',
    ]);
    expect(NOTIFICATION_PREFERENCE_ROWS.map((row) => row.label)).toEqual([
      'Neue Beiträge',
      'Kommentare',
      'Reaktionen',
      'Neue Mitglieder',
    ]);
  });

  test('defaults missing preferences to enabled', () => {
    const preferences: NotificationPreference[] = [
      {
        kind: 'comment.created',
        enabled: false,
        updatedAt: 1,
      },
    ];

    expect(notificationPreferenceEnabled(preferences, 'comment.created')).toBe(false);
    expect(notificationPreferenceEnabled(preferences, 'share.published')).toBe(true);
  });
});
