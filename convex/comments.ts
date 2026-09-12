import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';
import { normalizeCommentBody } from '@beisammen/contracts';

import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { mutation, query } from './_generated/server';
import { canManageCircle } from './lib/permissions';
import { createActivityEventWithInbox } from './lib/activity';
import {
  engagementTargetKey,
  requirePublishedEngagementTarget,
} from './lib/engagement';
import { imageCacheKey } from './lib/storage/shared';
import { requireCircleMembership, requireViewer } from './lib/viewer';

function canDeleteComment(input: {
  viewerId: Id<'users'>;
  membership: Doc<'circleMembers'>;
  shareBatch: Doc<'shareBatches'>;
  comment: Doc<'comments'>;
}) {
  return (
    input.comment.authorId === input.viewerId ||
    input.shareBatch.authorId === input.viewerId ||
    canManageCircle(input.membership.role)
  );
}

async function mapComment(
  ctx: QueryCtx | MutationCtx,
  input: {
    comment: Doc<'comments'>;
    viewerId: Id<'users'>;
    membership: Doc<'circleMembers'>;
    shareBatch: Doc<'shareBatches'>;
  },
) {
  const author = await ctx.db.get(input.comment.authorId);

  return {
    _id: input.comment._id,
    _creationTime: input.comment._creationTime,
    shareBatchId: input.comment.shareBatchId,
    circleId: input.comment.circleId,
    targetKind: input.comment.targetKind,
    assetId: input.comment.assetId ?? null,
    authorId: input.comment.authorId,
    authorName: author?.displayName ?? author?.email ?? 'Unbekannt',
    authorAvatarUrl: author?.avatarUrl,
    authorHasProfileImage: Boolean(author?.profileImageStorage),
    authorProfileImageKey: imageCacheKey(author?.profileImageStorage),
    body: input.comment.body,
    createdAt: input.comment.createdAt,
    updatedAt: input.comment.updatedAt,
    editedAt: input.comment.editedAt ?? null,
    canEdit: input.comment.authorId === input.viewerId,
    canDelete: canDeleteComment(input),
  };
}

export const listForShare = query({
  args: {
    shareBatchId: v.id('shareBatches'),
    assetId: v.optional(v.id('assets')),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const target = await requirePublishedEngagementTarget(ctx, {
      viewerId: viewer._id,
      shareBatchId: args.shareBatchId,
      ...(args.assetId ? { assetId: args.assetId } : {}),
    });
    const comments = await ctx.db
      .query('comments')
      .withIndex('by_share_target_status_created_at', (q) =>
        q
          .eq('shareBatchId', args.shareBatchId)
          .eq('targetKey', target.targetKey)
          .eq('status', 'active'),
      )
      .order('asc')
      .paginate(args.paginationOpts);
    const page = await Promise.all(
      comments.page.map((comment) =>
        mapComment(ctx, {
          comment,
          viewerId: viewer._id,
          membership: target.membership,
          shareBatch: target.shareBatch,
        }),
      ),
    );

    return {
      ...comments,
      page,
    };
  },
});

export const create = mutation({
  args: {
    shareBatchId: v.id('shareBatches'),
    assetId: v.optional(v.id('assets')),
    body: v.string(),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const target = await requirePublishedEngagementTarget(ctx, {
      viewerId: viewer._id,
      shareBatchId: args.shareBatchId,
      ...(args.assetId ? { assetId: args.assetId } : {}),
    });
    const now = Date.now();
    const commentId = await ctx.db.insert('comments', {
      shareBatchId: target.shareBatch._id,
      ...(target.assetId ? { assetId: target.assetId } : {}),
      circleId: target.shareBatch.circleId,
      authorId: viewer._id,
      targetKind: target.targetKind,
      targetKey: target.targetKey,
      body: normalizeCommentBody(args.body),
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });
    await createActivityEventWithInbox(ctx, {
      circleId: target.shareBatch.circleId,
      actorId: viewer._id,
      type: 'comment.created',
      shareBatchId: target.shareBatch._id,
      ...(target.assetId ? { assetId: target.assetId } : {}),
      commentId,
      createdAt: now,
    });

    return { commentId };
  },
});

export const update = mutation({
  args: {
    commentId: v.id('comments'),
    body: v.string(),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const comment = await ctx.db.get(args.commentId);

    if (!comment || comment.status !== 'active') {
      throw new Error('Comment not found.');
    }

    // Only the author may rewrite a comment; moderators can still delete it.
    if (comment.authorId !== viewer._id) {
      throw new Error('You cannot edit this comment.');
    }

    const shareBatch = await ctx.db.get(comment.shareBatchId);

    if (
      !shareBatch ||
      shareBatch.circleId !== comment.circleId ||
      shareBatch.status !== 'published'
    ) {
      throw new Error('Share not found.');
    }

    await requireCircleMembership(ctx, viewer._id, comment.circleId);

    const body = normalizeCommentBody(args.body);

    if (body === comment.body) {
      return { commentId: comment._id };
    }

    const now = Date.now();
    await ctx.db.patch(comment._id, {
      body,
      updatedAt: now,
      editedAt: now,
    });

    return { commentId: comment._id };
  },
});

const deleteCommentMutation = mutation({
  args: {
    commentId: v.id('comments'),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const comment = await ctx.db.get(args.commentId);

    if (!comment || comment.status !== 'active') {
      throw new Error('Comment not found.');
    }

    const shareBatch = await ctx.db.get(comment.shareBatchId);

    if (!shareBatch) {
      throw new Error('Share not found.');
    }

    const membership = await requireCircleMembership(ctx, viewer._id, comment.circleId);

    if (
      shareBatch.circleId !== comment.circleId ||
      shareBatch.status !== 'published' ||
      !canDeleteComment({
        viewerId: viewer._id,
        membership,
        shareBatch,
        comment,
      })
    ) {
      throw new Error('You cannot delete this comment.');
    }

    await ctx.db.patch(comment._id, {
      body: '',
      status: 'deleted',
      updatedAt: Date.now(),
      deletedAt: Date.now(),
    });

    return {
      commentId: comment._id,
    };
  },
});

export { deleteCommentMutation as delete };
