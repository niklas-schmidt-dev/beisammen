import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';

import type { Doc, Id } from './_generated/dataModel';
import type { ActionCtx, MutationCtx } from './_generated/server';
import { internal } from './_generated/api';
import { action, internalMutation, internalQuery, mutation, query } from './_generated/server';
import { adjustCircleStats, getCircleStatsOrFallback } from './circleStats';
import { deleteCircleKeyGrantsForMember, markCircleKeyRotationPending } from './keys';
import {
  BILLING_FEATURE_IDS,
  type BillingOwner,
  CloudOwnerFeatureAccessError,
  isBillingConfigured,
  requireCloudOwnerFeatureAccess,
  resolveCircleBillingOwner,
  resolveOwnerStorageCap,
  trackCloudOwnerUsage,
} from './lib/billing/quota';
import { getDeploymentPolicyFromEnv } from './lib/instance';
import { canManageCircle, isOwnerRole } from './lib/permissions';
import { deleteStorageReference, storageReferenceKey } from './legacyStorage';
import {
  createS3ReadUrl,
  createS3UploadTarget,
  deleteS3Object,
  verifyS3ObjectExists,
} from './lib/storage/s3';
import {
  buildImageUploadObjectKey,
  buildS3StorageReference,
  getCurrentInstanceStorage,
  imageCacheKey,
  requireS3StorageProvider,
} from './lib/storage/shared';
import { assertValidDeclaredImageSize } from './lib/uploadLimits';
import { findViewer, getViewerMembership, requireCircleMembership, requireViewer } from './lib/viewer';

export const CIRCLE_MEMBER_LIST_LIMIT = 200;

interface PreparedCircleImageUpload {
  uploadId: Id<'imageUploads'>;
  pendingStorage: NonNullable<Doc<'imageUploads'>['pendingStorage']>;
  mimeType: string;
  sizeBytes: number;
}

interface CircleImageCompleteContext {
  uploadId: Id<'imageUploads'>;
  pendingStorage: NonNullable<Doc<'imageUploads'>['pendingStorage']>;
  circleId: Id<'circles'>;
  billingOwner: BillingOwner;
  previousSizeBytes: number;
  // Optional only for legacy rows created before size enforcement.
  declaredSizeBytes?: number;
}

async function refundCloudCircleImageUsage(input: {
  ctx: ActionCtx;
  owner: BillingOwner;
  entityId: string;
  mediaUploads: number;
  storageBytes: number;
  properties: Record<string, unknown>;
}) {
  const refunds: Array<{ featureId: string; value: number }> = [];

  if (input.mediaUploads > 0) {
    refunds.push({
      featureId: BILLING_FEATURE_IDS.mediaUploads,
      value: -input.mediaUploads,
    });
  }

  if (input.storageBytes > 0) {
    refunds.push({
      featureId: BILLING_FEATURE_IDS.storageBytes,
      value: -input.storageBytes,
    });
  }

  for (const refund of refunds) {
    try {
      await trackCloudOwnerUsage(input.ctx, {
        owner: input.owner,
        entityId: input.entityId,
        ...refund,
        properties: input.properties,
      });
    } catch (error) {
      console.error('Failed to refund circle image usage.', error);
    }
  }
}

function billingOwnerFromUser(user: Doc<'users'>): BillingOwner {
  return {
    _id: user._id,
    ...(user.displayName ? { displayName: user.displayName } : {}),
    ...(user.email ? { email: user.email } : {}),
  };
}

/**
 * Becoming a circle's billing owner (creating one, or receiving ownership)
 * consumes one of that user's plan circle slots. Self-hosted instances and
 * cloud deployments without billing configured skip the check; existing
 * circles are never affected — a downgrade only blocks taking on new ones.
 */
