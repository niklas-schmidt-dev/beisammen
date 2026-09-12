import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';
import { normalizeShareCaption, type EngagementSummary } from '@beisammen/contracts';

import type { Doc, Id } from './_generated/dataModel';
import type { ActionCtx, MutationCtx, QueryCtx } from './_generated/server';
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from './_generated/server';
import { internal } from './_generated/api';
import { adjustCircleStats, assetStatsDelta } from './circleStats';
import {
  BILLING_FEATURE_IDS,
  type BillingOwner,
  resolveCircleBillingOwner,
  trackCloudOwnerUsage,
} from './lib/billing/quota';
import { createActivityEventWithInbox } from './lib/activity';
import {
  createMemoryItemsForPublishedShare,
  removeMemoryItemFromDiscoverySummaries,
  syncMemoryItemCaptionsForShare,
} from './memories';
import { deleteStorageReference, storageReferenceKey } from './legacyStorage';
import { getDeploymentPolicyFromEnv } from './lib/instance';
import { imageCacheKey } from './lib/storage/shared';
import { listShareAssetsForDisplay } from './lib/shareAssets';
import { formatFeedTimestamp } from './lib/storage/shared';
import {
  buildAssetEngagementSummaries,
  buildShareEngagementSummary,
  buildTargetEngagementSummary,
  engagementTargetKey,
  fallbackEngagementSummary,
} from './lib/engagement';
import { findViewer, getViewerMembership, requireCircleMembership, requireViewer } from './lib/viewer';

const SHARE_DELETE_BATCH_SIZE = 50;
const DRAFT_UNRESOLVED_UPLOAD_DISPLAY_LIMIT = 50;
const UNRESOLVED_UPLOAD_STATUSES: Doc<'uploads'>['status'][] = [
  'draft',
  'uploading',
  'failed',
];

function mapAsset(asset: Doc<'assets'>, engagement?: EngagementSummary) {
  return {
    _id: asset._id,
    _creationTime: asset._creationTime,
    kind: asset.kind,
    fileName: asset.fileName,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    storage: asset.storage,
    previewStorage: asset.previewStorage,
    pairedVideoStorage: asset.pairedVideoStorage,
    pairedVideoMimeType: asset.pairedVideoMimeType,
    pairedVideoDurationSeconds: asset.pairedVideoDurationSeconds,
    width: asset.width,
    height: asset.height,
    durationSeconds: asset.durationSeconds,
    location: asset.location,
    capturedAt: asset.capturedAt,
    encryption: asset.encryption,
    engagement: fallbackEngagementSummary(engagement),
  };
}

async function listAssets(
  ctx: QueryCtx | MutationCtx,
  shareBatchId: Id<'shareBatches'>,
  viewerId?: Id<'users'>,
) {
  const assets = await listShareAssetsForDisplay(ctx, shareBatchId);
  const engagementByAsset = viewerId
    ? await buildAssetEngagementSummaries(ctx, {
        shareBatchId,
        assetIds: assets.map((asset) => asset._id),
        viewerId,
      })
    : new Map<Id<'assets'>, EngagementSummary>();

  return assets.map((asset) => mapAsset(asset, engagementByAsset.get(asset._id)));
}

function mapUnresolvedUpload(upload: Doc<'uploads'>) {
  return {
    _id: upload._id,
    _creationTime: upload._creationTime,
    shareBatchId: upload.shareBatchId,
    circleId: upload.circleId,
    kind: upload.kind,
    fileName: upload.fileName,
    mimeType: upload.mimeType,
    status: upload.status,
    failureReason: upload.failureReason,
    createdAt: upload.createdAt,
  };
}

async function listUnresolvedDraftUploads(
  ctx: QueryCtx | MutationCtx,
  shareBatchId: Id<'shareBatches'>,
) {
  const uploads: Doc<'uploads'>[] = [];

  for (const status of UNRESOLVED_UPLOAD_STATUSES) {
    const remaining = DRAFT_UNRESOLVED_UPLOAD_DISPLAY_LIMIT - uploads.length;

    if (remaining <= 0) {
      break;
    }

    const rows = await ctx.db
      .query('uploads')
      .withIndex('by_share_batch_and_status', (q) =>
        q.eq('shareBatchId', shareBatchId).eq('status', status),
      )
      .take(remaining);

    uploads.push(...rows);
  }

  return uploads.map(mapUnresolvedUpload);
}

