import { describe, expect, test } from 'vitest';

import {
  buildActivityHref,
  buildNotificationHref,
  resolveNotificationNavigation,
} from './navigation';

describe('notification navigation', () => {
  test('routes share notifications to share detail', () => {
    expect(buildNotificationHref({ shareBatchId: 'share 1' })).toBe('/share/share%201');
  });

  test('includes asset deep-link data when present', () => {
    expect(buildNotificationHref({ shareBatchId: 'share 1', assetId: 'asset 2' })).toBe(
      '/share/share%201?assetId=asset%202',
    );
  });

  test('routes circle-level notifications to the circle', () => {
    expect(buildNotificationHref({ kind: 'member.joined', circleId: 'circle 1' })).toBe(
      '/circle/circle%201',
    );
  });

  test('ignores notifications without a target', () => {
    expect(buildNotificationHref({ assetId: 'asset 2' })).toBeNull();
    expect(buildNotificationHref(undefined)).toBeNull();
  });

  test('navigates when the payload instance matches the active one', () => {
    expect(
      resolveNotificationNavigation(
        { instanceUrl: 'https://cloud.example.com/', shareBatchId: 'share-1' },
        { activeInstanceUrl: 'https://cloud.example.com' },
      ),
    ).toEqual({ kind: 'navigate', href: '/share/share-1' });
  });

  test('refuses to navigate into another instance', () => {
    expect(
      resolveNotificationNavigation(
        { instanceUrl: 'https://self.example.com', shareBatchId: 'share-1' },
        { activeInstanceUrl: 'https://cloud.example.com' },
      ),
    ).toEqual({ kind: 'wrong_instance', instanceUrl: 'https://self.example.com' });
  });

  test('treats payloads without an instance as belonging to the active one', () => {
    expect(
      resolveNotificationNavigation(
        { shareBatchId: 'share-1' },
        { activeInstanceUrl: 'https://cloud.example.com' },
      ),
    ).toEqual({ kind: 'navigate', href: '/share/share-1' });
  });

  test('activity rows fall back to the circle when there is no share', () => {
    expect(buildActivityHref({ shareBatchId: null, circleId: 'c1' })).toBe('/circle/c1');
    expect(buildActivityHref({ shareBatchId: 's1', assetId: 'a1', circleId: 'c1' })).toBe(
      '/share/s1?assetId=a1',
    );
  });
});