async function requireCircleBillingAllowance(
  ctx: MutationCtx,
  owner: BillingOwner,
  messages: { planRequired: string; limitReached: string },
): Promise<void> {
  if (getDeploymentPolicyFromEnv().isSelfHosted || !isBillingConfigured()) {
    return;
  }

  try {
    await requireCloudOwnerFeatureAccess(ctx, {
      owner,
      entityId: owner._id,
      featureId: BILLING_FEATURE_IDS.circles,
      requiredBalance: 1,
    });
  } catch (error) {
    if (error instanceof CloudOwnerFeatureAccessError) {
      throw new Error(
        error.reason === 'not_allowed'
          ? messages.planRequired
          : error.reason === 'quota_exceeded'
            ? messages.limitReached
            : 'Cloud billing could not be checked. Try again shortly.',
      );
    }

    throw error;
  }
}

function buildCircleSummary(
  circle: Doc<'circles'>,
  membership: Doc<'circleMembers'>,
  memberCount: number,
) {
  const canManage = canManageCircle(membership.role);

  return {
    _id: circle._id,
    _creationTime: circle._creationTime,
    name: circle.name,
    description: circle.description ?? '',
    role: membership.role,
    memberCount,
    createdAt: circle.createdAt,
    hasImage: Boolean(circle.imageStorage),
    imageKey: imageCacheKey(circle.imageStorage),
    canManage,
    canEdit: canManage,
    canInvite: canManage,
    canLeave: !isOwnerRole(membership.role),
    isOwner: isOwnerRole(membership.role),
  };
}

function buildDisplayName(user: Doc<'users'> | null) {
  if (!user) {
    return 'Unbekannte Person';
  }

  return user.displayName?.trim() || user.email?.trim() || 'Unbekannte Person';
}

function roleSortValue(role: Doc<'circleMembers'>['role']) {
  switch (role) {
    case 'owner':
      return 0;
    case 'admin':
      return 1;
    default:
      return 2;
  }
}

export const create = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);

    await requireCircleBillingAllowance(ctx, billingOwnerFromUser(viewer), {
      planRequired: 'An active cloud plan is required to create a circle.',
      limitReached:
        'The cloud plan circle limit is reached. Upgrade the plan or delete a circle first.',
    });

    const now = Date.now();
    const circleId = await ctx.db.insert('circles', {
      name: args.name.trim(),
      ...(args.description ? { description: args.description.trim() } : {}),
      createdBy: viewer._id,
      billingOwnerId: viewer._id,
      createdAt: now,
    });
    await ctx.db.insert('circleMembers', {
      circleId,
      userId: viewer._id,
      role: 'owner',
      joinedAt: now,
    });
    await adjustCircleStats(ctx, circleId, {
      memberCount: 1,
    });

    return {
      circleId,
    };
  },
});

export const listForViewer = query({
  args: {
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const memberships = await ctx.db
      .query('circleMembers')
      .withIndex('by_user_and_joined_at', (q) => q.eq('userId', viewer._id))
      .order('desc')
      .paginate(args.paginationOpts);

    const circles = await Promise.all(
      memberships.page.map(async (membership) => {
        const circle = await ctx.db.get(membership.circleId);

        if (!circle) {
          return null;
        }

        const stats = await getCircleStatsOrFallback(ctx, circle._id);

        return buildCircleSummary(circle, membership, stats.memberCount);
      }),
    );

    return {
      ...memberships,
      page: circles.filter((circle): circle is NonNullable<typeof circle> => circle !== null),
    };
  },
});

export const getById = query({
  args: {
    circleId: v.id('circles'),
  },
  handler: async (ctx, args) => {
    // Subscribed with a client-held id: tolerate auth transitions and the
    // circle disappearing mid-subscription (deletion) by returning null.
    const identity = await ctx.auth.getUserIdentity();

    if (!identity) {
      return null;
    }

    const viewer = await findViewer(ctx);

    if (!viewer) {
      return null;
    }

    const membership = await getViewerMembership(ctx, viewer._id, args.circleId);

    if (!membership) {
      return null;
    }

    const circle = await ctx.db.get(args.circleId);

    if (!circle) {
      return null;
    }

    const stats = await getCircleStatsOrFallback(ctx, args.circleId);

    return {
      ...buildCircleSummary(circle, membership, stats.memberCount),
      imageCount: stats.imageCount,
      videoCount: stats.videoCount,
      totalSizeBytes: stats.totalSizeBytes,
    };
  },
});

