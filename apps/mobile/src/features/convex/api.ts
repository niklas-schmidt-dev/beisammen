import { makeFunctionReference } from 'convex/server';

import type {
  AuthProvider,
  BillingStatus,
  CircleCreationReadiness,
  CircleUploadReadiness,
  CircleUsageBreakdown,
  ConnectionCheck,
  EngagementSummary,
  MediaLocation,
  NotificationDeviceRegistration,
  NotificationPreference,
  NotificationKind,
  PurchaseSyncResult,
  SignedReadUrl,
  StorageReference,
  StorageUsageStats,
  UploadTarget,
} from '@beisammen/contracts';

import type { AssetEncryptionEnvelope } from '@/features/crypto/asset-metadata';

type StoredAuthProvider = AuthProvider;

export interface ViewerRecord {
  _id: string;
  _creationTime: number;
  tokenIdentifier: string;
  authProvider: StoredAuthProvider;
  authSubject: string;
  email?: string;
  displayName?: string;
  avatarUrl?: string;
  createdAt: number;
  hasProfileImage: boolean;
  profileImageKey?: string;
  deletionRequestedAt?: number;
  deletionCompletedAt?: number;
}

export interface ViewerState {
  isAuthenticated: boolean;
  viewer: ViewerRecord | null;
}

export interface CircleListItem {
  _id: string;
  _creationTime: number;
  name: string;
  description: string;
  role: 'owner' | 'admin' | 'member';
  memberCount: number;
  createdAt: number;
  hasImage: boolean;
  imageKey?: string;
  canManage: boolean;
  canEdit: boolean;
  canInvite: boolean;
  canLeave: boolean;
  isOwner: boolean;
}

export interface CircleDetail extends CircleListItem {
  imageCount: number;
  videoCount: number;
  totalSizeBytes: number;
}

export interface CircleMemberRecord {
  _id: string;
  userId: string;
  role: 'owner' | 'admin' | 'member';
  joinedAt: number;
  isSelf: boolean;
  displayName: string;
  email?: string;
  avatarUrl?: string;
  hasProfileImage: boolean;
  canChangeRole: boolean;
  canRemove: boolean;
  canTransferOwnership: boolean;
}

export interface CircleInviteRecord {
  _id: string;
  circleId: string;
  mode: 'email' | 'open';
  invitedEmail: string | null;
  role: 'admin' | 'member';
  status: 'pending' | 'accepted' | 'expired' | 'revoked';
  expiresAt: number;
  acceptedAt: number | null;
  acceptedBy: {
    userId: string;
    displayName: string;
  } | null;
  invitedBy: {
    userId: string;
    displayName: string;
  };
  canRevoke: boolean;
}

export interface InvitePreview {
  inviteId: string;
  circleId: string;
  circleName: string;
  mode: 'email' | 'open';
  invitedEmail: string | null;
  role: 'admin' | 'member';
  status: 'pending' | 'accepted' | 'expired' | 'revoked';
  expiresAt: number;
  acceptedAt: number | null;
  acceptedBy: {
    userId: string;
    displayName: string;
  } | null;
  canAccept: boolean;
  emailMatchesViewer: boolean;
  isAlreadyMember: boolean;
}

export interface ShareAssetRecord {
  _id: string;
  _creationTime: number;
  kind: 'image' | 'video';
  fileName?: string;
  mimeType: string;
  sizeBytes?: number;
  storage: StorageReference;
  previewStorage?: StorageReference;
  pairedVideoStorage?: StorageReference;
  pairedVideoMimeType?: string;
  pairedVideoDurationSeconds?: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
  location?: MediaLocation;
  capturedAt?: number;
  encryption?: AssetEncryptionEnvelope;
  engagement: EngagementSummary;
}

