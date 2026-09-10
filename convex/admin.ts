import { v } from 'convex/values';

import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { internal } from './_generated/api';
import { internalAction, internalMutation } from './_generated/server';
import { getDeploymentPolicyFromEnv } from './lib/instance';
import { deleteStorageReference, storageReferenceKey } from './legacyStorage';

/**
 * Admin maintenance functions. Run from the CLI, e.g.:
 *
 *   npx convex run admin:deleteCircle '{"circleId":"<id>"}'
 *
 * Never delete circle rows directly in the dashboard — that orphans members,
 * shares, assets, S3 objects, activity, and memories, and leaves subscribed
 * clients querying a half-deleted graph.
 */

// Mirrors the schema union: the purge reads rows written before the S3
// migration, so the legacy member stays until legacyStorage.migrateBatch has
// drained all 'convex-files' rows (see convex/legacyStorage.ts).
const storageReferenceValidator = v.union(
  v.object({
    provider: v.literal('convex-files'),
    storageId: v.id('_storage'),
  }),
  v.object({
    provider: v.literal('s3'),
    objectKey: v.string(),
    bucket: v.string(),
    region: v.optional(v.string()),
    endpoint: v.optional(v.string()),
    basePath: v.optional(v.string()),
  }),
);

type StorageRef = Doc<'assets'>['storage'];

const PURGE_BATCH_SIZE = 120;
const MAX_PURGE_PASSES = 500;

interface PurgeState {
  budget: number;
  deleted: number;
  freedBytes: number;
  storageRefs: StorageRef[];
}

function collectRef(state: PurgeState, ref: StorageRef | undefined | null): void {
  if (ref) {
    state.storageRefs.push(ref);
  }
}

async function purgeByCircleIndex(
  ctx: MutationCtx,
  state: PurgeState,
  table: 'assets' | 'uploads' | 'imageUploads' | 'shareBatches' | 'activityEvents'
    | 'comments' | 'reactions' | 'memoryItems' | 'memoryMonths' | 'memoryPlaces'
    | 'publicCircleLinks' | 'invites' | 'circleStats' | 'circleMembers',
  index: string,
  circleId: Id<'circles'>,
  onDoc?: (doc: Record<string, unknown>) => Promise<boolean | void>,
): Promise<void> {
  if (state.budget <= 0) {
    return;
  }

  const docs = await ctx.db
    .query(table)
    // All listed tables expose an index whose first field is circleId.
    .withIndex(index as never, (q) =>
      (q as unknown as { eq: (field: string, value: unknown) => never }).eq('circleId', circleId),
    )
    .take(state.budget);

  for (const doc of docs) {
    if (state.budget <= 0) {
      return;
    }

    if (onDoc) {
      const shouldDelete = await onDoc(doc as Record<string, unknown>);

      if (shouldDelete === false) {
        return;
      }
    }

    await ctx.db.delete(doc._id);
    state.budget -= 1;
    state.deleted += 1;
  }
}