export const requireOwnedCircleForDeletion = internalQuery({
  args: {
    circleId: v.id('circles'),
  },
  returns: v.object({
    circleId: v.id('circles'),
  }),
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const membership = await getViewerMembership(ctx, viewer._id, args.circleId);

    if (!membership || !isOwnerRole(membership.role)) {
      throw new Error('Only the circle owner can delete this circle.');
    }

    return { circleId: args.circleId };
  },
});

export const deleteOwn = action({
  args: {
    circleId: v.id('circles'),
  },
  returns: v.object({
    circleId: v.id('circles'),
  }),
  handler: async (ctx, args) => {
    const authorized: { circleId: Id<'circles'> } = await ctx.runQuery(
      internal.circles.requireOwnedCircleForDeletion,
      { circleId: args.circleId },
    );

    await ctx.runAction(internal.admin.deleteCircle, { circleId: authorized.circleId });

    return { circleId: authorized.circleId };
  },
});

export const update = mutation({
  args: {
    circleId: v.id('circles'),
    name: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const membership = await requireCircleMembership(ctx, viewer._id, args.circleId);

    if (!canManageCircle(membership.role)) {
      throw new Error('Only owners and admins can edit the circle.');
    }

    const circle = await ctx.db.get(args.circleId);

    if (!circle) {
      throw new Error('Circle not found.');
    }

    await ctx.db.patch(circle._id, {
      name: args.name.trim(),
      description: args.description?.trim() ? args.description.trim() : undefined,
    });

    return {
      circleId: circle._id,
    };
  },
});

export const listMembers = query({
  args: {
    circleId: v.id('circles'),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const viewerMembership = await requireCircleMembership(ctx, viewer._id, args.circleId);

    const memberships = await ctx.db
      .query('circleMembers')
      .withIndex('by_circle', (q) => q.eq('circleId', args.circleId))
      .take(CIRCLE_MEMBER_LIST_LIMIT);

    const members = await Promise.all(
      memberships.map(async (membership) => {
        const user = await ctx.db.get(membership.userId);
        const isSelf = membership.userId === viewer._id;
        const viewerIsOwner = isOwnerRole(viewerMembership.role);
        const targetIsOwner = isOwnerRole(membership.role);

        return {
          _id: membership._id,
          userId: membership.userId,
          role: membership.role,
          joinedAt: membership.joinedAt,
          isSelf,
          displayName: buildDisplayName(user),
          email: user?.email,
          avatarUrl: user?.avatarUrl,
          hasProfileImage: Boolean(user?.profileImageStorage),
          profileImageKey: imageCacheKey(user?.profileImageStorage),
          canChangeRole: viewerIsOwner && !isSelf && !targetIsOwner,
          canRemove: viewerIsOwner && !isSelf && !targetIsOwner,
          canTransferOwnership: viewerIsOwner && !isSelf && !targetIsOwner,
        };
      }),
    );

    return members.sort((left, right) => {
      const roleDelta = roleSortValue(left.role) - roleSortValue(right.role);

      if (roleDelta !== 0) {
        return roleDelta;
      }

      return left.displayName.localeCompare(right.displayName, 'de', {
        sensitivity: 'base',
      });
    });
  },
});

export const updateMemberRole = mutation({
  args: {
    circleId: v.id('circles'),
    memberId: v.id('circleMembers'),
    role: v.union(v.literal('admin'), v.literal('member')),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const viewerMembership = await requireCircleMembership(ctx, viewer._id, args.circleId);

    if (!isOwnerRole(viewerMembership.role)) {
      throw new Error('Only the owner can change member roles.');
    }

    const targetMembership = await ctx.db.get(args.memberId);

    if (!targetMembership || targetMembership.circleId !== args.circleId) {
      throw new Error('Target member not found.');
    }

    if (targetMembership.userId === viewer._id) {
      throw new Error('You cannot change your own role.');
    }

    if (isOwnerRole(targetMembership.role)) {
      throw new Error('The circle owner role cannot be changed here.');
    }

    await ctx.db.patch(targetMembership._id, {
      role: args.role,
    });

    return {
      memberId: targetMembership._id,
      role: args.role,
    };
  },
});

