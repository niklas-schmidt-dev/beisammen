import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';

import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { mutation, query } from './_generated/server';
import { formatFeedTimestamp, imageCacheKey } from './lib/storage/shared';
import { findViewer, requireViewer } from './lib/viewer';

const ACTIVITY_MEMBERSHIP_LIMIT = 100;
const ACTIVITY_PAGE_SIZE_LIMIT = 30;
const ACTIVITY_EVENTS_PER_CIRCLE_LIMIT = 50;
const ACTIVITY_UNREAD_BADGE_CAP = 99;
const ACTIVITY_MARK_MANY_LIMIT = 100;

type ActivityEvent = Doc<'activityEvents'>;
type ActivityInboxItem = Doc<'activityInboxItems'>;

function normalizePageSize(numItems: number): number {
  if (!Number.isFinite(numItems)) {
    return ACTIVITY_PAGE_SIZE_LIMIT;
  }

  return Math.min(Math.max(Math.floor(numItems), 1), ACTIVITY_PAGE_SIZE_LIMIT);
}

function parseCursorOffset(cursor: string | null): number {
  if (!cursor) {
    return 0;
  }

  const parsed = Number(cursor);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function compareActivityEvents(left: ActivityEvent, right: ActivityEvent): number {
  const createdAtDelta = right.createdAt - left.createdAt;

  if (createdAtDelta !== 0) {
    return createdAtDelta;
  }

  return right._creationTime - left._creationTime;
}

function actorName(actor: Doc<'users'> | null): string {
  return actor?.displayName ?? actor?.email ?? 'Unbekannt';
}

function activityText(input: {
  actorName: string;
  assetId: Id<'assets'> | null;
  type: string;
}): string {
  switch (input.type) {
    case 'share.published':
      return `${input.actorName} hat einen Beitrag geteilt.`;
    case 'comment.created':
      return input.assetId
        ? `${input.actorName} hat ein Medium kommentiert.`
        : `${input.actorName} hat einen Beitrag kommentiert.`;
    case 'reaction.set':
      return input.assetId
        ? `${input.actorName} hat auf ein Medium reagiert.`
        : `${input.actorName} hat auf einen Beitrag reagiert.`;
    case 'member.joined':
      return `${input.actorName} ist dem Circle beigetreten.`;
    default:
      return `${input.actorName} war aktiv.`;
  }
}

async function listViewerCircleIds(
  ctx: QueryCtx,
  viewerId: Id<'users'>,
): Promise<Id<'circles'>[]> {
  const memberships = await ctx.db
    .query('circleMembers')
    .withIndex('by_user_and_joined_at', (q) => q.eq('userId', viewerId))
    .order('desc')
    .take(ACTIVITY_MEMBERSHIP_LIMIT);

  return memberships.map((membership) => membership.circleId);
}

async function listCircleCandidates(
  ctx: QueryCtx,
  input: {
    circleId: Id<'circles'>;
  },
): Promise<ActivityEvent[]> {
  return await ctx.db
    .query('activityEvents')
    .withIndex('by_circle_and_created_at', (q) => q.eq('circleId', input.circleId))
    .order('desc')
    .take(ACTIVITY_EVENTS_PER_CIRCLE_LIMIT);
}

async function mapActivityEvent(ctx: QueryCtx, event: ActivityEvent) {
  const [actor, circle] = await Promise.all([
    ctx.db.get(event.actorId),
    ctx.db.get(event.circleId),
  ]);
  const name = actorName(actor);
  const assetId = event.assetId ?? null;
  // Legacy rows stored the share id only in entityId; circle-level events
  // (member.joined) have no share at all.
  const shareBatchId =
    event.shareBatchId ??
    (event.entityId === event.circleId ? null : (event.entityId as Id<'shareBatches'>));

  return {
    _id: event._id,
    _creationTime: event._creationTime,
    circleId: event.circleId,
    circleName: circle?.name ?? 'Circle',
    actorId: event.actorId,
    actorName: name,
    actorAvatarUrl: actor?.avatarUrl,
    actorHasProfileImage: Boolean(actor?.profileImageStorage),
    actorProfileImageKey: imageCacheKey(actor?.profileImageStorage),
    type: event.type,
    shareBatchId,
    assetId,
    displayText: activityText({
      actorName: name,
      assetId,
      type: event.type,
    }),
    createdAt: event.createdAt,
    createdAtLabel: formatFeedTimestamp(event.createdAt),
  };
}

async function mapActivityInboxItem(ctx: QueryCtx, item: ActivityInboxItem) {
  const [actor, circle] = await Promise.all([
    ctx.db.get(item.actorId),
    ctx.db.get(item.circleId),
  ]);
  const name = actorName(actor);
  const assetId = item.assetId ?? null;

  return {
    _id: item._id,
    _creationTime: item._creationTime,
    activityEventId: item.activityEventId,
    circleId: item.circleId,
    circleName: circle?.name ?? 'Circle',
    actorId: item.actorId,
    actorName: name,
    actorAvatarUrl: actor?.avatarUrl,
    actorHasProfileImage: Boolean(actor?.profileImageStorage),
    actorProfileImageKey: imageCacheKey(actor?.profileImageStorage),
    type: item.type,
    shareBatchId: item.shareBatchId ?? null,
    assetId,
    status: item.status,
    readAt: item.readAt ?? null,
    displayText: activityText({
      actorName: name,
      assetId,
      type: item.type,
    }),
    createdAt: item.createdAt,
    createdAtLabel: formatFeedTimestamp(item.createdAt),
  };
}

async function markInboxItemRead(
  ctx: MutationCtx,
  input: {
    viewerId: Id<'users'>;
    inboxItemId: Id<'activityInboxItems'>;
    now: number;
  },
) {
  const item = await ctx.db.get(input.inboxItemId);

  if (!item || item.userId !== input.viewerId) {
    throw new Error('Activity item not found.');
  }

  if (item.status !== 'read') {
    await ctx.db.patch(item._id, {
      status: 'read',
      readAt: input.now,
    });
  }

  return item;
}

export const listForViewer = query({
  args: {
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const pageSize = normalizePageSize(args.paginationOpts.numItems);
    const cursorOffset = parseCursorOffset(args.paginationOpts.cursor);
    const circleIds = await listViewerCircleIds(ctx, viewer._id);

    if (circleIds.length === 0) {
      return {
        page: [],
        isDone: true,
        continueCursor: args.paginationOpts.cursor ?? '',
      };
    }

    const candidates = (
      await Promise.all(
        circleIds.map((circleId) =>
          listCircleCandidates(ctx, {
            circleId,
          }),
        ),
      )
    )
      .flat()
      .sort(compareActivityEvents);
    const pageEvents = candidates.slice(cursorOffset, cursorOffset + pageSize);
    const page = await Promise.all(pageEvents.map((event) => mapActivityEvent(ctx, event)));
    const nextOffset = cursorOffset + pageEvents.length;

    return {
      page,
      isDone: nextOffset >= candidates.length,
      continueCursor: String(nextOffset),
    };
  },
});

export const summaryForViewer = query({
  args: {},
  handler: async (ctx) => {
    // This badge query stays subscribed across auth transitions. Tolerate
    // both edges: sign-out (identity already gone before the client
    // unsubscribes) and first sign-in (identity exists but the users row has
    // not been upserted yet). The subscription re-runs reactively.
    const identity = await ctx.auth.getUserIdentity();

    if (!identity) {
      return {
        unreadCount: 0,
        hasUnread: false,
      };
    }

    const viewer = await findViewer(ctx);

    if (!viewer) {
      return {
        unreadCount: 0,
        hasUnread: false,
      };
    }

    const unreadRows = await ctx.db
      .query('activityInboxItems')
      .withIndex('by_user_and_status_and_created_at', (q) =>
        q.eq('userId', viewer._id).eq('status', 'unread'),
      )
      .take(ACTIVITY_UNREAD_BADGE_CAP + 1);
    const unreadCount = Math.min(unreadRows.length, ACTIVITY_UNREAD_BADGE_CAP);

    return {
      unreadCount,
      hasUnread: unreadCount > 0,
    };
  },
});

export const listInboxForViewer = query({
  args: {
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const pageResult = await ctx.db
      .query('activityInboxItems')
      .withIndex('by_user_and_created_at', (q) => q.eq('userId', viewer._id))
      .order('desc')
      .paginate(args.paginationOpts);
    const page = await Promise.all(
      pageResult.page.map((item) => mapActivityInboxItem(ctx, item)),
    );

    return {
      ...pageResult,
      page,
    };
  },
});

export const markRead = mutation({
  args: {
    inboxItemId: v.id('activityInboxItems'),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const item = await markInboxItemRead(ctx, {
      viewerId: viewer._id,
      inboxItemId: args.inboxItemId,
      now: Date.now(),
    });

    return {
      inboxItemId: item._id,
      status: 'read' as const,
    };
  },
});

export const markManyRead = mutation({
  args: {
    inboxItemIds: v.array(v.id('activityInboxItems')),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);

    if (args.inboxItemIds.length > ACTIVITY_MARK_MANY_LIMIT) {
      throw new Error(`Cannot mark more than ${ACTIVITY_MARK_MANY_LIMIT} activity items at once.`);
    }

    const now = Date.now();

    for (const inboxItemId of args.inboxItemIds) {
      await markInboxItemRead(ctx, {
        viewerId: viewer._id,
        inboxItemId,
        now,
      });
    }

    return {
      readCount: args.inboxItemIds.length,
    };
  },
});
