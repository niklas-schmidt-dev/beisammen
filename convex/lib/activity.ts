import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { enqueueNotificationDeliveryAttempts } from './notifications';

const ACTIVITY_INBOX_RECIPIENT_LIMIT = 200;

export async function createActivityEventWithInbox(
  ctx: MutationCtx,
  input: {
    circleId: Id<'circles'>;
    actorId: Id<'users'>;
    type: string;
    /** Absent for circle-level events such as a member joining. */
    shareBatchId?: Id<'shareBatches'>;
    assetId?: Id<'assets'>;
    commentId?: Id<'comments'>;
    reactionId?: Id<'reactions'>;
    /**
     * Restricts push delivery (not the inbox) to these members. Reactions use
     * this so only the share author is interrupted; the whole circle still
     * sees the event in the activity history.
     */
    pushRecipientIds?: Id<'users'>[];
    createdAt: number;
  },
) {
  const activityEventId = await ctx.db.insert('activityEvents', {
    circleId: input.circleId,
    actorId: input.actorId,
    type: input.type,
    entityId: input.shareBatchId ?? input.circleId,
    ...(input.shareBatchId ? { shareBatchId: input.shareBatchId } : {}),
    ...(input.assetId ? { assetId: input.assetId } : {}),
    ...(input.commentId ? { commentId: input.commentId } : {}),
    ...(input.reactionId ? { reactionId: input.reactionId } : {}),
    createdAt: input.createdAt,
  });
  const members = await ctx.db
    .query('circleMembers')
    .withIndex('by_circle', (q) => q.eq('circleId', input.circleId))
    .take(ACTIVITY_INBOX_RECIPIENT_LIMIT);
  const pushRecipientIds = input.pushRecipientIds
    ? new Set<Id<'users'>>(input.pushRecipientIds)
    : null;

  const notificationRecipients: Array<{
    inboxItemId: Id<'activityInboxItems'>;
    userId: Id<'users'>;
  }> = [];

  for (const membership of members) {
    // The actor gets their own action in the inbox too (the activity tab is
    // the full circle history), but pre-read: no unread badge, no push.
    const isActor = membership.userId === input.actorId;
    const inboxItemId = await ctx.db.insert('activityInboxItems', {
      activityEventId,
      userId: membership.userId,
      circleId: input.circleId,
      actorId: input.actorId,
      type: input.type,
      ...(input.shareBatchId ? { shareBatchId: input.shareBatchId } : {}),
      ...(input.assetId ? { assetId: input.assetId } : {}),
      status: isActor ? 'read' : 'unread',
      ...(isActor ? { readAt: input.createdAt } : {}),
      createdAt: input.createdAt,
    });

    if (!isActor && (pushRecipientIds === null || pushRecipientIds.has(membership.userId))) {
      notificationRecipients.push({
        inboxItemId,
        userId: membership.userId,
      });
    }
  }

  await enqueueNotificationDeliveryAttempts(ctx, {
    activityEventId,
    recipients: notificationRecipients,
    circleId: input.circleId,
    type: input.type,
    ...(input.shareBatchId ? { shareBatchId: input.shareBatchId } : {}),
    ...(input.assetId ? { assetId: input.assetId } : {}),
    createdAt: input.createdAt,
  });

  return { activityEventId };
}