export const removeMember = mutation({
  args: {
    circleId: v.id('circles'),
    memberId: v.id('circleMembers'),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const viewerMembership = await requireCircleMembership(ctx, viewer._id, args.circleId);

    if (!isOwnerRole(viewerMembership.role)) {
      throw new Error('Only the owner can remove members.');
    }

    const targetMembership = await ctx.db.get(args.memberId);

    if (!targetMembership || targetMembership.circleId !== args.circleId) {
      throw new Error('Target member not found.');
    }

    if (targetMembership.userId === viewer._id) {
      throw new Error('Use leave to remove yourself from the circle.');
    }

    if (isOwnerRole(targetMembership.role)) {
      throw new Error('The circle owner cannot be removed.');
    }

    await ctx.db.delete(targetMembership._id);
    await deleteCircleKeyGrantsForMember(ctx, args.circleId, targetMembership.userId);
    await markCircleKeyRotationPending(ctx, args.circleId);
    await adjustCircleStats(ctx, args.circleId, {
      memberCount: -1,
    });

    return {
      memberId: targetMembership._id,
    };
  },
});

export const transferOwnership = mutation({
  args: {
    circleId: v.id('circles'),
    targetMemberId: v.id('circleMembers'),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const viewerMembership = await requireCircleMembership(ctx, viewer._id, args.circleId);

    if (!isOwnerRole(viewerMembership.role)) {
      throw new Error('Only the owner can transfer ownership.');
    }

    const targetMembership = await ctx.db.get(args.targetMemberId);

    if (!targetMembership || targetMembership.circleId !== args.circleId) {
      throw new Error('Target member not found.');
    }

    if (targetMembership.userId === viewer._id) {
      throw new Error('Ownership cannot be transferred to yourself.');
    }

    if (isOwnerRole(targetMembership.role)) {
      throw new Error('That member already owns the circle.');
    }

    const targetUser = await ctx.db.get(targetMembership.userId);

    if (!targetUser) {
      throw new Error('Target member not found.');
    }

    // Ownership transfer moves the bill: the new owner pays for this circle,
    // so they need a plan with a free circle slot.
    await requireCircleBillingAllowance(ctx, billingOwnerFromUser(targetUser), {
      planRequired: 'The new owner needs an active cloud plan before taking over the circle.',
      limitReached: 'The new owner has reached the circle limit of their cloud plan.',
    });

    await ctx.db.patch(viewerMembership._id, {
      role: 'admin',
    });
    await ctx.db.patch(targetMembership._id, {
      role: 'owner',
    });
    await ctx.db.patch(args.circleId, {
      billingOwnerId: targetMembership.userId,
    });

    return {
      circleId: args.circleId,
      ownerMemberId: targetMembership._id,
    };
  },
});

export const leave = mutation({
  args: {
    circleId: v.id('circles'),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const membership = await requireCircleMembership(ctx, viewer._id, args.circleId);

    if (isOwnerRole(membership.role)) {
      throw new Error('Transfer ownership before leaving the circle.');
    }

    await ctx.db.delete(membership._id);
    await deleteCircleKeyGrantsForMember(ctx, args.circleId, viewer._id);
    await markCircleKeyRotationPending(ctx, args.circleId);
    await adjustCircleStats(ctx, args.circleId, {
      memberCount: -1,
    });

    return {
      circleId: args.circleId,
      billingOwner: await resolveCircleBillingOwner(ctx, args.circleId),
    };
  },
});