async function assertNoUnresolvedUploadsBeforePublish(
  ctx: QueryCtx | MutationCtx,
  shareBatchId: Id<'shareBatches'>,
) {
  for (const status of UNRESOLVED_UPLOAD_STATUSES) {
    const [upload] = await ctx.db
      .query('uploads')
      .withIndex('by_share_batch_and_status', (q) =>
        q.eq('shareBatchId', shareBatchId).eq('status', status),
      )
      .take(1);

    if (upload) {
      throw new Error('Resolve failed or in-progress uploads before publishing this draft.');
    }
  }
}

async function getHeroAsset(
  ctx: QueryCtx | MutationCtx,
  shareBatchId: Id<'shareBatches'>,
) {
  const [asset] = await ctx.db
    .query('assets')
    .withIndex('by_share_batch', (q) => q.eq('shareBatchId', shareBatchId))
    .take(1);

  return asset ? mapAsset(asset) : null;
}

async function buildPublishedShareRecord(
  ctx: QueryCtx | MutationCtx,
  shareBatch: Doc<'shareBatches'>,
  viewerId: Id<'users'>,
) {
  const author = await ctx.db.get(shareBatch.authorId);
  const assets = await listAssets(ctx, shareBatch._id, viewerId);
  const engagement = await buildShareEngagementSummary(ctx, shareBatch._id, viewerId);
  const shareTargetEngagement = await buildTargetEngagementSummary(ctx, {
    shareBatchId: shareBatch._id,
    targetKey: engagementTargetKey(),
    viewerId,
  });

  return {
    _id: shareBatch._id,
    _creationTime: shareBatch._creationTime,
    circleId: shareBatch.circleId,
    caption: shareBatch.caption ?? '',
    assetCount: shareBatch.assetCount,
    authorId: shareBatch.authorId,
    authorName: author?.displayName ?? author?.email ?? 'Unbekannt',
    authorAvatarUrl: author?.avatarUrl,
    authorHasProfileImage: Boolean(author?.profileImageStorage),
    authorProfileImageKey: imageCacheKey(author?.profileImageStorage),
    createdAtLabel: formatFeedTimestamp(shareBatch.publishedAt ?? shareBatch.createdAt),
    publishedAt: shareBatch.publishedAt ?? shareBatch.createdAt,
    editedAt: shareBatch.editedAt ?? null,
    canEdit: shareBatch.authorId === viewerId,
    canDelete: shareBatch.authorId === viewerId,
    engagement,
    shareTargetEngagement,
    assets,
  };
}

async function buildFeedShareRecord(
  ctx: QueryCtx | MutationCtx,
  shareBatch: Doc<'shareBatches'>,
  viewerId: Id<'users'>,
) {
  const author = await ctx.db.get(shareBatch.authorId);
  const heroAsset = await getHeroAsset(ctx, shareBatch._id);
  const engagement = await buildShareEngagementSummary(ctx, shareBatch._id, viewerId);

  return {
    _id: shareBatch._id,
    _creationTime: shareBatch._creationTime,
    circleId: shareBatch.circleId,
    caption: shareBatch.caption ?? '',
    assetCount: shareBatch.assetCount,
    authorId: shareBatch.authorId,
    authorName: author?.displayName ?? author?.email ?? 'Unbekannt',
    authorAvatarUrl: author?.avatarUrl,
    authorHasProfileImage: Boolean(author?.profileImageStorage),
    authorProfileImageKey: imageCacheKey(author?.profileImageStorage),
    createdAtLabel: formatFeedTimestamp(shareBatch.publishedAt ?? shareBatch.createdAt),
    publishedAt: shareBatch.publishedAt ?? shareBatch.createdAt,
    editedAt: shareBatch.editedAt ?? null,
    canEdit: shareBatch.authorId === viewerId,
    canDelete: shareBatch.authorId === viewerId,
    engagement,
    heroAsset,
  };
}

