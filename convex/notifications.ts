import { v } from 'convex/values';

import type {
  NotificationDeviceRegistration,
  NotificationKind,
  NotificationPreference,
} from '@beisammen/contracts';

import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { internalAction, internalMutation, internalQuery, mutation, query } from './_generated/server';
import {
  expoPushAccessToken,
  fetchExpoPushReceipts,
  isTransientExpoError,
  sendExpoPushMessages,
  type ExpoPushMessage,
} from './lib/expoPush';
import { readBaseUrl } from './lib/httpHelpers';
import {
  NOTIFICATION_KINDS,
  countUnreadInboxItems,
  notificationChannelForKind,
  notificationCollapseId,
  notificationCopy,
  notificationsProviderConfigured,
  resolveNotificationLocale,
} from './lib/notifications';
import { requireViewer } from './lib/viewer';

const notificationKindValidator = v.union(
  v.literal('share.published'),
  v.literal('comment.created'),
  v.literal('reaction.set'),
  v.literal('member.joined'),
);

const notificationPlatformValidator = v.union(
  v.literal('ios'),
  v.literal('android'),
  v.literal('web'),
  v.literal('unknown'),
);
const PUSH_SEND_BATCH_SIZE = 100;
const PUSH_SCAN_BATCH_SIZE = 300;
const PUSH_RECEIPT_BATCH_SIZE = 100;
const PUSH_RECEIPT_READY_AFTER_MS = 15 * 60 * 1000;
const NOTIFICATION_DEVICE_TOKEN_SCAN_LIMIT = 20;
/** Stale activity is not worth waking a phone for; matches a typical day. */
const PUSH_TTL_SECONDS = 24 * 60 * 60;
/**
 * Queued attempts older than this without a ticket are abandoned. Covers the
 * window in which the provider was misconfigured or the token missing so a
 * fix does not release a flood of week-old pushes.
 */
const PUSH_QUEUE_MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000;

type QueuedSendAttempt = {
  attemptId: Id<'notificationDeliveryAttempts'>;
  deviceId: Id<'notificationDevices'> | null;
  deviceToken: string | null;
  title: string;
  body: string;
  data: Record<string, string>;
  badge: number | null;
  channelId: string;
  collapseId: string | null;
  threadId: string;
  failureReason: string | null;
};

type QueuedReceiptAttempt = {
  attemptId: Id<'notificationDeliveryAttempts'>;
  deviceId: Id<'notificationDevices'> | null;
  providerMessageId: string;
};

type SendMarkResult = {
  attemptId: Id<'notificationDeliveryAttempts'>;
  status: 'sent' | 'failed';
  providerMessageId?: string;
  errorMessage?: string;
  disableDevice?: boolean;
};

type ReceiptMarkResult = {
  attemptId: Id<'notificationDeliveryAttempts'>;
  status: 'delivered' | 'failed';
  errorMessage?: string;
  disableDevice?: boolean;
};

const sendMarkResultValidator = v.object({
  attemptId: v.id('notificationDeliveryAttempts'),
  status: v.union(v.literal('sent'), v.literal('failed')),
  providerMessageId: v.optional(v.string()),
  errorMessage: v.optional(v.string()),
  disableDevice: v.optional(v.boolean()),
});

const receiptMarkResultValidator = v.object({
  attemptId: v.id('notificationDeliveryAttempts'),
  status: v.union(v.literal('delivered'), v.literal('failed')),
  errorMessage: v.optional(v.string()),
  disableDevice: v.optional(v.boolean()),
});

function normalizeRequiredString(value: string, fieldName: string): string {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error(`${fieldName} is required.`);
  }

  return normalized;
}

function ticketErrorMessage(ticket: { message?: string; details?: { error?: string } }): string {
  return ticket.message ?? ticket.details?.error ?? 'Expo push ticket failed.';
}

function receiptErrorMessage(receipt: { message?: string; details?: { error?: string } }): string {
  return receipt.message ?? receipt.details?.error ?? 'Expo push receipt failed.';
}

function toExpoMessage(attempt: QueuedSendAttempt): ExpoPushMessage {
  return {
    to: attempt.deviceToken ?? '',
    title: attempt.title,
    body: attempt.body,
    data: attempt.data,
    ...(attempt.badge !== null ? { badge: attempt.badge } : {}),
    channelId: attempt.channelId,
    ...(attempt.collapseId ? { collapseId: attempt.collapseId } : {}),
    threadId: attempt.threadId,
    sound: 'default',
    priority: 'high',
    ttl: PUSH_TTL_SECONDS,
  };
}