export const prepareImageUpload = internalMutation({
  args: {
    circleId: v.id('circles'),
    mimeType: v.string(),
    fileName: v.string(),
    sizeBytes: v.number(),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const membership = await requireCircleMembership(ctx, viewer._id, args.circleId);

    if (!canManageCircle(membership.role)) {
      throw new Error('Only owners and admins can update the circle image.');
    }

    const storageMode = getCurrentInstanceStorage();

    requireS3StorageProvider(storageMode.providerKind);
    assertValidDeclaredImageSize(args.sizeBytes);

    const uploadId = await ctx.db.insert('imageUploads', {
      targetKind: 'circle-image',
      userId: viewer._id,
      circleId: args.circleId,
      providerKind: storageMode.providerKind,
      fileName: args.fileName.trim(),
      mimeType: args.mimeType.trim(),
      // Declared byte size, enforced by signing content-length into the
      // presigned PUT and re-checked against the S3 HEAD at completion.
      sizeBytes: args.sizeBytes,
      status: 'uploading',
      createdAt: Date.now(),
    });

    const pendingStorage = buildS3StorageReference({
      objectKey: buildImageUploadObjectKey({
        targetKind: 'circle-image',
        userId: viewer._id,
        circleId: args.circleId,
        fileName: args.fileName.trim(),
        uploadId,
      }),
    });

    await ctx.db.patch(uploadId, {
      pendingStorage,
    });

    return {
      uploadId,
      pendingStorage,
      mimeType: args.mimeType.trim(),
      sizeBytes: args.sizeBytes,
    };
  },
});

export const authorizeImageUpload = internalQuery({
  args: {
    circleId: v.id('circles'),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const membership = await requireCircleMembership(ctx, viewer._id, args.circleId);

    if (!canManageCircle(membership.role)) {
      throw new Error('Only owners and admins can update the circle image.');
    }

    return {
      circleId: args.circleId,
      billingOwner: await resolveCircleBillingOwner(ctx, args.circleId),
    };
  },
});

export const markImageUploadFailed = internalMutation({
  args: {
    uploadId: v.id('imageUploads'),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const upload = await ctx.db.get(args.uploadId);

    if (!upload || upload.userId !== viewer._id || upload.targetKind !== 'circle-image') {
      return null;
    }

    if (upload.circleId) {
      const membership = await requireCircleMembership(ctx, viewer._id, upload.circleId);

      if (!canManageCircle(membership.role)) {
        return null;
      }
    }

    await ctx.db.patch(upload._id, {
      status: 'failed',
      failureReason: args.message,
    });

    return {
      uploadId: upload._id,
    };
  },
});

export const getImageCompleteContext = internalQuery({
  args: {
    uploadId: v.id('imageUploads'),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const upload = await ctx.db.get(args.uploadId);

    if (!upload || upload.userId !== viewer._id || upload.targetKind !== 'circle-image') {
      throw new Error('Circle image upload not found.');
    }

    if (!upload.circleId) {
      throw new Error('Circle image upload is missing its circle.');
    }

    const membership = await requireCircleMembership(ctx, viewer._id, upload.circleId);

    if (!canManageCircle(membership.role)) {
      throw new Error('Only owners and admins can update the circle image.');
    }

    const circle = await ctx.db.get(upload.circleId);

    if (!circle) {
      throw new Error('Circle not found.');
    }

    if (!upload.pendingStorage) {
      throw new Error('Circle image upload is missing its storage target.');
    }

    return {
      uploadId: upload._id,
      pendingStorage: upload.pendingStorage,
      circleId: upload.circleId,
      billingOwner: await resolveCircleBillingOwner(ctx, upload.circleId),
      previousSizeBytes: circle.imageSizeBytes ?? 0,
      declaredSizeBytes: upload.sizeBytes,
    };
  },
});