export const getOrCreateDraft = mutation({
  args: {
    circleId: v.id('circles'),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    await requireCircleMembership(ctx, viewer._id, args.circleId);
    const [existingDraft] = await ctx.db
      .query('shareBatches')
      .withIndex('by_circle_and_author_and_status', (q) =>
        q.eq('circleId', args.circleId).eq('authorId', viewer._id).eq('status', 'draft'),
      )
      .order('desc')
      .take(1);

    if (existingDraft) {
      return {
        shareBatchId: existingDraft._id,
      };
    }

    const now = Date.now();

    const shareBatchId = await ctx.db.insert('shareBatches', {
      circleId: args.circleId,
      authorId: viewer._id,
      assetCount: 0,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    });

    return {
      shareBatchId,
    };
  },
});

export const getDraftForCircle = query({
  args: {
    circleId: v.id('circles'),
  },
  handler: async (ctx, args) => {
    // Subscribed draft lookup: tolerate auth transitions and circle deletion.
    const identity = await ctx.auth.getUserIdentity();
    const viewer = identity ? await findViewer(ctx) : null;
    const membership = viewer
      ? await getViewerMembership(ctx, viewer._id, args.circleId)
      : null;

    if (!viewer || !membership) {
      return null;
    }

    const [draft] = await ctx.db
      .query('shareBatches')
      .withIndex('by_circle_and_author_and_status', (q) =>
        q.eq('circleId', args.circleId).eq('authorId', viewer._id).eq('status', 'draft'),
      )
      .order('desc')
      .take(1);

    if (!draft) {
      return null;
    }

    const assets = await listAssets(ctx, draft._id);
    const unresolvedUploads = await listUnresolvedDraftUploads(ctx, draft._id);

    return {
      _id: draft._id,
      _creationTime: draft._creationTime,
      circleId: draft.circleId,
      caption: draft.caption ?? '',
      assetCount: Math.max(draft.assetCount, assets.length),
      updatedAt: draft.updatedAt,
      assets,
      unresolvedUploads,
    };
  },
});

export const updateDraft = mutation({
  args: {
    shareBatchId: v.id('shareBatches'),
    caption: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const shareBatch = await ctx.db.get(args.shareBatchId);

    if (!shareBatch) {
      throw new Error('Share batch not found.');
    }

    await requireCircleMembership(ctx, viewer._id, shareBatch.circleId);

    if (shareBatch.authorId !== viewer._id || shareBatch.status !== 'draft') {
      throw new Error('Only the author can update this draft.');
    }

    await ctx.db.patch(shareBatch._id, {
      caption: args.caption?.trim() || undefined,
      updatedAt: Date.now(),
    });

    return {
      shareBatchId: shareBatch._id,
    };
  },
});

export const publish = mutation({
  args: {
    shareBatchId: v.id('shareBatches'),
    caption: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const shareBatch = await ctx.db.get(args.shareBatchId);

    if (!shareBatch) {
      throw new Error('Share batch not found.');
    }

    await requireCircleMembership(ctx, viewer._id, shareBatch.circleId);

    if (shareBatch.authorId !== viewer._id) {
      throw new Error('Only the author can publish this draft.');
    }

    if (shareBatch.status !== 'draft') {
      throw new Error('Only drafts can be published.');
    }

    const [asset] = await ctx.db
      .query('assets')
      .withIndex('by_share_batch', (q) => q.eq('shareBatchId', shareBatch._id))
      .take(1);

    if (!asset) {
      throw new Error('At least one uploaded asset is required before publishing.');
    }

    await assertNoUnresolvedUploadsBeforePublish(ctx, shareBatch._id);

    const now = Date.now();
    await ctx.db.patch(shareBatch._id, {
      status: 'published',
      assetCount: Math.max(shareBatch.assetCount, 1),
      ...(args.caption !== undefined ? { caption: args.caption.trim() || undefined } : {}),
      updatedAt: now,
      publishedAt: now,
    });
    await createActivityEventWithInbox(ctx, {
      circleId: shareBatch.circleId,
      actorId: viewer._id,
      type: 'share.published',
      shareBatchId: shareBatch._id,
      createdAt: now,
    });
    await createMemoryItemsForPublishedShare(ctx, {
      shareBatch,
      publishedAt: now,
      caption: args.caption?.trim() || shareBatch.caption,
    });

    return {
      shareBatchId: shareBatch._id,
      assetCount: Math.max(shareBatch.assetCount, 1),
    };
  },
});