export interface ShareFeedItem {
  _id: string;
  _creationTime: number;
  circleId: string;
  caption: string;
  assetCount: number;
  authorId: string;
  authorName: string;
  authorAvatarUrl?: string;
  authorHasProfileImage: boolean;
  authorProfileImageKey?: string;
  createdAtLabel: string;
  publishedAt: number;
  canDelete: boolean;
  engagement: EngagementSummary;
  heroAsset: ShareAssetRecord | null;
}

export interface ShareBatchRecord {
  _id: string;
  _creationTime: number;
  circleId: string;
  caption: string;
  assetCount: number;
  authorId: string;
  authorName: string;
  authorAvatarUrl?: string;
  authorHasProfileImage: boolean;
  authorProfileImageKey?: string;
  createdAtLabel: string;
  publishedAt: number;
  canDelete: boolean;
  engagement: EngagementSummary;
  shareTargetEngagement: EngagementSummary;
  assets: ShareAssetRecord[];
}

export interface CommentRecord {
  _id: string;
  _creationTime: number;
  shareBatchId: string;
  circleId: string;
  targetKind: 'share' | 'asset';
  assetId: string | null;
  authorId: string;
  authorName: string;
  authorAvatarUrl?: string;
  authorHasProfileImage: boolean;
  authorProfileImageKey?: string;
  body: string;
  createdAt: number;
  updatedAt: number;
  canDelete: boolean;
}

export interface ReactionTargetRecord {
  targetKind: 'share' | 'asset';
  assetId: string | null;
  reactionCount: number;
  viewerReaction: string | null;
  topReactions: EngagementSummary['topReactions'];
}

export interface ActivityEventRecord {
  _id: string;
  _creationTime: number;
  circleId: string;
  circleName: string;
  actorId: string;
  actorName: string;
  actorAvatarUrl?: string;
  actorHasProfileImage: boolean;
  actorProfileImageKey?: string;
  type: 'share.published' | 'comment.created' | 'reaction.set' | 'member.joined' | string;
  /** Null for circle-level activity such as a member joining. */
  shareBatchId: string | null;
  assetId: string | null;
  displayText: string;
  createdAt: number;
  createdAtLabel: string;
}

export interface ActivityInboxSummary {
  unreadCount: number;
  hasUnread: boolean;
}

export interface ActivityInboxItemRecord {
  _id: string;
  _creationTime: number;
  activityEventId: string;
  circleId: string;
  circleName: string;
  actorId: string;
  actorName: string;
  actorAvatarUrl?: string;
  actorHasProfileImage: boolean;
  actorProfileImageKey?: string;
  type: 'share.published' | 'comment.created' | 'reaction.set' | 'member.joined' | string;
  /** Null for circle-level activity such as a member joining. */
  shareBatchId: string | null;
  assetId: string | null;
  status: 'unread' | 'read';
  readAt: number | null;
  displayText: string;
  createdAt: number;
  createdAtLabel: string;
}

export interface MemoryItemRecord {
  _id: string;
  _creationTime: number;
  circleId: string;
  circleName: string;
  shareBatchId: string;
  assetId: string;
  authorId: string;
  authorName: string;
  authorAvatarUrl?: string;
  authorHasProfileImage: boolean;
  authorProfileImageKey?: string;
  kind: 'image' | 'video';
  caption: string;
  timelineAt: number;
  capturedAt: number | null;
  publishedAt: number;
  monthKey: string | null;
  placeKey: string | null;
  placeLabel: string | null;
  location: MediaLocation | null;
  asset: {
    _id: string;
    _creationTime: number;
    kind: 'image' | 'video';
    fileName?: string;
    mimeType: string;
    sizeBytes?: number;
    previewStorage?: StorageReference;
    pairedVideoStorage?: StorageReference;
    pairedVideoMimeType?: string;
    pairedVideoDurationSeconds?: number;
    width?: number;
    height?: number;
    durationSeconds?: number;
    location?: MediaLocation;
    capturedAt?: number;
    encryption?: AssetEncryptionEnvelope;
  };
}

export type MemoryFilterArgs =
  | {
      kind: 'month';
      key: string;
    }
  | {
      kind: 'place';
      key: string;
    };