export const finalizeImageUpload = internalMutation({
  args: {
    uploadId: v.id('imageUploads'),
    storage: v.object({
      provider: v.literal('s3'),
      objectKey: v.string(),
      bucket: v.string(),
      region: v.optional(v.string()),
      endpoint: v.optional(v.string()),
      basePath: v.optional(v.string()),
    }),
    sizeBytes: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const upload = await ctx.db.get(args.uploadId);

    if (!upload || upload.userId !== viewer._id || upload.targetKind !== 'circle-image') {
      throw new Error('Circle image upload not found.');
    }

    if (!upload.circleId) {
      throw new Error('Circle image upload is missing its circle.');
    }

    const membership = await requireCircleMembership(ctx, viewer._id, upload.circleId);

    if (!canManageCircle(membership.role)) {
      throw new Error('Only owners and admins can update the circle image.');
    }

    const circle = await ctx.db.get(upload.circleId);

    if (!circle) {
      throw new Error('Circle not found.');
    }

    const previousStorage = circle.imageStorage;

    await ctx.db.patch(circle._id, {
      imageStorage: args.storage,
      imageSizeBytes: args.sizeBytes,
    });
    await ctx.db.patch(upload._id, {
      storage: args.storage,
      pendingStorage: undefined,
      sizeBytes: args.sizeBytes,
      status: 'uploaded',
      failureReason: undefined,
      completedAt: Date.now(),
    });

    return {
      previousStorage: previousStorage ?? null,
      previousSizeBytes: circle.imageSizeBytes ?? 0,
      nextStorage: args.storage,
    };
  },
});

export const clearImage = internalMutation({
  args: {
    circleId: v.id('circles'),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const membership = await requireCircleMembership(ctx, viewer._id, args.circleId);

    if (!canManageCircle(membership.role)) {
      throw new Error('Only owners and admins can update the circle image.');
    }

    const circle = await ctx.db.get(args.circleId);

    if (!circle) {
      throw new Error('Circle not found.');
    }

    const previousStorage = circle.imageStorage;

    await ctx.db.patch(circle._id, {
      imageStorage: undefined,
      imageSizeBytes: undefined,
    });

    return {
      previousStorage: previousStorage ?? null,
      previousSizeBytes: circle.imageSizeBytes ?? 0,
    };
  },
});

export const getImageDeleteContext = internalQuery({
  args: {
    circleId: v.id('circles'),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const membership = await requireCircleMembership(ctx, viewer._id, args.circleId);

    if (!canManageCircle(membership.role)) {
      throw new Error('Only owners and admins can update the circle image.');
    }

    const circle = await ctx.db.get(args.circleId);

    if (!circle) {
      throw new Error('Circle not found.');
    }

    return {
      circleId: args.circleId,
      billingOwner: await resolveCircleBillingOwner(ctx, args.circleId),
      previousStorage: circle.imageStorage ?? null,
      previousSizeBytes: circle.imageSizeBytes ?? 0,
    };
  },
});

export const getImageReadContext = internalQuery({
  args: {
    circleId: v.id('circles'),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    await requireCircleMembership(ctx, viewer._id, args.circleId);

    const circle = await ctx.db.get(args.circleId);

    if (!circle) {
      throw new Error('Circle not found.');
    }

    return {
      storage: circle.imageStorage ?? null,
    };
  },
});

export const createImageTarget = action({
  args: {
    circleId: v.id('circles'),
    mimeType: v.string(),
    fileName: v.string(),
    sizeBytes: v.number(),
  },
  handler: async (ctx, args) => {
    const policy = getDeploymentPolicyFromEnv();
    const billingContext: {
      circleId: Id<'circles'>;
      billingOwner: BillingOwner;
    } = await ctx.runQuery(internal.circles.authorizeImageUpload, {
      circleId: args.circleId,
    }) as unknown as {
      circleId: Id<'circles'>;
      billingOwner: BillingOwner;
    };

    if (policy.isCloud) {
      await requireCloudOwnerFeatureAccess(ctx, {
        owner: billingContext.billingOwner,
        entityId: billingContext.circleId,
        featureId: BILLING_FEATURE_IDS.storageBytes,
        requiredBalance: args.sizeBytes,
        properties: {
          circleId: args.circleId,
          targetKind: 'circle-image',
        },
      });
    }

    const prepared: PreparedCircleImageUpload = await ctx.runMutation(
      internal.circles.prepareImageUpload,
      args,
    );

    if (prepared.pendingStorage.provider !== 's3') {
      throw new Error('Circle image upload target could not be prepared.');
    }

    return {
      uploadId: prepared.uploadId,
      target: await createS3UploadTarget({
        storage: prepared.pendingStorage,
        mimeType: prepared.mimeType,
        sizeBytes: prepared.sizeBytes,
      }),
    };
  },
});

