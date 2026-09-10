import { v } from 'convex/values';
import { normalizeReactionEmoji } from '@beisammen/contracts';

import { mutation, query } from './_generated/server';
import { createActivityEventWithInbox } from './lib/activity';
import {
  listReactionTargetsForShare,
  requirePublishedEngagementTarget,
} from './lib/engagement';
import { requireViewer } from './lib/viewer';

export const listForShare = query({
  args: {
    shareBatchId: v.id('shareBatches'),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    await requirePublishedEngagementTarget(ctx, {
      viewerId: viewer._id,
      shareBatchId: args.shareBatchId,
    });

    return {
      targets: await listReactionTargetsForShare(ctx, {
        shareBatchId: args.shareBatchId,
        viewerId: viewer._id,
      }),
    };
  },
});

export const set = mutation({
  args: {
    shareBatchId: v.id('shareBatches'),
    assetId: v.optional(v.id('assets')),
    emoji: v.string(),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const target = await requirePublishedEngagementTarget(ctx, {
      viewerId: viewer._id,
      shareBatchId: args.shareBatchId,
      ...(args.assetId ? { assetId: args.assetId } : {}),
    });
    const emoji = normalizeReactionEmoji(args.emoji);
    const existing = await ctx.db
      .query('reactions')
      .withIndex('by_share_target_user', (q) =>
        q
          .eq('shareBatchId', target.shareBatch._id)
          .eq('targetKey', target.targetKey)
          .eq('userId', viewer._id),
      )
      .take(10);
    const now = Date.now();

    if (existing[0]) {
      await ctx.db.patch(existing[0]._id, {
        emoji,
        updatedAt: now,
      });

      for (const duplicate of existing.slice(1)) {
        await ctx.db.delete(duplicate._id);
      }

      if (existing[0].emoji !== emoji) {
        await createActivityEventWithInbox(ctx, {
          circleId: target.shareBatch.circleId,
          actorId: viewer._id,
          type: 'reaction.set',
          shareBatchId: target.shareBatch._id,
          ...(target.assetId ? { assetId: target.assetId } : {}),
          reactionId: existing[0]._id,
          // Reactions only interrupt the share's author; everyone else sees
          // them in the activity history without a push.
          pushRecipientIds: [target.shareBatch.authorId],
          createdAt: now,
        });
      }

      return {
        reactionId: existing[0]._id,
        emoji,
      };
    }

    const reactionId = await ctx.db.insert('reactions', {
      shareBatchId: target.shareBatch._id,
      ...(target.assetId ? { assetId: target.assetId } : {}),
      circleId: target.shareBatch.circleId,
      userId: viewer._id,
      targetKind: target.targetKind,
      targetKey: target.targetKey,
      emoji,
      createdAt: now,
      updatedAt: now,
    });
    await createActivityEventWithInbox(ctx, {
      circleId: target.shareBatch.circleId,
      actorId: viewer._id,
      type: 'reaction.set',
      shareBatchId: target.shareBatch._id,
      ...(target.assetId ? { assetId: target.assetId } : {}),
      reactionId,
      pushRecipientIds: [target.shareBatch.authorId],
      createdAt: now,
    });

    return {
      reactionId,
      emoji,
    };
  },
});

export const remove = mutation({
  args: {
    shareBatchId: v.id('shareBatches'),
    assetId: v.optional(v.id('assets')),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const target = await requirePublishedEngagementTarget(ctx, {
      viewerId: viewer._id,
      shareBatchId: args.shareBatchId,
      ...(args.assetId ? { assetId: args.assetId } : {}),
    });
    const existing = await ctx.db
      .query('reactions')
      .withIndex('by_share_target_user', (q) =>
        q
          .eq('shareBatchId', target.shareBatch._id)
          .eq('targetKey', target.targetKey)
          .eq('userId', viewer._id),
      )
      .take(10);

    for (const reaction of existing) {
      await ctx.db.delete(reaction._id);
    }

    return {
      removed: existing.length > 0,
    };
  },
});