export interface MemoryMonthFacet {
  key: string;
  itemCount: number;
  latestTimelineAt: number;
  coverAssetId: string;
}

export interface MemoryPlaceFacet {
  key: string;
  label: string;
  latitude: number;
  longitude: number;
  itemCount: number;
  latestTimelineAt: number;
  coverAssetId: string;
}

export interface MemoryDiscoveryRecord {
  months: MemoryMonthFacet[];
  places: MemoryPlaceFacet[];
}

/**
 * Page item of `assets.listMetadataForCircle`: legacy assets carry plaintext
 * `location`, encrypted assets carry their sealed envelope instead (their GPS
 * lives inside `encMetadata` and is aggregated client-side).
 */
export interface AssetMetadataRecord {
  _id: string;
  shareBatchId: string;
  kind: 'image' | 'video';
  capturedAt?: number;
  createdAt: number;
  location?: MediaLocation;
  encryption?: AssetEncryptionEnvelope;
}

export interface DraftUploadRecord {
  _id: string;
  _creationTime: number;
  shareBatchId: string;
  circleId: string;
  kind: 'image' | 'video';
  fileName: string;
  mimeType: string;
  status: 'draft' | 'uploading' | 'failed';
  failureReason?: string;
  createdAt: number;
}

export interface ShareDraftRecord {
  _id: string;
  _creationTime: number;
  circleId: string;
  caption: string;
  assetCount: number;
  updatedAt: number;
  assets: ShareAssetRecord[];
  unresolvedUploads: DraftUploadRecord[];
}

export type UpsertViewerArgs = {
  email?: string;
  displayName?: string;
  avatarUrl?: string;
};

export type CreateCircleArgs = {
  name: string;
  description?: string;
};

export type UpdateCircleArgs = {
  circleId: string;
  name: string;
  description?: string;
};

export type CreateDraftArgs = {
  circleId: string;
};

export type CreateProfileImageTargetArgs = {
  mimeType: string;
  fileName: string;
  sizeBytes: number;
};

export type CreateCircleImageTargetArgs = {
  circleId: string;
  mimeType: string;
  fileName: string;
  sizeBytes: number;
};

export type PublishArgs = {
  shareBatchId: string;
  caption?: string;
};

export type ListCommentsArgs = {
  shareBatchId: string;
  assetId?: string;
  paginationOpts: PaginationOpts;
};

export type CreateCommentArgs = {
  shareBatchId: string;
  assetId?: string;
  body: string;
};

export type ReactionTargetArgs = {
  shareBatchId: string;
  assetId?: string;
};

export type SetReactionArgs = ReactionTargetArgs & {
  emoji: string;
};

export type RegisterNotificationDeviceArgs = {
  instanceUrl: string;
  token: string;
  platform: 'ios' | 'android' | 'web' | 'unknown';
  appVersion?: string;
  /** BCP 47 tag of the app UI language; push copy is rendered per device. */
  locale?: string;
};

export type CreateInviteArgs = {
  circleId: string;
  mode?: 'email' | 'open';
  invitedEmail?: string;
  role: 'admin' | 'member';
};

export type CreateUploadTargetArgs = {
  circleId: string;
  shareBatchId: string;
  mimeType: string;
  kind: 'image' | 'video';
  fileName: string;
  sizeBytes: number;
  previewSizeBytes: number;
  pairedVideoSizeBytes?: number;
  pairedVideoMimeType?: string;
};

export type PaginationOpts = {
  numItems: number;
  cursor: string | null;
};

export type PaginatedResult<T> = {
  page: T[];
  isDone: boolean;
  continueCursor: string;
};

export type PreparedUploadTarget = {
  uploadId: string;
  target: UploadTarget;
  previewTarget?: UploadTarget;
  pairedVideoTarget?: UploadTarget;
};

export type PreparedImageUploadTarget = PreparedUploadTarget;