export const completeImageUpload = action({
  args: {
    uploadId: v.id('imageUploads'),
    objectKey: v.optional(v.string()),
    sizeBytes: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const policy = getDeploymentPolicyFromEnv();
    const chargedUsage = {
      mediaUploads: 0,
      storageBytes: 0,
    };
    let billingContext: { owner: BillingOwner; entityId: string } | null = null;

    try {
      const completeContext: CircleImageCompleteContext = await ctx.runQuery(
        internal.circles.getImageCompleteContext,
        {
          uploadId: args.uploadId,
        },
      ) as unknown as CircleImageCompleteContext;
      billingContext = {
        owner: completeContext.billingOwner,
        entityId: completeContext.circleId,
      };

      if (completeContext.pendingStorage.provider !== 's3') {
        throw new Error('Circle image upload is missing its S3 storage reference.');
      }

      if (args.objectKey !== completeContext.pendingStorage.objectKey) {
        throw new Error('Completed circle image object key does not match the prepared target.');
      }

      const verified = await verifyS3ObjectExists({
        storage: completeContext.pendingStorage,
      });

      // Belt and suspenders: the signed content-length already pins the PUT
      // to the declared size. On a mismatch, drop the object and fail.
      if (
        completeContext.declaredSizeBytes !== undefined &&
        verified.sizeBytes !== completeContext.declaredSizeBytes
      ) {
        await deleteS3Object({ storage: completeContext.pendingStorage });
        throw new Error('Uploaded circle image size does not match the declared size.');
      }

      const billingProperties = {
        uploadId: args.uploadId,
        circleId: completeContext.circleId,
        targetKind: 'circle-image',
      };
      // The server-observed size is authoritative for billing and metadata.
      const completedSizeBytes = verified.sizeBytes;

      if (policy.isCloud) {
        await trackCloudOwnerUsage(ctx, {
          owner: completeContext.billingOwner,
          entityId: completeContext.circleId,
          featureId: BILLING_FEATURE_IDS.mediaUploads,
          value: 1,
          properties: billingProperties,
        });
        chargedUsage.mediaUploads = 1;

        if (completedSizeBytes > 0) {
          // Enforced atomically inside the usage mutation to close the
          // parallel-completion race.
          const storageCap = await resolveOwnerStorageCap(
            ctx,
            completeContext.billingOwner._id,
          );

          await trackCloudOwnerUsage(ctx, {
            owner: completeContext.billingOwner,
            entityId: completeContext.circleId,
            featureId: BILLING_FEATURE_IDS.storageBytes,
            value: completedSizeBytes,
            ...(storageCap !== null ? { maxStorageBytes: storageCap } : {}),
            properties: billingProperties,
          });
          chargedUsage.storageBytes = completedSizeBytes;
        }
      }

      const finalized: {
        previousStorage: Doc<'circles'>['imageStorage'] | null;
        previousSizeBytes: number;
        nextStorage: NonNullable<Doc<'circles'>['imageStorage']>;
      } = await ctx.runMutation(internal.circles.finalizeImageUpload, {
        uploadId: args.uploadId,
        storage: completeContext.pendingStorage,
        sizeBytes: completedSizeBytes,
      });
      chargedUsage.mediaUploads = 0;
      chargedUsage.storageBytes = 0;

      if (
        finalized.previousStorage &&
        storageReferenceKey(finalized.previousStorage) !== storageReferenceKey(finalized.nextStorage)
      ) {
        await deleteStorageReference(ctx, finalized.previousStorage);

        if (policy.isCloud && finalized.previousSizeBytes > 0) {
          try {
            await trackCloudOwnerUsage(ctx, {
              owner: completeContext.billingOwner,
              entityId: completeContext.circleId,
              featureId: BILLING_FEATURE_IDS.storageBytes,
              value: -finalized.previousSizeBytes,
              properties: billingProperties,
            });
          } catch (creditError) {
            console.error('Failed to credit replaced circle image storage.', creditError);
          }
        }
      }

      return {
        uploadId: args.uploadId,
      };
    } catch (error) {
      if (
        policy.isCloud &&
        billingContext &&
        (chargedUsage.mediaUploads > 0 || chargedUsage.storageBytes > 0)
      ) {
        await refundCloudCircleImageUsage({
          ctx,
          owner: billingContext.owner,
          entityId: billingContext.entityId,
          ...chargedUsage,
          properties: {
            uploadId: args.uploadId,
            targetKind: 'circle-image',
          },
        });
      }

      await ctx.runMutation(internal.circles.markImageUploadFailed, {
        uploadId: args.uploadId,
        message: error instanceof Error ? error.message : 'Circle image upload failed.',
      });
      throw error;
    }
  },
});