export const purgeCircleBatch = internalMutation({
  args: {
    circleId: v.id('circles'),
  },
  returns: v.object({
    hasMore: v.boolean(),
    deleted: v.number(),
    freedBytes: v.number(),
    ownerId: v.union(v.id('users'), v.null()),
    storageRefs: v.array(storageReferenceValidator),
  }),
  handler: async (ctx, args) => {
    const state: PurgeState = {
      budget: PURGE_BATCH_SIZE,
      deleted: 0,
      freedBytes: 0,
      storageRefs: [],
    };
    const circle = await ctx.db.get(args.circleId);
    const ownerId = circle?.billingOwnerId ?? circle?.createdBy ?? null;

    await purgeByCircleIndex(ctx, state, 'assets', 'by_circle', args.circleId, async (doc) => {
      const asset = doc as unknown as Doc<'assets'>;
      collectRef(state, asset.storage);
      collectRef(state, asset.previewStorage ?? null);
      collectRef(state, asset.pairedVideoStorage ?? null);
      state.freedBytes += (asset.sizeBytes ?? 0) + (asset.pairedVideoSizeBytes ?? 0);
    });
    await purgeByCircleIndex(ctx, state, 'uploads', 'by_circle', args.circleId, async (doc) => {
      const upload = doc as unknown as Doc<'uploads'>;
      collectRef(state, upload.pendingStorage ?? null);
      collectRef(state, upload.previewPendingStorage ?? null);
      collectRef(state, upload.pairedVideoPendingStorage ?? null);
      collectRef(state, upload.storage ?? null);
      collectRef(state, upload.previewStorage ?? null);
      collectRef(state, upload.pairedVideoStorage ?? null);
    });
    await purgeByCircleIndex(ctx, state, 'imageUploads', 'by_circle', args.circleId, async (doc) => {
      const upload = doc as unknown as Doc<'imageUploads'>;
      collectRef(state, upload.pendingStorage ?? null);
      collectRef(state, upload.storage ?? null);
    });
    await purgeByCircleIndex(ctx, state, 'shareBatches', 'by_circle', args.circleId, async (doc) => {
      const batch = doc as unknown as Doc<'shareBatches'>;
      const dependents = await ctx.db
        .query('notificationDeliveryAttempts')
        .withIndex('by_share_batch', (q) => q.eq('shareBatchId', batch._id))
        .take(Math.max(state.budget - 1, 0));

      for (const dependent of dependents) {
        await ctx.db.delete(dependent._id);
        state.budget -= 1;
        state.deleted += 1;
      }

      // Leave the batch row for the next pass if its dependents used the budget.
      return state.budget > 0 && dependents.length < PURGE_BATCH_SIZE;
    });
    await purgeByCircleIndex(ctx, state, 'comments', 'by_circle_and_share_batch', args.circleId);
    await purgeByCircleIndex(ctx, state, 'reactions', 'by_circle_and_share_batch', args.circleId);
    await purgeByCircleIndex(ctx, state, 'activityEvents', 'by_circle', args.circleId, async (doc) => {
      const event = doc as unknown as Doc<'activityEvents'>;
      const inboxItems = await ctx.db
        .query('activityInboxItems')
        .withIndex('by_activity_event_id', (q) => q.eq('activityEventId', event._id))
        .take(Math.max(state.budget - 1, 0));

      for (const item of inboxItems) {
        await ctx.db.delete(item._id);
        state.budget -= 1;
        state.deleted += 1;
      }

      // Circle-level events (member.joined) have no share batch, so their
      // delivery attempts are only reachable through the event.
      const deliveryAttempts = await ctx.db
        .query('notificationDeliveryAttempts')
        .withIndex('by_activity_event_id', (q) => q.eq('activityEventId', event._id))
        .take(Math.max(state.budget - 1, 0));

      for (const attempt of deliveryAttempts) {
        await ctx.db.delete(attempt._id);
        state.budget -= 1;
        state.deleted += 1;
      }

      return state.budget > 0;
    });
    await purgeByCircleIndex(ctx, state, 'memoryItems', 'by_circle_and_timeline_at', args.circleId);
    await purgeByCircleIndex(ctx, state, 'memoryMonths', 'by_circle', args.circleId);
    await purgeByCircleIndex(ctx, state, 'memoryPlaces', 'by_circle', args.circleId);
    await purgeByCircleIndex(ctx, state, 'publicCircleLinks', 'by_circle', args.circleId);
    await purgeByCircleIndex(ctx, state, 'invites', 'by_circle', args.circleId);
    await purgeByCircleIndex(ctx, state, 'circleStats', 'by_circle', args.circleId);
    await purgeByCircleIndex(ctx, state, 'circleMembers', 'by_circle', args.circleId);

    // Only remove the circle itself once every dependent table is drained.
    if (circle && state.budget > 0 && state.deleted === 0) {
      collectRef(state, circle.imageStorage ?? null);
      state.freedBytes += circle.imageSizeBytes ?? 0;
      await ctx.db.delete(circle._id);
      state.deleted += 1;

      return {
        hasMore: false,
        deleted: state.deleted,
        freedBytes: state.freedBytes,
        ownerId,
        storageRefs: state.storageRefs,
      };
    }

    return {
      hasMore: circle !== null || state.deleted > 0,
      deleted: state.deleted,
      freedBytes: state.freedBytes,
      ownerId,
      storageRefs: state.storageRefs,
    };
  },
});

export const deleteCircle = internalAction({
  args: {
    circleId: v.id('circles'),
  },
  returns: v.object({
    passes: v.number(),
    deleted: v.number(),
    freedBytes: v.number(),
    storageObjectsDeleted: v.number(),
  }),
  handler: async (ctx, args) => {
    const policy = getDeploymentPolicyFromEnv();
    const seenRefs = new Set<string>();
    let passes = 0;
    let deleted = 0;
    let freedBytes = 0;
    let storageObjectsDeleted = 0;
    let ownerId: Id<'users'> | null = null;

    for (; passes < MAX_PURGE_PASSES; passes++) {
      const result: {
        hasMore: boolean;
        deleted: number;
        freedBytes: number;
        ownerId: Id<'users'> | null;
        storageRefs: StorageRef[];
      } = await ctx.runMutation(internal.admin.purgeCircleBatch, {
        circleId: args.circleId,
      });

      deleted += result.deleted;
      freedBytes += result.freedBytes;
      ownerId = ownerId ?? result.ownerId;

      for (const ref of result.storageRefs) {
        const key = storageReferenceKey(ref);

        if (seenRefs.has(key)) {
          continue;
        }

        seenRefs.add(key);

        try {
          await deleteStorageReference(ctx, ref);
          storageObjectsDeleted += 1;
        } catch (error) {
          console.error('admin.deleteCircle: failed to delete storage object', { key, error });
        }
      }

      if (!result.hasMore) {
        break;
      }
    }

    if (policy.isCloud && ownerId && freedBytes > 0) {
      await ctx.runMutation(internal.billingUsage.adjustUsage, {
        ownerId,
        mediaUploadsDelta: 0,
        storageBytesDelta: -freedBytes,
      });
    }

    console.log('admin.deleteCircle: completed', {
      circleId: args.circleId,
      passes: passes + 1,
      deleted,
      freedBytes,
      storageObjectsDeleted,
    });

    return {
      passes: passes + 1,
      deleted,
      freedBytes,
      storageObjectsDeleted,
    };
  },
});