export const updateCaption = mutation({
  args: {
    shareBatchId: v.id('shareBatches'),
    caption: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const shareBatch = await ctx.db.get(args.shareBatchId);

    if (!shareBatch) {
      throw new Error('Share batch not found.');
    }

    await requireCircleMembership(ctx, viewer._id, shareBatch.circleId);

    if (shareBatch.authorId !== viewer._id) {
      throw new Error('Only the author can edit this share.');
    }

    if (shareBatch.status !== 'published') {
      throw new Error('Only published shares can be edited here.');
    }

    const caption = normalizeShareCaption(args.caption);

    if (caption === shareBatch.caption) {
      return { shareBatchId: shareBatch._id };
    }

    const now = Date.now();
    await ctx.db.patch(shareBatch._id, {
      caption,
      updatedAt: now,
      editedAt: now,
    });
    await syncMemoryItemCaptionsForShare(ctx, {
      shareBatchId: shareBatch._id,
      caption,
    });

    return { shareBatchId: shareBatch._id };
  },
});

export const getById = query({
  args: {
    shareBatchId: v.id('shareBatches'),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const shareBatch = await ctx.db.get(args.shareBatchId);

    if (!shareBatch) {
      return null;
    }

    await requireCircleMembership(ctx, viewer._id, shareBatch.circleId);

    if (shareBatch.status === 'draft' && shareBatch.authorId !== viewer._id) {
      throw new Error('Draft not found.');
    }

    return await buildPublishedShareRecord(ctx, shareBatch, viewer._id);
  },
});

export const listForCircle = query({
  args: {
    circleId: v.id('circles'),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    // Subscribed feed: tolerate auth transitions and circle deletion.
    const identity = await ctx.auth.getUserIdentity();
    const viewer = identity ? await findViewer(ctx) : null;
    const membership = viewer
      ? await getViewerMembership(ctx, viewer._id, args.circleId)
      : null;

    if (!viewer || !membership) {
      return { page: [], isDone: true, continueCursor: '' };
    }

    const shareBatches = await ctx.db
      .query('shareBatches')
      .withIndex('by_circle_and_status', (q) =>
        q.eq('circleId', args.circleId).eq('status', 'published'),
      )
      .order('desc')
      .paginate(args.paginationOpts);
    const page = await Promise.all(
      shareBatches.page.map((shareBatch) => buildFeedShareRecord(ctx, shareBatch, viewer._id)),
    );

    return {
      ...shareBatches,
      page,
    };
  },
});

