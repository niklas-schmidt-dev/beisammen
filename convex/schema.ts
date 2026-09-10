import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

const circleRole = v.union(v.literal('owner'), v.literal('admin'), v.literal('member'));
// The 'convex-files' code path has been removed; no media bytes flow through
// Convex storage anymore. The union member survives only so the schema keeps
// validating rows written before the S3 migration. Once
// `legacyStorage:countLegacyRows` reports zero rows (isTruncated false) in
// production, drop 'convex-files' here and delete convex/legacyStorage.ts.
const storageProviderKind = v.union(v.literal('convex-files'), v.literal('s3'));
const mediaLocation = v.object({
  latitude: v.number(),
  longitude: v.number(),
  accuracyMeters: v.optional(v.number()),
  label: v.optional(v.string()),
  city: v.optional(v.string()),
  region: v.optional(v.string()),
  country: v.optional(v.string()),
  source: v.union(v.literal('embedded'), v.literal('device-fallback')),
});
// E2EE envelope for an asset. Present on all uploads from encrypting clients;
// absent on legacy plaintext assets. `wrappedFileKey` is the per-asset file
// key wrapped with the circle key of `circleEpoch`; `encMetadata` is a
// BSE1-encrypted JSON envelope (location, original file name) under the same
// file key. Media objects in S3 are BSE1 ciphertext when this is set.
const assetEncryption = v.object({
  v: v.literal(1),
  circleEpoch: v.number(),
  wrappedFileKey: v.string(),
  encMetadata: v.optional(v.string()),
});
// See the note on `storageProviderKind`: the 'convex-files' member only keeps
// legacy rows valid until `legacyStorage:migrateBatch` has drained them.
const storageReference = v.union(
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

export default defineSchema({
  users: defineTable({
    tokenIdentifier: v.string(),
    authProvider: v.literal('clerk'),
    authSubject: v.string(),
    email: v.optional(v.string()),
    displayName: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    profileImageStorage: v.optional(storageReference),
    profileImageSizeBytes: v.optional(v.number()),
    deletionRequestedAt: v.optional(v.number()),
    deletionCompletedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index('by_token_identifier', ['tokenIdentifier'])
    .index('by_auth_provider_and_auth_subject', ['authProvider', 'authSubject'])
    .index('by_email', ['email']),

  // E2EE key registry, one row per user. All key material is generated
  // client-side; the server only ever stores public keys and ciphertext.
  // Wrapped values are base64(nonce || secretbox(...)) as produced by
  // @beisammen/crypto; the master key itself never reaches the server.
  userKeys: defineTable({
    userId: v.id('users'),
    keyVersion: v.number(),
    publicKey: v.string(),
    encPrivateKey: v.string(),
    encMasterKeyByRecovery: v.string(),
    encRecoveryKeyByMaster: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_user', ['userId']),

  // One row per circle-key generation. Rotation (e.g. after removing a
  // member) creates the next epoch; assets reference the epoch their file
  // key was wrapped with, so older epochs stay resolvable forever.
  circleKeyEpochs: defineTable({
    circleId: v.id('circles'),
    epoch: v.number(),
    reason: v.union(v.literal('initial'), v.literal('rotation')),
    createdBy: v.id('users'),
    createdAt: v.number(),
  }).index('by_circle_and_epoch', ['circleId', 'epoch']),

  // Per-member access to a circle-key epoch: the circle key sealed to the
  // member's public key (crypto_box_seal). Written only by member clients.
  circleKeyGrants: defineTable({
    circleId: v.id('circles'),
    epoch: v.number(),
    userId: v.id('users'),
    grantedBy: v.id('users'),
    sealedCircleKey: v.string(),
    createdAt: v.number(),
  })
    .index('by_circle_and_user_and_epoch', ['circleId', 'userId', 'epoch'])
    .index('by_circle_and_epoch', ['circleId', 'epoch'])
    .index('by_user', ['userId']),

  circles: defineTable({
    name: v.string(),
    description: v.optional(v.string()),
    imageStorage: v.optional(storageReference),
    imageSizeBytes: v.optional(v.number()),
    billingOwnerId: v.optional(v.id('users')),
    createdBy: v.id('users'),
    createdAt: v.number(),
    // Set when a member departs while the circle has a key; encrypted upload
    // completion is blocked until an admin commits a fresh key epoch, so
    // departed members can never decrypt post-departure media.
    keyRotationPendingAt: v.optional(v.number()),
  })
    .index('by_created_by', ['createdBy'])
    .index('by_billing_owner', ['billingOwnerId']),

  // Convex-enforced usage quotas. Upload counters are per UTC calendar month
  // ('YYYY-MM' period key); stale period rows are kept as audit history.
  billingUsage: defineTable({
    ownerId: v.id('users'),
    periodKey: v.string(),
    uploadCount: v.number(),
  }).index('by_owner_and_period', ['ownerId', 'periodKey']),

  // Lifetime storage gauge, one row per billing owner.
  billingStorage: defineTable({
    ownerId: v.id('users'),
    totalBytes: v.number(),
  }).index('by_owner', ['ownerId']),

  // Retention state for billing owners whose plan lapsed while they still
  // store data. Grace runs from detection; warnings are emailed after grace,
  // and deletion stays a manual admin step (rows only mark eligibility).
  billingRetention: defineTable({
    ownerId: v.id('users'),
    lapsedAt: v.number(),
    warningCount: v.number(),
    lastWarnedAt: v.optional(v.number()),
    deletableAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index('by_owner', ['ownerId'])
    .index('by_deletable_at', ['deletableAt']),

  circleMembers: defineTable({
    circleId: v.id('circles'),
    userId: v.id('users'),
    role: circleRole,
    joinedAt: v.number(),
  })
    .index('by_circle', ['circleId'])
    .index('by_user', ['userId'])
    .index('by_user_and_role', ['userId', 'role'])
    .index('by_user_and_joined_at', ['userId', 'joinedAt'])
    .index('by_circle_and_user', ['circleId', 'userId'])
    .index('by_circle_and_role', ['circleId', 'role']),

  circleStats: defineTable({
    circleId: v.id('circles'),
    memberCount: v.number(),
    imageCount: v.number(),
    videoCount: v.number(),
    totalSizeBytes: v.number(),
    updatedAt: v.number(),
  }).index('by_circle', ['circleId']),

  invites: defineTable({
    circleId: v.id('circles'),
    // Widened for migration: legacy rows without mode are email-bound invites.
    mode: v.optional(v.union(v.literal('email'), v.literal('open'))),
    invitedEmail: v.optional(v.string()),
    role: v.union(v.literal('admin'), v.literal('member')),
    tokenHash: v.string(),
    status: v.union(
      v.literal('pending'),
      v.literal('accepted'),
      v.literal('expired'),
      v.literal('revoked'),
    ),
    invitedBy: v.id('users'),
    expiresAt: v.number(),
    acceptedAt: v.optional(v.number()),
    acceptedBy: v.optional(v.id('users')),
  })
    .index('by_circle', ['circleId'])
    .index('by_circle_and_expires_at', ['circleId', 'expiresAt'])
    .index('by_invited_email', ['invitedEmail'])
    .index('by_invited_by', ['invitedBy'])
    .index('by_accepted_by', ['acceptedBy'])
    .index('by_token_hash', ['tokenHash']),

  publicCircleLinks: defineTable({
    circleId: v.id('circles'),
    tokenHash: v.string(),
    status: v.union(v.literal('active'), v.literal('revoked')),
    createdBy: v.id('users'),
    createdAt: v.number(),
    updatedAt: v.number(),
    expiresAt: v.number(),
    revokedAt: v.optional(v.number()),
    revokedBy: v.optional(v.id('users')),
  })
    .index('by_circle', ['circleId'])
    .index('by_circle_and_status', ['circleId', 'status'])
    .index('by_created_by', ['createdBy'])
    .index('by_status_and_expires_at', ['status', 'expiresAt'])
    .index('by_token_hash', ['tokenHash']),

  shareBatches: defineTable({
    circleId: v.id('circles'),
    authorId: v.id('users'),
    caption: v.optional(v.string()),
    assetCount: v.number(),
    status: v.union(v.literal('draft'), v.literal('published')),
    createdAt: v.number(),
    updatedAt: v.number(),
    publishedAt: v.optional(v.number()),
  })
    .index('by_circle', ['circleId'])
    .index('by_author', ['authorId'])
    .index('by_circle_and_author_and_status', ['circleId', 'authorId', 'status'])
    .index('by_circle_and_status', ['circleId', 'status'])
    .index('by_status_and_published_at', ['status', 'publishedAt']),

  assets: defineTable({
    shareBatchId: v.id('shareBatches'),
    circleId: v.id('circles'),
    kind: v.union(v.literal('image'), v.literal('video')),
    // Widened for migration: older assets were created before fileName existed.
    fileName: v.optional(v.string()),
    mimeType: v.string(),
    sizeBytes: v.optional(v.number()),
    storage: storageReference,
    previewStorage: v.optional(storageReference),
    // Live Photo / Motion Photo companion clip: a short video paired with an
    // image asset (kind stays 'image'). Encrypted under the same file key as
    // the still, so `encryption` covers all three objects.
    pairedVideoStorage: v.optional(storageReference),
    pairedVideoSizeBytes: v.optional(v.number()),
    pairedVideoMimeType: v.optional(v.string()),
    pairedVideoDurationSeconds: v.optional(v.number()),
    encryption: v.optional(assetEncryption),
    createdAt: v.number(),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    durationSeconds: v.optional(v.number()),
    // Plaintext location exists only on legacy assets; encrypted uploads
    // carry it inside `encryption.encMetadata` instead.
    location: v.optional(mediaLocation),
    capturedAt: v.optional(v.number()),
  })
    .index('by_share_batch', ['shareBatchId'])
    .index('by_circle', ['circleId']),

  memoryItems: defineTable({
    circleId: v.id('circles'),
    shareBatchId: v.id('shareBatches'),
    assetId: v.id('assets'),
    authorId: v.id('users'),
    kind: v.union(v.literal('image'), v.literal('video')),
    capturedAt: v.optional(v.number()),
    timelineAt: v.number(),
    publishedAt: v.number(),
    monthKey: v.optional(v.string()),
    placeKey: v.optional(v.string()),
    placeLabel: v.optional(v.string()),
    placeLatitude: v.optional(v.number()),
    placeLongitude: v.optional(v.number()),
    caption: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index('by_circle_and_timeline_at', ['circleId', 'timelineAt'])
    .index('by_circle_and_month_key_and_timeline_at', ['circleId', 'monthKey', 'timelineAt'])
    .index('by_circle_and_place_key_and_timeline_at', ['circleId', 'placeKey', 'timelineAt'])
    .index('by_timeline_at', ['timelineAt'])
    .index('by_share_batch', ['shareBatchId'])
    .index('by_asset', ['assetId']),

  memoryMonths: defineTable({
    circleId: v.id('circles'),
    monthKey: v.string(),
    itemCount: v.number(),
    latestTimelineAt: v.number(),
    coverAssetId: v.id('assets'),
    coverMemoryItemId: v.id('memoryItems'),
    updatedAt: v.number(),
  })
    .index('by_circle', ['circleId'])
    .index('by_circle_and_month_key', ['circleId', 'monthKey'])
    .index('by_circle_and_latest_timeline_at', ['circleId', 'latestTimelineAt']),

  memoryPlaces: defineTable({
    circleId: v.id('circles'),
    placeKey: v.string(),
    label: v.string(),
    latitude: v.number(),
    longitude: v.number(),
    itemCount: v.number(),
    latestTimelineAt: v.number(),
    coverAssetId: v.id('assets'),
    coverMemoryItemId: v.id('memoryItems'),
    updatedAt: v.number(),
  })
    .index('by_circle', ['circleId'])
    .index('by_circle_and_place_key', ['circleId', 'placeKey'])
    .index('by_circle_and_latest_timeline_at', ['circleId', 'latestTimelineAt']),

  uploads: defineTable({
    shareBatchId: v.id('shareBatches'),
    circleId: v.id('circles'),
    createdBy: v.id('users'),
    assetId: v.optional(v.id('assets')),
    providerKind: storageProviderKind,
    pendingStorage: v.optional(storageReference),
    previewPendingStorage: v.optional(storageReference),
    // Live Photo companion clip; only present on image uploads that declared
    // a paired video at target creation.
    pairedVideoPendingStorage: v.optional(storageReference),
    kind: v.union(v.literal('image'), v.literal('video')),
    fileName: v.string(),
    mimeType: v.string(),
    pairedVideoMimeType: v.optional(v.string()),
    // Client-declared byte sizes, enforced by signing content-length into the
    // presigned PUT and re-checked against the S3 HEAD at completion.
    // Optional only for legacy in-flight rows created before enforcement.
    declaredSizeBytes: v.optional(v.number()),
    declaredPreviewSizeBytes: v.optional(v.number()),
    declaredPairedVideoSizeBytes: v.optional(v.number()),
    storage: v.optional(storageReference),
    previewStorage: v.optional(storageReference),
    pairedVideoStorage: v.optional(storageReference),
    status: v.union(
      v.literal('draft'),
      v.literal('uploading'),
      v.literal('uploaded'),
      v.literal('failed'),
    ),
    failureReason: v.optional(v.string()),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index('by_circle', ['circleId'])
    .index('by_status', ['status'])
    .index('by_status_and_created_at', ['status', 'createdAt'])
    .index('by_asset', ['assetId'])
    .index('by_share_batch', ['shareBatchId'])
    .index('by_created_by', ['createdBy'])
    .index('by_share_batch_and_status', ['shareBatchId', 'status']),

  imageUploads: defineTable({
    targetKind: v.union(v.literal('user-profile'), v.literal('circle-image')),
    userId: v.id('users'),
    circleId: v.optional(v.id('circles')),
    providerKind: storageProviderKind,
    pendingStorage: v.optional(storageReference),
    storage: v.optional(storageReference),
    fileName: v.string(),
    mimeType: v.string(),
    sizeBytes: v.optional(v.number()),
    status: v.union(
      v.literal('uploading'),
      v.literal('uploaded'),
      v.literal('failed'),
    ),
    failureReason: v.optional(v.string()),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index('by_user', ['userId'])
    .index('by_circle', ['circleId'])
    .index('by_status_and_created_at', ['status', 'createdAt'])
    .index('by_target_kind_and_user', ['targetKind', 'userId']),

  waitlistEntries: defineTable({
    email: v.string(),
    normalizedEmail: v.string(),
    locale: v.union(v.literal('en'), v.literal('de')),
    source: v.literal('landing'),
    referrer: v.optional(v.string()),
    userAgent: v.optional(v.string()),
    firstSeenAt: v.number(),
    lastSeenAt: v.number(),
    submissionCount: v.number(),
  }).index('by_normalized_email', ['normalizedEmail']),

  activityEvents: defineTable({
    circleId: v.id('circles'),
    actorId: v.id('users'),
    type: v.string(),
    entityId: v.string(),
    shareBatchId: v.optional(v.id('shareBatches')),
    assetId: v.optional(v.id('assets')),
    commentId: v.optional(v.id('comments')),
    reactionId: v.optional(v.id('reactions')),
    createdAt: v.number(),
  })
    .index('by_circle', ['circleId'])
    .index('by_actor', ['actorId'])
    .index('by_share_batch', ['shareBatchId'])
    .index('by_circle_and_entity_id', ['circleId', 'entityId'])
    .index('by_circle_and_created_at', ['circleId', 'createdAt']),

  activityInboxItems: defineTable({
    activityEventId: v.id('activityEvents'),
    userId: v.id('users'),
    circleId: v.id('circles'),
    actorId: v.id('users'),
    type: v.string(),
    // Absent for circle-level activity (e.g. member.joined) that has no share.
    shareBatchId: v.optional(v.id('shareBatches')),
    assetId: v.optional(v.id('assets')),
    status: v.union(v.literal('unread'), v.literal('read')),
    createdAt: v.number(),
    readAt: v.optional(v.number()),
  })
    .index('by_user_and_created_at', ['userId', 'createdAt'])
    .index('by_actor', ['actorId'])
    .index('by_user_and_status_and_created_at', ['userId', 'status', 'createdAt'])
    .index('by_activity_event_id', ['activityEventId'])
    .index('by_share_batch', ['shareBatchId']),

  notificationDevices: defineTable({
    userId: v.id('users'),
    instanceUrl: v.string(),
    deviceToken: v.string(),
    provider: v.literal('expo'),
    platform: v.union(
      v.literal('ios'),
      v.literal('android'),
      v.literal('web'),
      v.literal('unknown'),
    ),
    appVersion: v.optional(v.string()),
    // BCP 47 tag reported by the app at registration; push copy is rendered
    // per device so a bilingual household gets each phone in its own language.
    locale: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastRegisteredAt: v.number(),
    disabledAt: v.optional(v.number()),
  })
    .index('by_user', ['userId'])
    .index('by_user_and_instance_url', ['userId', 'instanceUrl'])
    .index('by_user_and_instance_url_and_token', ['userId', 'instanceUrl', 'deviceToken'])
    .index('by_device_token', ['deviceToken']),

  notificationPreferences: defineTable({
    userId: v.id('users'),
    kind: v.union(
      v.literal('share.published'),
      v.literal('comment.created'),
      v.literal('reaction.set'),
      v.literal('member.joined'),
    ),
    enabled: v.boolean(),
    updatedAt: v.number(),
  }).index('by_user_and_kind', ['userId', 'kind']),

  notificationDeliveryAttempts: defineTable({
    activityEventId: v.id('activityEvents'),
    inboxItemId: v.optional(v.id('activityInboxItems')),
    userId: v.id('users'),
    deviceId: v.optional(v.id('notificationDevices')),
    circleId: v.id('circles'),
    kind: v.union(
      v.literal('share.published'),
      v.literal('comment.created'),
      v.literal('reaction.set'),
      v.literal('member.joined'),
    ),
    shareBatchId: v.optional(v.id('shareBatches')),
    assetId: v.optional(v.id('assets')),
    provider: v.literal('expo'),
    status: v.union(
      v.literal('queued'),
      v.literal('skipped'),
      v.literal('delivered'),
      v.literal('failed'),
    ),
    skipReason: v.optional(
      v.union(
        v.literal('provider_not_configured'),
        v.literal('no_device'),
        v.literal('preference_disabled'),
      ),
    ),
    errorMessage: v.optional(v.string()),
    providerMessageId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_user_and_created_at', ['userId', 'createdAt'])
    .index('by_activity_event_id', ['activityEventId'])
    .index('by_status_and_created_at', ['status', 'createdAt'])
    .index('by_status_and_updated_at', ['status', 'updatedAt'])
    .index('by_share_batch', ['shareBatchId']),

  comments: defineTable({
    shareBatchId: v.id('shareBatches'),
    assetId: v.optional(v.id('assets')),
    circleId: v.id('circles'),
    authorId: v.id('users'),
    targetKind: v.union(v.literal('share'), v.literal('asset')),
    targetKey: v.string(),
    body: v.string(),
    status: v.union(v.literal('active'), v.literal('deleted')),
    createdAt: v.number(),
    updatedAt: v.number(),
    deletedAt: v.optional(v.number()),
  })
    .index('by_share_batch', ['shareBatchId'])
    .index('by_author', ['authorId'])
    .index('by_asset', ['assetId'])
    .index('by_circle_and_share_batch', ['circleId', 'shareBatchId'])
    .index('by_share_batch_and_status', ['shareBatchId', 'status'])
    .index('by_share_target_status_created_at', [
      'shareBatchId',
      'targetKey',
      'status',
      'createdAt',
    ]),

  // Client compatibility gate, one singleton row (key 'default'), managed via
  // `npx convex run appConfig:set`. An absent row (fresh or self-hosted
  // instances) means no restrictions.
  appConfig: defineTable({
    key: v.string(),
    minSupportedAppVersion: v.optional(v.string()),
    forceUpdateMessage: v.optional(v.string()),
    maintenanceMode: v.optional(v.boolean()),
    maintenanceMessage: v.optional(v.string()),
    updatedAt: v.number(),
  }).index('by_key', ['key']),

  reactions: defineTable({
    shareBatchId: v.id('shareBatches'),
    assetId: v.optional(v.id('assets')),
    circleId: v.id('circles'),
    userId: v.id('users'),
    targetKind: v.union(v.literal('share'), v.literal('asset')),
    targetKey: v.string(),
    emoji: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_share_batch', ['shareBatchId'])
    .index('by_user', ['userId'])
    .index('by_asset', ['assetId'])
    .index('by_circle_and_share_batch', ['circleId', 'shareBatchId'])
    .index('by_share_target', ['shareBatchId', 'targetKey'])
    .index('by_share_target_user', ['shareBatchId', 'targetKey', 'userId']),
});