export const removeImage = action({
  args: {
    circleId: v.id('circles'),
  },
  handler: async (ctx, args) => {
    const policy = getDeploymentPolicyFromEnv();
    const deleteContext: {
      circleId: Id<'circles'>;
      billingOwner: BillingOwner;
      previousStorage: Doc<'circles'>['imageStorage'] | null;
      previousSizeBytes: number;
    } = await ctx.runQuery(internal.circles.getImageDeleteContext, {
      circleId: args.circleId,
    }) as unknown as {
      circleId: Id<'circles'>;
      billingOwner: BillingOwner;
      previousStorage: Doc<'circles'>['imageStorage'] | null;
      previousSizeBytes: number;
    };

    if (!deleteContext.previousStorage) {
      return {
        removed: false,
      };
    }

    let creditedStorageBytes = 0;

    try {
      if (policy.isCloud && deleteContext.previousSizeBytes > 0) {
        await trackCloudOwnerUsage(ctx, {
          owner: deleteContext.billingOwner,
          entityId: deleteContext.circleId,
          featureId: BILLING_FEATURE_IDS.storageBytes,
          value: -deleteContext.previousSizeBytes,
          properties: {
            circleId: args.circleId,
            targetKind: 'circle-image',
          },
        });
        creditedStorageBytes = deleteContext.previousSizeBytes;
      }

      await deleteStorageReference(ctx, deleteContext.previousStorage);
      await ctx.runMutation(internal.circles.clearImage, {
        circleId: args.circleId,
      });
    } catch (error) {
      if (policy.isCloud && creditedStorageBytes > 0) {
        try {
          await trackCloudOwnerUsage(ctx, {
            owner: deleteContext.billingOwner,
            entityId: deleteContext.circleId,
            featureId: BILLING_FEATURE_IDS.storageBytes,
            value: creditedStorageBytes,
            properties: {
              circleId: args.circleId,
              targetKind: 'circle-image',
            },
          });
        } catch (refundError) {
          console.error('Failed to refund circle image storage credit.', refundError);
        }
      }

      throw error;
    }

    return {
      removed: true,
    };
  },
});

export const getImageReadUrl = action({
  args: {
    circleId: v.id('circles'),
  },
  handler: async (ctx, args) => {
    const context: {
      storage: Doc<'circles'>['imageStorage'] | null;
    } = await ctx.runQuery(internal.circles.getImageReadContext, {
      circleId: args.circleId,
    });

    if (!context.storage) {
      return {
        url: null,
        expiresAt: null,
      };
    }

    // The convex-files read path is gone. Remaining legacy rows must be moved
    // to S3 first via `npx convex run legacyStorage:migrateBatch`.
    if (context.storage.provider !== 's3') {
      throw new Error('Legacy media must be migrated to S3.');
    }

    return await createS3ReadUrl({
      storage: context.storage,
    });
  },
});