export const getDeleteContext = internalQuery({
  args: {
    shareBatchId: v.id('shareBatches'),
    deletingUserId: v.optional(v.id('users')),
  },
  handler: async (ctx, args) => {
    const shareBatch = await ctx.db.get(args.shareBatchId);

    if (!shareBatch) {
      throw new Error('Share batch not found.');
    }

    const deletingUserId = args.deletingUserId;

    if (deletingUserId) {
      if (shareBatch.authorId !== deletingUserId) {
        throw new Error('The account does not own this post.');
      }
    } else {
      const viewer = await requireViewer(ctx);
      await requireCircleMembership(ctx, viewer._id, shareBatch.circleId);

      if (shareBatch.authorId !== viewer._id) {
        throw new Error('Only the author can delete this post.');
      }
    }

    const assetsPage = await ctx.db
      .query('assets')
      .withIndex('by_share_batch', (q) => q.eq('shareBatchId', shareBatch._id))
      .take(SHARE_DELETE_BATCH_SIZE + 1);
    const uploadsPage = await ctx.db
      .query('uploads')
      .withIndex('by_share_batch', (q) => q.eq('shareBatchId', shareBatch._id))
      .take(SHARE_DELETE_BATCH_SIZE + 1);
    const commentsPage = await ctx.db
      .query('comments')
      .withIndex('by_share_batch', (q) => q.eq('shareBatchId', shareBatch._id))
      .take(SHARE_DELETE_BATCH_SIZE + 1);
    const reactionsPage = await ctx.db
      .query('reactions')
      .withIndex('by_share_batch', (q) => q.eq('shareBatchId', shareBatch._id))
      .take(SHARE_DELETE_BATCH_SIZE + 1);
    const memoryItemsPage = await ctx.db
      .query('memoryItems')
      .withIndex('by_share_batch', (q) => q.eq('shareBatchId', shareBatch._id))
      .take(SHARE_DELETE_BATCH_SIZE + 1);
    const activityInboxPage = await ctx.db
      .query('activityInboxItems')
      .withIndex('by_share_batch', (q) => q.eq('shareBatchId', shareBatch._id))
      .take(SHARE_DELETE_BATCH_SIZE + 1);
    const notificationDeliveryAttemptsPage = await ctx.db
      .query('notificationDeliveryAttempts')
      .withIndex('by_share_batch', (q) => q.eq('shareBatchId', shareBatch._id))
      .take(SHARE_DELETE_BATCH_SIZE + 1);
    const activityEventsByShareBatchPage = await ctx.db
      .query('activityEvents')
      .withIndex('by_share_batch', (q) => q.eq('shareBatchId', shareBatch._id))
      .take(SHARE_DELETE_BATCH_SIZE + 1);
    const legacyActivityEventsPage =
      activityEventsByShareBatchPage.length === 0
        ? await ctx.db
            .query('activityEvents')
            .withIndex('by_circle_and_entity_id', (q) =>
              q.eq('circleId', shareBatch.circleId).eq('entityId', shareBatch._id),
            )
            .take(SHARE_DELETE_BATCH_SIZE + 1)
        : [];
    const assets = assetsPage.slice(0, SHARE_DELETE_BATCH_SIZE);
    const uploads = uploadsPage.slice(0, SHARE_DELETE_BATCH_SIZE);
    const comments = commentsPage.slice(0, SHARE_DELETE_BATCH_SIZE);
    const reactions = reactionsPage.slice(0, SHARE_DELETE_BATCH_SIZE);
    const memoryItems = memoryItemsPage.slice(0, SHARE_DELETE_BATCH_SIZE);
    const activityInboxItems = activityInboxPage.slice(0, SHARE_DELETE_BATCH_SIZE);
    const notificationDeliveryAttempts = notificationDeliveryAttemptsPage.slice(
      0,
      SHARE_DELETE_BATCH_SIZE,
    );
    const activityEvents = (
      activityEventsByShareBatchPage.length > 0
        ? activityEventsByShareBatchPage
        : legacyActivityEventsPage
    ).slice(0, SHARE_DELETE_BATCH_SIZE);
    const storageBytesDelta = -assets.reduce(
      (total, asset) => total + (asset.sizeBytes ?? 0) + (asset.pairedVideoSizeBytes ?? 0),
      0,
    );
    const billingOwner = await resolveCircleBillingOwner(ctx, shareBatch.circleId);

    return {
      shareBatchId: shareBatch._id,
      circleId: shareBatch.circleId,
      billingOwner,
      assetIds: assets.map((asset) => asset._id),
      uploadIds: uploads.map((upload) => upload._id),
      commentIds: comments.map((comment) => comment._id),
      reactionIds: reactions.map((reaction) => reaction._id),
      memoryItemIds: memoryItems.map((item) => item._id),
      activityInboxItemIds: activityInboxItems.map((item) => item._id),
      notificationDeliveryAttemptIds: notificationDeliveryAttempts.map((attempt) => attempt._id),
      activityEventIds: activityEvents.map((event) => event._id),
      storageBytesDelta,
      isFinalBatch:
        assetsPage.length <= SHARE_DELETE_BATCH_SIZE &&
        uploadsPage.length <= SHARE_DELETE_BATCH_SIZE &&
        commentsPage.length <= SHARE_DELETE_BATCH_SIZE &&
        reactionsPage.length <= SHARE_DELETE_BATCH_SIZE &&
        memoryItemsPage.length <= SHARE_DELETE_BATCH_SIZE &&
        activityInboxPage.length <= SHARE_DELETE_BATCH_SIZE &&
        notificationDeliveryAttemptsPage.length <= SHARE_DELETE_BATCH_SIZE &&
        activityEventsByShareBatchPage.length <= SHARE_DELETE_BATCH_SIZE &&
        legacyActivityEventsPage.length <= SHARE_DELETE_BATCH_SIZE,
      storageReferences: [
        ...assets.flatMap((asset) => [
          asset.storage,
          ...(asset.previewStorage ? [asset.previewStorage] : []),
          ...(asset.pairedVideoStorage ? [asset.pairedVideoStorage] : []),
        ]),
        ...uploads.flatMap((upload) => (upload.storage ? [upload.storage] : [])),
        ...uploads.flatMap((upload) => (upload.previewStorage ? [upload.previewStorage] : [])),
        ...uploads.flatMap((upload) =>
          upload.pairedVideoStorage ? [upload.pairedVideoStorage] : [],
        ),
        ...uploads.flatMap((upload) => (upload.pendingStorage ? [upload.pendingStorage] : [])),
        ...uploads.flatMap((upload) =>
          upload.previewPendingStorage ? [upload.previewPendingStorage] : [],
        ),
        ...uploads.flatMap((upload) =>
          upload.pairedVideoPendingStorage ? [upload.pairedVideoPendingStorage] : [],
        ),
      ],
    };
  },
});

