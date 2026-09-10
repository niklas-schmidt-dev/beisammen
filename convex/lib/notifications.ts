import type { NotificationKind, NotificationLocale } from '@beisammen/contracts';

import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';

export const NOTIFICATION_KINDS: NotificationKind[] = [
  'share.published',
  'comment.created',
  'reaction.set',
  'member.joined',
];

const NOTIFICATION_DEVICE_SCAN_LIMIT = 20;
const NOTIFICATION_ACTIVE_DEVICE_LIMIT = 5;
/** iOS badge value; mirrors activity.ACTIVITY_UNREAD_BADGE_CAP. */
export const NOTIFICATION_BADGE_CAP = 99;

/**
 * Android notification channels. The app creates these at startup
 * (features/notifications/channels.ts) and the server references them by id
 * so users can silence e.g. reactions without touching new-post alerts.
 */
export const NOTIFICATION_CHANNELS = {
  shares: 'shares',
  engagement: 'engagement',
  circle: 'circle',
} as const;

export type NotificationChannelId =
  (typeof NOTIFICATION_CHANNELS)[keyof typeof NOTIFICATION_CHANNELS];

export function isNotificationKind(value: string): value is NotificationKind {
  return (NOTIFICATION_KINDS as string[]).includes(value);
}

/**
 * Delivery is enabled when either an Expo access token is present (required
 * once "enhanced push security" is turned on for the EAS project) or the
 * operator explicitly opts into unauthenticated sends (self-hosted instances
 * cannot obtain a token for the central app's EAS project).
 */
export function notificationsProviderConfigured(
  env: { EXPO_PUSH_ACCESS_TOKEN?: string; EXPO_PUSH_ENABLED?: string } = process.env,
): boolean {
  if (env.EXPO_PUSH_ACCESS_TOKEN?.trim()) {
    return true;
  }

  return env.EXPO_PUSH_ENABLED?.trim().toLowerCase() === 'true';
}

export function notificationChannelForKind(kind: NotificationKind): NotificationChannelId {
  switch (kind) {
    case 'share.published':
      return NOTIFICATION_CHANNELS.shares;
    case 'comment.created':
    case 'reaction.set':
      return NOTIFICATION_CHANNELS.engagement;
    case 'member.joined':
      return NOTIFICATION_CHANNELS.circle;
  }
}

/** Maps a device's BCP 47 tag onto the languages push copy exists in. */
export function resolveNotificationLocale(locale: string | undefined): NotificationLocale {
  const language = locale?.trim().toLowerCase().split(/[-_]/)[0];

  return language === 'en' ? 'en' : 'de';
}

export function notificationCopy(input: {
  actorName: string;
  circleName: string;
  kind: NotificationKind;
  locale: NotificationLocale;
  emoji?: string | null;
}): { title: string; body: string } {
  const { actorName, circleName } = input;

  if (input.locale === 'en') {
    switch (input.kind) {
      case 'comment.created':
        return { title: `${actorName} commented`, body: `New reply in ${circleName}` };
      case 'reaction.set':
        return {
          title: input.emoji ? `${actorName} reacted with ${input.emoji}` : `${actorName} reacted`,
          body: `New reaction to your post in ${circleName}`,
        };
      case 'share.published':
        return { title: `${actorName} shared something`, body: `New post in ${circleName}` };
      case 'member.joined':
        return { title: `${actorName} joined`, body: `New member in ${circleName}` };
    }
  }

  switch (input.kind) {
    case 'comment.created':
      return { title: `${actorName} hat kommentiert`, body: `Neue Antwort in ${circleName}` };
    case 'reaction.set':
      return {
        title: input.emoji
          ? `${actorName} hat mit ${input.emoji} reagiert`
          : `${actorName} hat reagiert`,
        body: `Neue Reaktion auf deinen Beitrag in ${circleName}`,
      };
    case 'share.published':
      return { title: `${actorName} hat etwas geteilt`, body: `Neuer Beitrag in ${circleName}` };
    case 'member.joined':
      return { title: `${actorName} ist beigetreten`, body: `Neues Mitglied in ${circleName}` };
  }
}

