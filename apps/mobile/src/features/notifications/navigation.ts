import { normalizeBaseUrl } from '@beisammen/contracts';

import { buildShareDetailHref } from '@/features/engagement/navigation';

function readString(data: Record<string, unknown> | undefined, key: string): string | null {
  const value = data?.[key];

  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

export type NotificationNavigation =
  | { kind: 'navigate'; href: string }
  | { kind: 'wrong_instance'; instanceUrl: string }
  | { kind: 'ignore' };

/**
 * Resolves the in-app destination of a tapped push. Payloads carry the
 * sending instance so a device that switched to another backend does not open
 * a share id that only exists elsewhere.
 */
export function resolveNotificationNavigation(
  data: Record<string, unknown> | undefined,
  options: { activeInstanceUrl: string },
): NotificationNavigation {
  const instanceUrl = readString(data, 'instanceUrl');

  if (
    instanceUrl &&
    normalizeBaseUrl(instanceUrl) !== normalizeBaseUrl(options.activeInstanceUrl)
  ) {
    return { kind: 'wrong_instance', instanceUrl };
  }

  const href = buildNotificationHref(data);

  return href ? { kind: 'navigate', href } : { kind: 'ignore' };
}

export function buildNotificationHref(data: Record<string, unknown> | undefined): string | null {
  const shareBatchId = readString(data, 'shareBatchId');

  if (shareBatchId) {
    return buildShareDetailHref({
      shareBatchId,
      assetId: readString(data, 'assetId'),
    });
  }

  const circleId = readString(data, 'circleId');

  if (circleId) {
    return `/circle/${encodeURIComponent(circleId)}`;
  }

  return null;
}

/** Same routing for activity rows (inbox / home strip) as for push taps. */
export function buildActivityHref(item: {
  shareBatchId: string | null;
  assetId?: string | null;
  circleId: string;
}): string {
  return (
    buildNotificationHref({
      shareBatchId: item.shareBatchId ?? undefined,
      assetId: item.assetId ?? undefined,
      circleId: item.circleId,
    }) ?? '/activity'
  );
}