export const finalizeDelete = internalMutation({
  args: {
    shareBatchId: v.id('shareBatches'),
    circleId: v.id('circles'),
    assetIds: v.array(v.id('assets')),
    uploadIds: v.array(v.id('uploads')),
    commentIds: v.array(v.id('comments')),
    reactionIds: v.array(v.id('reactions')),
    memoryItemIds: v.array(v.id('memoryItems')),
    activityInboxItemIds: v.array(v.id('activityInboxItems')),
    notificationDeliveryAttemptIds: v.array(v.id('notificationDeliveryAttempts')),
    activityEventIds: v.array(v.id('activityEvents')),
    isFinalBatch: v.boolean(),
  },
  handler: async (ctx, args) => {
    const assets = await Promise.all(args.assetIds.map((assetId) => ctx.db.get(assetId)));
    const statsDelta = assets.reduce(
      (delta, asset) => {
        if (!asset) {
          return delta;
        }

        const assetDelta = assetStatsDelta(asset, -1);
        return {
          imageCount: delta.imageCount + (assetDelta.imageCount ?? 0),
          videoCount: delta.videoCount + (assetDelta.videoCount ?? 0),
          totalSizeBytes: delta.totalSizeBytes + (assetDelta.totalSizeBytes ?? 0),
        };
      },
      {
        imageCount: 0,
        videoCount: 0,
        totalSizeBytes: 0,
      },
    );

    for (const assetId of args.assetIds) {
      await ctx.db.delete(assetId);
    }

    for (const uploadId of args.uploadIds) {
      await ctx.db.delete(uploadId);
    }

    for (const commentId of args.commentIds) {
      await ctx.db.delete(commentId);
    }

    for (const reactionId of args.reactionIds) {
      await ctx.db.delete(reactionId);
    }

    for (const memoryItemId of args.memoryItemIds) {
      const memoryItem = await ctx.db.get(memoryItemId);

      if (memoryItem) {
        await removeMemoryItemFromDiscoverySummaries(ctx, memoryItem);
      }

      await ctx.db.delete(memoryItemId);
    }

    for (const activityInboxItemId of args.activityInboxItemIds) {
      await ctx.db.delete(activityInboxItemId);
    }

    for (const notificationDeliveryAttemptId of args.notificationDeliveryAttemptIds) {
      await ctx.db.delete(notificationDeliveryAttemptId);
    }

    for (const activityEventId of args.activityEventIds) {
      await ctx.db.delete(activityEventId);
    }

    await adjustCircleStats(ctx, args.circleId, statsDelta);

    const [remainingAsset] = args.isFinalBatch
      ? await ctx.db
          .query('assets')
          .withIndex('by_share_batch', (q) => q.eq('shareBatchId', args.shareBatchId))
          .take(1)
      : [];
    const [remainingUpload] = args.isFinalBatch
      ? await ctx.db
          .query('uploads')
          .withIndex('by_share_batch', (q) => q.eq('shareBatchId', args.shareBatchId))
          .take(1)
      : [];
    const [remainingComment] = args.isFinalBatch
      ? await ctx.db
          .query('comments')
          .withIndex('by_share_batch', (q) => q.eq('shareBatchId', args.shareBatchId))
          .take(1)
      : [];
    const [remainingReaction] = args.isFinalBatch
      ? await ctx.db
          .query('reactions')
          .withIndex('by_share_batch', (q) => q.eq('shareBatchId', args.shareBatchId))
          .take(1)
      : [];
    const [remainingMemoryItem] = args.isFinalBatch
      ? await ctx.db
          .query('memoryItems')
          .withIndex('by_share_batch', (q) => q.eq('shareBatchId', args.shareBatchId))
          .take(1)
      : [];
    const [remainingActivityInboxItem] = args.isFinalBatch
      ? await ctx.db
          .query('activityInboxItems')
          .withIndex('by_share_batch', (q) => q.eq('shareBatchId', args.shareBatchId))
          .take(1)
      : [];
    const [remainingNotificationDeliveryAttempt] = args.isFinalBatch
      ? await ctx.db
          .query('notificationDeliveryAttempts')
          .withIndex('by_share_batch', (q) => q.eq('shareBatchId', args.shareBatchId))
          .take(1)
      : [];
    const [remainingActivityEventByShareBatch] = args.isFinalBatch
      ? await ctx.db
          .query('activityEvents')
          .withIndex('by_share_batch', (q) => q.eq('shareBatchId', args.shareBatchId))
          .take(1)
      : [];
    const [remainingLegacyActivityEvent] = args.isFinalBatch
      ? await ctx.db
          .query('activityEvents')
          .withIndex('by_circle_and_entity_id', (q) =>
            q.eq('circleId', args.circleId).eq('entityId', args.shareBatchId),
          )
          .take(1)
      : [];
    const deletedShareBatch =
      args.isFinalBatch &&
      !remainingAsset &&
      !remainingUpload &&
      !remainingComment &&
      !remainingReaction &&
      !remainingMemoryItem &&
      !remainingActivityInboxItem &&
      !remainingNotificationDeliveryAttempt &&
      !remainingActivityEventByShareBatch &&
      !remainingLegacyActivityEvent;

    if (deletedShareBatch) {
      await ctx.db.delete(args.shareBatchId);
    }

    return {
      shareBatchId: args.shareBatchId,
      deletedShareBatch,
    };
  },
});