/**
 * Collapse key so bursts about the same target replace each other on the
 * device instead of stacking: five reactions on one photo show as one
 * notification carrying the latest reactor.
 */
export function notificationCollapseId(attempt: {
  kind: NotificationKind;
  shareBatchId?: Id<'shareBatches'>;
  circleId: Id<'circles'>;
  assetId?: Id<'assets'>;
}): string | undefined {
  switch (attempt.kind) {
    case 'reaction.set':
      return `reaction:${attempt.shareBatchId}:${attempt.assetId ?? 'share'}`;
    case 'member.joined':
      return `member:${attempt.circleId}`;
    default:
      return undefined;
  }
}

export async function countUnreadInboxItems(
  ctx: QueryCtx | MutationCtx,
  userId: Id<'users'>,
): Promise<number> {
  const rows = await ctx.db
    .query('activityInboxItems')
    .withIndex('by_user_and_status_and_created_at', (q) =>
      q.eq('userId', userId).eq('status', 'unread'),
    )
    .take(NOTIFICATION_BADGE_CAP + 1);

  return Math.min(rows.length, NOTIFICATION_BADGE_CAP);
}

async function notificationPreferenceEnabled(
  ctx: MutationCtx,
  input: {
    userId: Id<'users'>;
    kind: NotificationKind;
  },
): Promise<boolean> {
  const preference = await ctx.db
    .query('notificationPreferences')
    .withIndex('by_user_and_kind', (q) =>
      q.eq('userId', input.userId).eq('kind', input.kind),
    )
    .first();

  return preference?.enabled ?? true;
}

export async function listActiveNotificationDevices(
  ctx: QueryCtx | MutationCtx,
  userId: Id<'users'>,
): Promise<Doc<'notificationDevices'>[]> {
  const devices = await ctx.db
    .query('notificationDevices')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .order('desc')
    .take(NOTIFICATION_DEVICE_SCAN_LIMIT);

  return devices
    .filter((device) => device.disabledAt === undefined)
    .slice(0, NOTIFICATION_ACTIVE_DEVICE_LIMIT);
}

export async function enqueueNotificationDeliveryAttempts(
  ctx: MutationCtx,
  input: {
    activityEventId: Id<'activityEvents'>;
    recipients: Array<{
      inboxItemId: Id<'activityInboxItems'>;
      userId: Id<'users'>;
    }>;
    circleId: Id<'circles'>;
    type: string;
    shareBatchId?: Id<'shareBatches'>;
    assetId?: Id<'assets'>;
    createdAt: number;
  },
) {
  if (!isNotificationKind(input.type)) {
    return;
  }

  const providerConfigured = notificationsProviderConfigured();
  const base = {
    activityEventId: input.activityEventId,
    circleId: input.circleId,
    kind: input.type,
    ...(input.shareBatchId ? { shareBatchId: input.shareBatchId } : {}),
    ...(input.assetId ? { assetId: input.assetId } : {}),
    provider: 'expo' as const,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  };

  for (const recipient of input.recipients) {
    const preferenceEnabled = await notificationPreferenceEnabled(ctx, {
      userId: recipient.userId,
      kind: input.type,
    });

    if (!preferenceEnabled) {
      await ctx.db.insert('notificationDeliveryAttempts', {
        ...base,
        inboxItemId: recipient.inboxItemId,
        userId: recipient.userId,
        status: 'skipped',
        skipReason: 'preference_disabled',
      });
      continue;
    }

    const activeDevices = await listActiveNotificationDevices(ctx, recipient.userId);

    if (activeDevices.length === 0) {
      await ctx.db.insert('notificationDeliveryAttempts', {
        ...base,
        inboxItemId: recipient.inboxItemId,
        userId: recipient.userId,
        status: 'skipped',
        skipReason: 'no_device',
      });
      continue;
    }

    for (const device of activeDevices) {
      await ctx.db.insert('notificationDeliveryAttempts', {
        ...base,
        inboxItemId: recipient.inboxItemId,
        userId: recipient.userId,
        deviceId: device._id,
        status: providerConfigured ? 'queued' : 'skipped',
        ...(providerConfigured ? {} : { skipReason: 'provider_not_configured' as const }),
      });
    }
  }
}