export type CompleteUploadArgs = {
  uploadId: string;
  objectKey?: string;
  previewObjectKey?: string;
  pairedVideoObjectKey?: string;
  fileName?: string;
  sizeBytes?: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
  pairedVideoDurationSeconds?: number;
  location?: MediaLocation;
  capturedAt?: number;
};

export type AppClientConfig = {
  minSupportedAppVersion: string | null;
  forceUpdateMessage: string | null;
  maintenanceMode: boolean;
  maintenanceMessage: string | null;
};

export const api = {
  appConfig: {
    get: makeFunctionReference<'query', Record<string, never>, AppClientConfig | null>(
      'appConfig:get',
    ),
  },
  users: {
    viewer: makeFunctionReference<'query', Record<string, never>, ViewerRecord | null>(
      'users:viewer',
    ),
    viewerState: makeFunctionReference<'query', Record<string, never>, ViewerState>(
      'users:viewerState',
    ),
    upsertFromIdentity: makeFunctionReference<
      'mutation',
      UpsertViewerArgs,
      ViewerRecord | string | null
    >('users:upsertFromIdentity'),
    createProfileImageTarget: makeFunctionReference<
      'action',
      CreateProfileImageTargetArgs,
      PreparedImageUploadTarget
    >('users:createProfileImageTarget'),
    completeProfileImageUpload: makeFunctionReference<
      'action',
      { uploadId: string; objectKey?: string; sizeBytes?: number },
      { uploadId: string }
    >('users:completeProfileImageUpload'),
    removeProfileImage: makeFunctionReference<'action', Record<string, never>, { removed: boolean }>(
      'users:removeProfileImage',
    ),
    getProfileImageReadUrl: makeFunctionReference<
      'action',
      { userId?: string },
      SignedReadUrl
    >('users:getProfileImageReadUrl'),
  },
  accountDeletion: {
    deleteMyAccountData: makeFunctionReference<
      'action',
      Record<string, never>,
      { deleted: boolean }
    >('accountDeletion:deleteMyAccountData'),
  },
  invites: {
    create: makeFunctionReference<
      'mutation',
      CreateInviteArgs,
      { inviteId: string; token: string; inviteLink: string }
    >('invites:create'),
    listForCircle: makeFunctionReference<'query', { circleId: string }, CircleInviteRecord[]>(
      'invites:listForCircle',
    ),
    preview: makeFunctionReference<'query', { token: string }, InvitePreview | null>(
      'invites:preview',
    ),
    accept: makeFunctionReference<
      'mutation',
      { token: string },
      { inviteId: string; circleId: string }
    >('invites:accept'),
    revoke: makeFunctionReference<
      'mutation',
      { inviteId: string },
      { inviteId: string }
    >('invites:revoke'),
  },
  circles: {
    create: makeFunctionReference<'mutation', CreateCircleArgs, { circleId: string }>(
      'circles:create',
    ),
    listForViewer: makeFunctionReference<
      'query',
      { paginationOpts: PaginationOpts },
      PaginatedResult<CircleListItem>
    >(
      'circles:listForViewer',
    ),
    getById: makeFunctionReference<'query', { circleId: string }, CircleDetail | null>(
      'circles:getById',
    ),
    update: makeFunctionReference<'mutation', UpdateCircleArgs, { circleId: string }>(
      'circles:update',
    ),
    listMembers: makeFunctionReference<'query', { circleId: string }, CircleMemberRecord[]>(
      'circles:listMembers',
    ),
    updateMemberRole: makeFunctionReference<
      'mutation',
      { circleId: string; memberId: string; role: 'admin' | 'member' },
      { memberId: string; role: 'admin' | 'member' }
    >('circles:updateMemberRole'),
    removeMember: makeFunctionReference<
      'mutation',
      { circleId: string; memberId: string },
      { memberId: string }
    >('circles:removeMember'),
    transferOwnership: makeFunctionReference<
      'mutation',
      { circleId: string; targetMemberId: string },
      { circleId: string; ownerMemberId: string }
    >('circles:transferOwnership'),
    leave: makeFunctionReference<'mutation', { circleId: string }, { circleId: string }>(
      'circles:leave',
    ),
    deleteOwn: makeFunctionReference<'action', { circleId: string }, { circleId: string }>(
      'circles:deleteOwn',
    ),
    createImageTarget: makeFunctionReference<
      'action',
      CreateCircleImageTargetArgs,
      PreparedImageUploadTarget
    >('circles:createImageTarget'),
    completeImageUpload: makeFunctionReference<
      'action',
      { uploadId: string; objectKey?: string; sizeBytes?: number },
      { uploadId: string }
    >('circles:completeImageUpload'),
    removeImage: makeFunctionReference<
      'action',
      { circleId: string },
      { removed: boolean }
    >('circles:removeImage'),
    getImageReadUrl: makeFunctionReference<'action', { circleId: string }, SignedReadUrl>(
      'circles:getImageReadUrl',
    ),
  },
  shares: {
    getOrCreateDraft: makeFunctionReference<'mutation', CreateDraftArgs, { shareBatchId: string }>(
      'shares:getOrCreateDraft',
    ),
    getDraftForCircle: makeFunctionReference<
      'query',
      { circleId: string },
      ShareDraftRecord | null
    >('shares:getDraftForCircle'),
    updateDraft: makeFunctionReference<
      'mutation',
      { shareBatchId: string; caption?: string },
      { shareBatchId: string }
    >('shares:updateDraft'),
    getById: makeFunctionReference<'query', { shareBatchId: string }, ShareBatchRecord | null>(
      'shares:getById',
    ),
    publish: makeFunctionReference<
      'mutation',
      PublishArgs,
      { shareBatchId: string; assetCount: number }
    >('shares:publish'),
    listForCircle: makeFunctionReference<
      'query',
      { circleId: string; paginationOpts: PaginationOpts },
      PaginatedResult<ShareFeedItem>
    >('shares:listForCircle'),
    delete: makeFunctionReference<'action', { shareBatchId: string }, { shareBatchId: string }>(
      'shares:deleteShare',
    ),
  },
  uploads: {
    createTarget: makeFunctionReference<'action', CreateUploadTargetArgs, PreparedUploadTarget>(
      'uploads:createTarget',
    ),
    retry: makeFunctionReference<'action', { uploadId: string }, PreparedUploadTarget>(
      'uploads:retry',
    ),
    complete: makeFunctionReference<'action', CompleteUploadArgs, { assetId: string }>(
      'uploads:complete',
    ),
    discard: makeFunctionReference<
      'action',
      { uploadId: string },
      // `outcome` is absent on older self-hosted instances that predate idempotent discard.
      { uploadId: string; outcome?: 'discarded' | 'completed' | 'missing' }
    >(
      'uploads:discard',
    ),
  },
  assets: {
    listForShareBatch: makeFunctionReference<'query', { shareBatchId: string }, ShareAssetRecord[]>(
      'assets:listForShareBatch',
    ),
    getReadUrl: makeFunctionReference<
      'action',
      { assetId: string; variant?: 'preview' | 'original' | 'pairedVideo' },
      SignedReadUrl
    >(
      'assets:getReadUrl',
    ),
    deleteDraftAsset: makeFunctionReference<'action', { assetId: string }, { assetId: string }>(
      'assets:deleteDraftAsset',
    ),
    listMetadataForCircle: makeFunctionReference<
      'query',
      { circleId: string; paginationOpts: PaginationOpts },
      PaginatedResult<AssetMetadataRecord>
    >('assets:listMetadataForCircle'),
  },
  comments: {
    listForShare: makeFunctionReference<
      'query',
      ListCommentsArgs,
      PaginatedResult<CommentRecord>
    >('comments:listForShare'),
    create: makeFunctionReference<'mutation', CreateCommentArgs, { commentId: string }>(
      'comments:create',
    ),
    delete: makeFunctionReference<'mutation', { commentId: string }, { commentId: string }>(
      'comments:delete',
    ),
  },
  reactions: {
    listForShare: makeFunctionReference<
      'query',
      { shareBatchId: string },
      { targets: ReactionTargetRecord[] }
    >('reactions:listForShare'),
    set: makeFunctionReference<
      'mutation',
      SetReactionArgs,
      { reactionId: string; emoji: string }
    >('reactions:set'),
    remove: makeFunctionReference<'mutation', ReactionTargetArgs, { removed: boolean }>(
      'reactions:remove',
    ),
  },
  activity: {
    listForViewer: makeFunctionReference<
      'query',
      { paginationOpts: PaginationOpts },
      PaginatedResult<ActivityEventRecord>
    >('activity:listForViewer'),
    summaryForViewer: makeFunctionReference<
      'query',
      Record<string, never>,
      ActivityInboxSummary
    >('activity:summaryForViewer'),
    listInboxForViewer: makeFunctionReference<
      'query',
      { paginationOpts: PaginationOpts },
      PaginatedResult<ActivityInboxItemRecord>
    >('activity:listInboxForViewer'),
    markRead: makeFunctionReference<
      'mutation',
      { inboxItemId: string },
      { inboxItemId: string; status: 'read' }
    >('activity:markRead'),
    markManyRead: makeFunctionReference<
      'mutation',
      { inboxItemIds: string[] },
      { readCount: number }
    >('activity:markManyRead'),
  },
  memories: {
    listForViewer: makeFunctionReference<
      'query',
      { circleId?: string; filter?: MemoryFilterArgs; paginationOpts: PaginationOpts },
      PaginatedResult<MemoryItemRecord>
    >('memories:listForViewer'),
    discoveryForViewer: makeFunctionReference<
      'query',
      { circleId?: string },
      MemoryDiscoveryRecord
    >('memories:discoveryForViewer'),
  },
  notifications: {
    registerDevice: makeFunctionReference<
      'mutation',
      RegisterNotificationDeviceArgs,
      NotificationDeviceRegistration
    >('notifications:registerDevice'),
    unregisterDevice: makeFunctionReference<
      'mutation',
      { instanceUrl: string; token: string },
      { removed: boolean }
    >('notifications:unregisterDevice'),
    getPreferences: makeFunctionReference<
      'query',
      Record<string, never>,
      NotificationPreference[]
    >('notifications:getPreferences'),
    updatePreferences: makeFunctionReference<
      'mutation',
      { kind: NotificationKind; enabled: boolean },
      NotificationPreference
    >('notifications:updatePreferences'),
  },
  storageStats: {
    forViewer: makeFunctionReference<'query', Record<string, never>, StorageUsageStats>(
      'storageStats:forViewer',
    ),
    perCircleForViewer: makeFunctionReference<
      'query',
      Record<string, never>,
      CircleUsageBreakdown
    >('storageStats:perCircleForViewer'),
    checkConnection: makeFunctionReference<'action', Record<string, never>, ConnectionCheck>(
      'storageStats:checkConnection',
    ),
  },
  billing: {
    status: makeFunctionReference<'query', Record<string, never>, BillingStatus>(
      'billing:status',
    ),
    statusForCircle: makeFunctionReference<'query', { circleId: string }, BillingStatus>(
      'billing:statusForCircle',
    ),
    uploadReadinessForCircle: makeFunctionReference<
      'query',
      { circleId: string },
      CircleUploadReadiness | null
    >('billing:uploadReadinessForCircle'),
    circleCreationReadiness: makeFunctionReference<
      'query',
      Record<string, never>,
      CircleCreationReadiness | null
    >('billing:circleCreationReadiness'),
    // Absent on self-hosted instances that predate on-demand purchase sync;
    // callers treat failures as best-effort.
    syncPurchases: makeFunctionReference<'action', Record<string, never>, PurchaseSyncResult>(
      'billing:syncPurchases',
    ),
  },
} as const;