async function deleteShareData(
  ctx: ActionCtx,
  args: { shareBatchId: Id<'shareBatches'> },
  deletingUserId?: Id<'users'>,
): Promise<{
  shareBatchId: Id<'shareBatches'>;
}> {
  const policy = getDeploymentPolicyFromEnv();
  let deletedShareBatchId: Id<'shareBatches'> | null = null;

  while (deletedShareBatchId === null) {
      const deleteContext: {
        shareBatchId: Id<'shareBatches'>;
        circleId: Id<'circles'>;
        billingOwner: BillingOwner;
        assetIds: Id<'assets'>[];
        uploadIds: Id<'uploads'>[];
        commentIds: Id<'comments'>[];
        reactionIds: Id<'reactions'>[];
        memoryItemIds: Id<'memoryItems'>[];
        activityInboxItemIds: Id<'activityInboxItems'>[];
        notificationDeliveryAttemptIds: Id<'notificationDeliveryAttempts'>[];
        activityEventIds: Id<'activityEvents'>[];
        storageBytesDelta: number;
        isFinalBatch: boolean;
        storageReferences: Doc<'assets'>['storage'][];
      } = await ctx.runQuery(internal.shares.getDeleteContext, {
        shareBatchId: args.shareBatchId,
        ...(deletingUserId ? { deletingUserId } : {}),
      }) as unknown as {
        shareBatchId: Id<'shareBatches'>;
        circleId: Id<'circles'>;
        billingOwner: BillingOwner;
        assetIds: Id<'assets'>[];
        uploadIds: Id<'uploads'>[];
        commentIds: Id<'comments'>[];
        reactionIds: Id<'reactions'>[];
        memoryItemIds: Id<'memoryItems'>[];
        activityInboxItemIds: Id<'activityInboxItems'>[];
        notificationDeliveryAttemptIds: Id<'notificationDeliveryAttempts'>[];
        activityEventIds: Id<'activityEvents'>[];
        storageBytesDelta: number;
        isFinalBatch: boolean;
        storageReferences: Doc<'assets'>['storage'][];
      };

      if (
        !deleteContext.isFinalBatch &&
        deleteContext.assetIds.length === 0 &&
        deleteContext.uploadIds.length === 0 &&
        deleteContext.commentIds.length === 0 &&
        deleteContext.reactionIds.length === 0 &&
        deleteContext.memoryItemIds.length === 0 &&
        deleteContext.activityInboxItemIds.length === 0 &&
        deleteContext.notificationDeliveryAttemptIds.length === 0 &&
        deleteContext.activityEventIds.length === 0
      ) {
        throw new Error('Share deletion could not make progress.');
      }

      const uniqueStorageReferences = new Map<string, Doc<'assets'>['storage']>();

      for (const storageReference of deleteContext.storageReferences) {
        uniqueStorageReferences.set(storageReferenceKey(storageReference), storageReference);
      }

      let creditedStorageBytes = 0;

      try {
        if (policy.isCloud && deleteContext.storageBytesDelta < 0) {
          await trackCloudOwnerUsage(ctx, {
            owner: deleteContext.billingOwner,
            entityId: deleteContext.circleId,
            featureId: BILLING_FEATURE_IDS.storageBytes,
            value: deleteContext.storageBytesDelta,
            properties: {
              shareBatchId: deleteContext.shareBatchId,
              circleId: deleteContext.circleId,
            },
          });
          creditedStorageBytes = -deleteContext.storageBytesDelta;
        }

        for (const storageReference of uniqueStorageReferences.values()) {
          await deleteStorageReference(ctx, storageReference);
        }

        const finalized: {
          shareBatchId: Id<'shareBatches'>;
          deletedShareBatch: boolean;
        } = await ctx.runMutation(internal.shares.finalizeDelete, {
          shareBatchId: deleteContext.shareBatchId,
          circleId: deleteContext.circleId,
          assetIds: deleteContext.assetIds,
          uploadIds: deleteContext.uploadIds,
          commentIds: deleteContext.commentIds,
          reactionIds: deleteContext.reactionIds,
          memoryItemIds: deleteContext.memoryItemIds,
          activityInboxItemIds: deleteContext.activityInboxItemIds,
          notificationDeliveryAttemptIds: deleteContext.notificationDeliveryAttemptIds,
          activityEventIds: deleteContext.activityEventIds,
          isFinalBatch: deleteContext.isFinalBatch,
        });

        if (finalized.deletedShareBatch) {
          deletedShareBatchId = finalized.shareBatchId;
        }
      } catch (error) {
        if (policy.isCloud && creditedStorageBytes > 0) {
          try {
            await trackCloudOwnerUsage(ctx, {
              owner: deleteContext.billingOwner,
              entityId: deleteContext.circleId,
              featureId: BILLING_FEATURE_IDS.storageBytes,
              value: creditedStorageBytes,
              properties: {
                shareBatchId: deleteContext.shareBatchId,
                circleId: deleteContext.circleId,
              },
            });
          } catch (refundError) {
            console.error('Failed to refund storage credit after delete failure.', refundError);
          }
        }

        throw error;
      }
    }

  return {
    shareBatchId: deletedShareBatchId,
  };
}

export const deleteShare = action({
  args: {
    shareBatchId: v.id('shareBatches'),
  },
  handler: async (ctx, args) => await deleteShareData(ctx, args),
});

export const deleteShareForAccountDeletion = internalAction({
  args: {
    shareBatchId: v.id('shareBatches'),
    userId: v.id('users'),
  },
  handler: async (ctx, args) =>
    await deleteShareData(ctx, { shareBatchId: args.shareBatchId }, args.userId),
});