function failedAttempt(attempt: QueuedSendAttempt, message: string): QueuedSendAttempt {
  return {
    ...attempt,
    deviceToken: null,
    failureReason: message,
  };
}

export const registerDevice = mutation({
  args: {
    instanceUrl: v.string(),
    token: v.string(),
    platform: notificationPlatformValidator,
    appVersion: v.optional(v.string()),
    locale: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<NotificationDeviceRegistration> => {
    const viewer = await requireViewer(ctx);
    const now = Date.now();
    const instanceUrl = normalizeRequiredString(args.instanceUrl, 'Instance URL');
    const deviceToken = normalizeRequiredString(args.token, 'Notification device token');
    const existing = await ctx.db
      .query('notificationDevices')
      .withIndex('by_user_and_instance_url_and_token', (q) =>
        q
          .eq('userId', viewer._id)
          .eq('instanceUrl', instanceUrl)
          .eq('deviceToken', deviceToken),
      )
      .first();
    const tokenRows = await ctx.db
      .query('notificationDevices')
      .withIndex('by_device_token', (q) => q.eq('deviceToken', deviceToken))
      .take(NOTIFICATION_DEVICE_TOKEN_SCAN_LIMIT);

    for (const row of tokenRows) {
      if (row._id === existing?._id || row.disabledAt !== undefined) {
        continue;
      }

      await ctx.db.patch(row._id, {
        disabledAt: now,
        updatedAt: now,
      });
    }

    if (existing) {
      await ctx.db.patch(existing._id, {
        provider: 'expo',
        platform: args.platform,
        ...(args.appVersion ? { appVersion: args.appVersion } : {}),
        ...(args.locale?.trim() ? { locale: args.locale.trim() } : {}),
        updatedAt: now,
        lastRegisteredAt: now,
        disabledAt: undefined,
      });

      return {
        deviceId: existing._id,
        instanceUrl,
        platform: args.platform,
        provider: 'expo',
        registeredAt: now,
      };
    }

    const deviceId = await ctx.db.insert('notificationDevices', {
      userId: viewer._id,
      instanceUrl,
      deviceToken,
      provider: 'expo',
      platform: args.platform,
      ...(args.appVersion ? { appVersion: args.appVersion } : {}),
      ...(args.locale?.trim() ? { locale: args.locale.trim() } : {}),
      createdAt: now,
      updatedAt: now,
      lastRegisteredAt: now,
    });

    return {
      deviceId,
      instanceUrl,
      platform: args.platform,
      provider: 'expo',
      registeredAt: now,
    };
  },
});

export const unregisterDevice = mutation({
  args: {
    instanceUrl: v.string(),
    token: v.string(),
  },
  handler: async (ctx, args): Promise<{ removed: boolean }> => {
    const viewer = await requireViewer(ctx);
    const instanceUrl = normalizeRequiredString(args.instanceUrl, 'Instance URL');
    const deviceToken = normalizeRequiredString(args.token, 'Notification device token');
    const existing = await ctx.db
      .query('notificationDevices')
      .withIndex('by_user_and_instance_url_and_token', (q) =>
        q
          .eq('userId', viewer._id)
          .eq('instanceUrl', instanceUrl)
          .eq('deviceToken', deviceToken),
      )
      .first();

    if (!existing || existing.disabledAt !== undefined) {
      return { removed: false };
    }

    await ctx.db.patch(existing._id, {
      disabledAt: Date.now(),
      updatedAt: Date.now(),
    });

    return { removed: true };
  },
});

export const getPreferences = query({
  args: {},
  handler: async (ctx): Promise<NotificationPreference[]> => {
    const viewer = await requireViewer(ctx);
    const stored = await Promise.all(
      NOTIFICATION_KINDS.map(async (kind) => {
        return await ctx.db
          .query('notificationPreferences')
          .withIndex('by_user_and_kind', (q) =>
            q.eq('userId', viewer._id).eq('kind', kind),
          )
          .first();
      }),
    );

    return NOTIFICATION_KINDS.map((kind, index) => ({
      kind,
      enabled: stored[index]?.enabled ?? true,
      updatedAt: stored[index]?.updatedAt ?? null,
    }));
  },
});

export const updatePreferences = mutation({
  args: {
    kind: notificationKindValidator,
    enabled: v.boolean(),
  },
  handler: async (ctx, args): Promise<NotificationPreference> => {
    const viewer = await requireViewer(ctx);
    const now = Date.now();
    const kind = args.kind as NotificationKind;
    const existing = await ctx.db
      .query('notificationPreferences')
      .withIndex('by_user_and_kind', (q) =>
        q.eq('userId', viewer._id).eq('kind', kind),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        enabled: args.enabled,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert('notificationPreferences', {
        userId: viewer._id,
        kind,
        enabled: args.enabled,
        updatedAt: now,
      });
    }

    return {
      kind,
      enabled: args.enabled,
      updatedAt: now,
    };
  },
});

export const getQueuedSendBatch = internalQuery({
  args: {
    now: v.number(),
    limit: v.number(),
  },
  handler: async (ctx, args): Promise<QueuedSendAttempt[]> => {
    const rows = await ctx.db
      .query('notificationDeliveryAttempts')
      .withIndex('by_status_and_updated_at', (q) => q.eq('status', 'queued'))
      .order('asc')
      .take(PUSH_SCAN_BATCH_SIZE);
    const candidates = rows
      .filter((attempt) => !attempt.providerMessageId)
      .slice(0, Math.min(args.limit, PUSH_SEND_BATCH_SIZE));
    const instanceUrl = readBaseUrl();
    const unreadByUser = new Map<Id<'users'>, number>();
    const batch: QueuedSendAttempt[] = [];

    for (const attempt of candidates) {
      const [activityEvent, circle, device] = await Promise.all([
        ctx.db.get(attempt.activityEventId),
        ctx.db.get(attempt.circleId),
        attempt.deviceId ? ctx.db.get(attempt.deviceId) : Promise.resolve(null),
      ]);
      const channelId = notificationChannelForKind(attempt.kind);
      const skeleton: QueuedSendAttempt = {
        attemptId: attempt._id,
        deviceId: attempt.deviceId ?? null,
        deviceToken: null,
        title: '',
        body: '',
        data: {},
        badge: null,
        channelId,
        collapseId: null,
        threadId: attempt.circleId,
        failureReason: null,
      };

      if (!attempt.deviceId || !device || device.disabledAt !== undefined) {
        batch.push(failedAttempt(skeleton, 'Notification device is no longer active.'));
        continue;
      }

      if (attempt.createdAt + PUSH_QUEUE_MAX_AGE_MS < args.now) {
        batch.push({
          ...failedAttempt(skeleton, 'Notification expired before the provider was configured.'),
          // Stale, not broken: keep the device registered.
          deviceId: null,
        });
        continue;
      }

      if (!activityEvent) {
        batch.push({
          ...failedAttempt(skeleton, 'Activity event was deleted before delivery.'),
          deviceId: null,
        });
        continue;
      }

      // Already read (e.g. opened on another device meanwhile): stay quiet.
      const inboxItem = attempt.inboxItemId ? await ctx.db.get(attempt.inboxItemId) : null;

      if (inboxItem && inboxItem.status === 'read') {
        batch.push({
          ...failedAttempt(skeleton, 'Activity was read before delivery.'),
          deviceId: null,
        });
        continue;
      }

      const [actor, reaction] = await Promise.all([
        ctx.db.get(activityEvent.actorId),
        activityEvent.reactionId ? ctx.db.get(activityEvent.reactionId) : Promise.resolve(null),
      ]);
      const locale = resolveNotificationLocale(device.locale);
      const copy = notificationCopy({
        actorName:
          actor?.displayName?.trim() ||
          actor?.email?.trim() ||
          (locale === 'en' ? 'Someone' : 'Jemand'),
        circleName: circle?.name ?? (locale === 'en' ? 'your circle' : 'deinem Circle'),
        kind: attempt.kind,
        locale,
        emoji: reaction?.emoji ?? null,
      });
      let badge = unreadByUser.get(attempt.userId);

      if (badge === undefined) {
        badge = await countUnreadInboxItems(ctx, attempt.userId);
        unreadByUser.set(attempt.userId, badge);
      }

      batch.push({
        ...skeleton,
        deviceId: device._id,
        deviceToken: device.deviceToken,
        title: copy.title,
        body: copy.body,
        data: {
          instanceUrl,
          activityEventId: attempt.activityEventId,
          ...(attempt.inboxItemId ? { inboxItemId: attempt.inboxItemId } : {}),
          kind: attempt.kind,
          circleId: attempt.circleId,
          ...(attempt.shareBatchId ? { shareBatchId: attempt.shareBatchId } : {}),
          ...(attempt.assetId ? { assetId: attempt.assetId } : {}),
        },
        badge,
        collapseId: notificationCollapseId(attempt) ?? null,
      });
    }

    return batch;
  },
});

export const markSendResults = internalMutation({
  args: {
    now: v.number(),
    results: v.array(sendMarkResultValidator),
  },
  handler: async (ctx, args) => {
    let sent = 0;
    let failed = 0;

    for (const result of args.results) {
      const attempt = await ctx.db.get(result.attemptId);

      if (!attempt) {
        continue;
      }

      if (result.status === 'sent' && result.providerMessageId) {
        await ctx.db.patch(result.attemptId, {
          providerMessageId: result.providerMessageId,
          errorMessage: undefined,
          updatedAt: args.now,
        });
        sent += 1;
      } else {
        await ctx.db.patch(result.attemptId, {
          status: 'failed',
          errorMessage: result.errorMessage ?? 'Expo push delivery failed.',
          updatedAt: args.now,
        });
        failed += 1;
      }

      if (result.disableDevice && attempt.deviceId) {
        await ctx.db.patch(attempt.deviceId, {
          disabledAt: args.now,
          updatedAt: args.now,
        });
      }
    }

    return { sent, failed };
  },
});

export const getQueuedReceiptBatch = internalQuery({
  args: {
    now: v.number(),
    limit: v.number(),
  },
  handler: async (ctx, args): Promise<QueuedReceiptAttempt[]> => {
    const readyBefore = args.now - PUSH_RECEIPT_READY_AFTER_MS;
    const rows = await ctx.db
      .query('notificationDeliveryAttempts')
      .withIndex('by_status_and_updated_at', (q) => q.eq('status', 'queued'))
      .order('asc')
      .take(PUSH_SCAN_BATCH_SIZE);

    return rows
      .filter(
        (attempt) =>
          Boolean(attempt.providerMessageId) && attempt.updatedAt <= readyBefore,
      )
      .slice(0, Math.min(args.limit, PUSH_RECEIPT_BATCH_SIZE))
      .map((attempt) => ({
        attemptId: attempt._id,
        deviceId: attempt.deviceId ?? null,
        providerMessageId: attempt.providerMessageId ?? '',
      }));
  },
});

export const markReceiptResults = internalMutation({
  args: {
    now: v.number(),
    results: v.array(receiptMarkResultValidator),
  },
  handler: async (ctx, args) => {
    let delivered = 0;
    let failed = 0;

    for (const result of args.results) {
      const attempt = await ctx.db.get(result.attemptId);

      if (!attempt) {
        continue;
      }

      if (result.status === 'delivered') {
        await ctx.db.patch(result.attemptId, {
          status: 'delivered',
          errorMessage: undefined,
          updatedAt: args.now,
        });
        delivered += 1;
      } else {
        await ctx.db.patch(result.attemptId, {
          status: 'failed',
          errorMessage: result.errorMessage ?? 'Expo push receipt failed.',
          updatedAt: args.now,
        });
        failed += 1;
      }

      if (result.disableDevice && attempt.deviceId) {
        await ctx.db.patch(attempt.deviceId, {
          disabledAt: args.now,
          updatedAt: args.now,
        });
      }
    }

    return { delivered, failed };
  },
});

export const dispatchQueued = internalAction({
  args: {
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const accessToken = expoPushAccessToken();

    if (!notificationsProviderConfigured()) {
      return {
        scanned: 0,
        sent: 0,
        failed: 0,
        retried: 0,
        skipped: 0,
      };
    }

    const batch: QueuedSendAttempt[] = await ctx.runQuery(
      internal.notifications.getQueuedSendBatch,
      { now, limit: PUSH_SEND_BATCH_SIZE },
    );
    const invalidResults: SendMarkResult[] = batch
      .filter((attempt) => !attempt.deviceToken)
      .map((attempt) => ({
        attemptId: attempt.attemptId,
        status: 'failed',
        errorMessage: attempt.failureReason ?? 'Notification device is no longer active.',
        disableDevice: Boolean(attempt.deviceId),
      }));
    const deliverable = batch.filter((attempt) => attempt.deviceToken);
    const sendResults: SendMarkResult[] = [...invalidResults];
    let retriedTickets = 0;

    if (deliverable.length > 0) {
      const response = await sendExpoPushMessages(deliverable.map(toExpoMessage), accessToken);

      if (!response.ok && response.transient) {
        if (invalidResults.length > 0) {
          await ctx.runMutation(internal.notifications.markSendResults, {
            now,
            results: invalidResults,
          });
        }

        return {
          scanned: batch.length,
          sent: 0,
          failed: invalidResults.length,
          retried: deliverable.length,
          skipped: 0,
        };
      }

      if (!response.ok) {
        sendResults.push(
          ...deliverable.map((attempt) => ({
            attemptId: attempt.attemptId,
            status: 'failed' as const,
            errorMessage: response.message,
          })),
        );
      } else {
        deliverable.forEach((attempt, index) => {
          const ticket = response.tickets[index];

          if (ticket?.status === 'ok' && ticket.id) {
            sendResults.push({
              attemptId: attempt.attemptId,
              status: 'sent',
              providerMessageId: ticket.id,
            });
            return;
          }

          if (isTransientExpoError(ticket?.details)) {
            // Left queued (no providerMessageId); the next pass retries it.
            retriedTickets += 1;
            return;
          }

          sendResults.push({
            attemptId: attempt.attemptId,
            status: 'failed',
            errorMessage: ticket ? ticketErrorMessage(ticket) : 'Expo push ticket missing.',
            disableDevice: ticket?.details?.error === 'DeviceNotRegistered',
          });
        });
      }
    }

    if (sendResults.length > 0) {
      await ctx.runMutation(internal.notifications.markSendResults, {
        now,
        results: sendResults,
      });
    }

    return {
      scanned: batch.length,
      sent: sendResults.filter((result) => result.status === 'sent').length,
      failed: sendResults.filter((result) => result.status === 'failed').length,
      retried: retriedTickets,
      skipped: 0,
    };
  },
});

export const checkReceipts = internalAction({
  args: {
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const accessToken = expoPushAccessToken();

    if (!notificationsProviderConfigured()) {
      return {
        scanned: 0,
        delivered: 0,
        failed: 0,
        missing: 0,
        retried: 0,
        skipped: 0,
      };
    }

    const batch: QueuedReceiptAttempt[] = await ctx.runQuery(
      internal.notifications.getQueuedReceiptBatch,
      { limit: PUSH_RECEIPT_BATCH_SIZE, now },
    );

    if (batch.length === 0) {
      return {
        scanned: 0,
        delivered: 0,
        failed: 0,
        missing: 0,
        retried: 0,
        skipped: 0,
      };
    }

    const response = await fetchExpoPushReceipts(
      batch.map((attempt) => attempt.providerMessageId),
      accessToken,
    );

    if (!response.ok && response.transient) {
      return {
        scanned: batch.length,
        delivered: 0,
        failed: 0,
        missing: 0,
        retried: batch.length,
        skipped: 0,
      };
    }

    const receiptResults: ReceiptMarkResult[] = [];
    let missing = 0;

    if (!response.ok) {
      receiptResults.push(
        ...batch.map((attempt) => ({
          attemptId: attempt.attemptId,
          status: 'failed' as const,
          errorMessage: response.message,
        })),
      );
    } else {
      for (const attempt of batch) {
        const receipt = response.receipts[attempt.providerMessageId];

        if (!receipt) {
          missing += 1;
          continue;
        }

        receiptResults.push(
          receipt.status === 'ok'
            ? {
                attemptId: attempt.attemptId,
                status: 'delivered' as const,
              }
            : {
                attemptId: attempt.attemptId,
                status: 'failed' as const,
                errorMessage: receiptErrorMessage(receipt),
                disableDevice: receipt.details?.error === 'DeviceNotRegistered',
              },
        );
      }
    }

    if (receiptResults.length > 0) {
      await ctx.runMutation(internal.notifications.markReceiptResults, {
        now,
        results: receiptResults,
      });
    }

    return {
      scanned: batch.length,
      delivered: receiptResults.filter((result) => result.status === 'delivered').length,
      failed: receiptResults.filter((result) => result.status === 'failed').length,
      missing,
      retried: 0,
      skipped: 0,
    };
  },
});
