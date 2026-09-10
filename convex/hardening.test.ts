/// <reference types="vite/client" />

import { convexTest, type TestConvex } from 'convex-test';
import type { UserIdentity } from 'convex/server';
import { describe, expect, test, vi } from 'vitest';

const rcMocks = vi.hoisted(() => ({
  hasEntitlement: vi.fn(),
  getActiveSubscriptions: vi.fn(),
  getCustomer: vi.fn(),
  syncSubscriber: vi.fn(),
}));

vi.mock('convex-revenuecat', async () => {
  const { httpActionGeneric } = await import('convex/server');

  return {
    RevenueCat: vi.fn(function RevenueCatMock() {
      return {
        hasEntitlement: rcMocks.hasEntitlement,
        getActiveSubscriptions: rcMocks.getActiveSubscriptions,
        getCustomer: rcMocks.getCustomer,
        syncSubscriber: rcMocks.syncSubscriber,
        httpHandler: () =>
          httpActionGeneric(async () => new Response(null, { status: 501 })),
      };
    }),
  };
});

const resendMocks = vi.hoisted(() => ({
  sendEmail: vi.fn(),
}));

vi.mock('@convex-dev/resend', () => ({
  Resend: vi.fn(function ResendMock() {
    return {
      sendEmail: resendMocks.sendEmail,
    };
  }),
}));

import { api, internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import {
  RETENTION_GRACE_MS,
  RETENTION_MAX_WARNINGS,
  RETENTION_WARNING_INTERVAL_MS,
} from './billingRetention';
import { CLOUD_PLAN_QUOTAS, currentPeriodKey } from './lib/billing/plans';
import { buildPublicInstanceConfigFromEnv } from './lib/httpHelpers';
import {
  DEFAULT_CLOUD_BILLING_PLANS,
  getDeploymentPolicyFromEnv,
} from './lib/instance';
import { verifyS3ObjectExists } from './lib/storage/s3';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);

// Media rows created by these tests reference the fake S3 bucket below. The
// convex-files upload path is gone, so signing credentials are provided
// globally and network access to the fake bucket is stubbed; individual tests
// still layer their own fetch spies on top of this stub (mockRestore returns
// to the stub, not to real fetch).
process.env.S3_ACCESS_KEY_ID = process.env.S3_ACCESS_KEY_ID ?? 'test-access-key';
process.env.S3_SECRET_ACCESS_KEY = process.env.S3_SECRET_ACCESS_KEY ?? 'test-secret-key';

const TEST_S3_BUCKET = 'media-bucket';
let testS3ObjectCounter = 0;

function testS3StorageReference(fileName: string): {
  provider: 's3';
  bucket: string;
  objectKey: string;
} {
  testS3ObjectCounter += 1;

  return {
    provider: 's3',
    bucket: TEST_S3_BUCKET,
    objectKey: `test/${testS3ObjectCounter}/${fileName}`,
  };
}

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url =
    typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

  if (!url.includes(`/${TEST_S3_BUCKET}/`)) {
    throw new Error(`Unexpected fetch in hardening tests: ${url}`);
  }

  if (init?.method === 'DELETE') {
    return new Response(null, { status: 204 });
  }

  return new Response(null, {
    status: 200,
    headers: { 'content-length': '2048' },
  });
}) as typeof fetch;

const EXPECTED_CIRCLE_INVITE_LIST_LIMIT = 100;
const EXPECTED_CIRCLE_MEMBER_LIST_LIMIT = 200;
const EXPECTED_STORAGE_STATS_CIRCLE_LIMIT = 100;
const EXPECTED_SHARE_ASSET_DISPLAY_LIMIT = 100;
const EXPECTED_ASSET_LINKED_UPLOAD_DELETE_LIMIT = 20;
const EXPECTED_SHARE_DELETE_BATCH_SIZE = 50;
const COMMENT_MAX_BODY_LENGTH = 1000;

type TestDb = TestConvex<typeof schema>;
type TestUser = ReturnType<TestDb['withIdentity']>;

function createTestDb() {
  return convexTest(schema, modules);
}

async function withDeploymentKind<T>(
  deploymentKind: 'cloud' | 'self-hosted',
  run: () => Promise<T>,
): Promise<T> {
  const originalPublicDeploymentKind = process.env.PUBLIC_DEPLOYMENT_KIND;
  process.env.PUBLIC_DEPLOYMENT_KIND = deploymentKind;

  try {
    return await run();
  } finally {
    if (originalPublicDeploymentKind === undefined) {
      delete process.env.PUBLIC_DEPLOYMENT_KIND;
    } else {
      process.env.PUBLIC_DEPLOYMENT_KIND = originalPublicDeploymentKind;
    }
  }
}

async function withS3SigningEnv<T>(run: () => Promise<T>): Promise<T> {
  const originalAccessKeyId = process.env.S3_ACCESS_KEY_ID;
  const originalSecretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

  process.env.S3_ACCESS_KEY_ID = 'test-access-key';
  process.env.S3_SECRET_ACCESS_KEY = 'test-secret-key';

  try {
    return await run();
  } finally {
    if (originalAccessKeyId === undefined) {
      delete process.env.S3_ACCESS_KEY_ID;
    } else {
      process.env.S3_ACCESS_KEY_ID = originalAccessKeyId;
    }

    if (originalSecretAccessKey === undefined) {
      delete process.env.S3_SECRET_ACCESS_KEY;
    } else {
      process.env.S3_SECRET_ACCESS_KEY = originalSecretAccessKey;
    }
  }
}

async function withResendKey<T>(run: () => Promise<T>): Promise<T> {
  const originalKey = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = 're_test_key';

  try {
    return await run();
  } finally {
    if (originalKey === undefined) {
      delete process.env.RESEND_API_KEY;
    } else {
      process.env.RESEND_API_KEY = originalKey;
    }
  }
}

async function withRevenueCatApiKey<T>(run: () => Promise<T>): Promise<T> {
  const originalKey = process.env.REVENUECAT_API_KEY;
  process.env.REVENUECAT_API_KEY = 'sk_test_revenuecat_key';

  try {
    return await run();
  } finally {
    if (originalKey === undefined) {
      delete process.env.REVENUECAT_API_KEY;
    } else {
      process.env.REVENUECAT_API_KEY = originalKey;
    }
  }
}

async function withRevenueCatSecret<T>(run: () => Promise<T>): Promise<T> {
  const originalSecret = process.env.REVENUECAT_WEBHOOK_AUTH;
  process.env.REVENUECAT_WEBHOOK_AUTH = 'rc_webhook_test_secret';

  try {
    return await run();
  } finally {
    if (originalSecret === undefined) {
      delete process.env.REVENUECAT_WEBHOOK_AUTH;
    } else {
      process.env.REVENUECAT_WEBHOOK_AUTH = originalSecret;
    }
  }
}

async function withoutExpoPushAccessToken<T>(run: () => Promise<T>): Promise<T> {
  const originalToken = process.env.EXPO_PUSH_ACCESS_TOKEN;
  delete process.env.EXPO_PUSH_ACCESS_TOKEN;

  try {
    return await run();
  } finally {
    if (originalToken === undefined) {
      delete process.env.EXPO_PUSH_ACCESS_TOKEN;
    } else {
      process.env.EXPO_PUSH_ACCESS_TOKEN = originalToken;
    }
  }
}

async function withExpoPushAccessToken<T>(run: () => Promise<T>): Promise<T> {
  const originalToken = process.env.EXPO_PUSH_ACCESS_TOKEN;
  process.env.EXPO_PUSH_ACCESS_TOKEN = 'expo-push-test-token';

  try {
    return await run();
  } finally {
    if (originalToken === undefined) {
      delete process.env.EXPO_PUSH_ACCESS_TOKEN;
    } else {
      process.env.EXPO_PUSH_ACCESS_TOKEN = originalToken;
    }
  }
}

function mockEntitledTier(tier: 'cloud_plus' | 'cloud_max' | null): void {
  rcMocks.hasEntitlement.mockReset();
  rcMocks.hasEntitlement.mockImplementation(
    async (_ctx: unknown, args: { entitlementId: string }) =>
      tier !== null && args.entitlementId === tier,
  );
}

const CLERK_TEST_ISSUER = 'https://test.clerk.accounts.dev';

function clerkIdentity(email: string, name = email): Partial<UserIdentity> {
  const subject = `user_${email.replace(/[^a-z0-9]+/gi, '_')}`;

  return {
    issuer: CLERK_TEST_ISSUER,
    subject,
    tokenIdentifier: `${CLERK_TEST_ISSUER}|${subject}`,
    email,
    name,
  };
}

async function upsertViewer(
  t: TestDb,
  email: string,
  displayName = email,
): Promise<{
  user: TestUser;
  viewer: Doc<'users'>;
}> {
  const user = t.withIdentity(clerkIdentity(email, displayName));
  const result = await user.mutation(api.users.upsertFromIdentity, {
    email,
    displayName,
  });

  if (typeof result !== 'object' || result === null || !('_id' in result)) {
    throw new Error('Expected upsertFromIdentity to return a viewer record.');
  }

  return {
    user,
    viewer: result as Doc<'users'>,
  };
}

async function createCircleFor(
  t: TestDb,
  email: string,
  name = 'Family',
): Promise<{
  user: TestUser;
  viewer: Doc<'users'>;
  circleId: Id<'circles'>;
}> {
  const { user, viewer } = await upsertViewer(t, email, email);
  const created = await user.mutation(api.circles.create, {
    name,
    description: 'Private circle',
  });

  return {
    user,
    viewer,
    circleId: created.circleId as Id<'circles'>,
  };
}

async function getCircleStats(t: TestDb, circleId: Id<'circles'>) {
  return await t.run(async (ctx) => {
    const db = ctx.db as unknown as {
      query: (tableName: string) => {
        withIndex: (
          indexName: string,
          range: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
        ) => { unique: () => Promise<unknown> };
      };
    };

    return await db
      .query('circleStats')
      .withIndex('by_circle', (q) => q.eq('circleId', circleId))
      .unique();
  });
}

async function listActivityEventsForEntity(
  t: TestDb,
  circleId: Id<'circles'>,
  entityId: string,
) {
  return await t.run(async (ctx) => {
    const events = [];

    for await (const event of ctx.db
      .query('activityEvents')
      .withIndex('by_circle', (q) => q.eq('circleId', circleId))) {
      if (event.entityId === entityId) {
        events.push(event);
      }
    }

    return events;
  });
}

async function countShareChildren(t: TestDb, shareBatchId: Id<'shareBatches'>) {
  return await t.run(async (ctx) => {
    let assetCount = 0;
    let uploadCount = 0;

    for await (const asset of ctx.db
      .query('assets')
      .withIndex('by_share_batch', (q) => q.eq('shareBatchId', shareBatchId))) {
      void asset;
      assetCount += 1;
    }

    for await (const upload of ctx.db
      .query('uploads')
      .withIndex('by_share_batch', (q) => q.eq('shareBatchId', shareBatchId))) {
      void upload;
      uploadCount += 1;
    }

    return { assetCount, uploadCount };
  });
}

async function countUploadsForShareBatch(t: TestDb, shareBatchId: Id<'shareBatches'>) {
  return await t.run(async (ctx) => {
    let count = 0;

    for await (const upload of ctx.db
      .query('uploads')
      .withIndex('by_share_batch', (q) => q.eq('shareBatchId', shareBatchId))) {
      void upload;
      count += 1;
    }

    return count;
  });
}

async function createLegacyInvite(input: {
  t: TestDb;
  circleId: Id<'circles'>;
  invitedBy: Id<'users'>;
  invitedEmail: string;
  token: string;
}) {
  return await input.t.run(async (ctx) => {
    return await ctx.db.insert('invites', {
      circleId: input.circleId,
      invitedEmail: input.invitedEmail,
      role: 'member',
      tokenHash: input.token,
      status: 'pending',
      invitedBy: input.invitedBy,
      expiresAt: Date.now() + 60_000,
    });
  });
}

async function createUploadedDraftAsset(input: {
  t: TestDb;
  user: TestUser;
  viewerId: Id<'users'>;
  circleId: Id<'circles'>;
  kind?: 'image' | 'video';
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
  capturedAt?: number;
  location?: {
    latitude: number;
    longitude: number;
    accuracyMeters?: number;
    label?: string;
    city?: string;
    region?: string;
    country?: string;
    source: 'embedded' | 'device-fallback';
  };
}) {
  const kind = input.kind ?? 'image';
  const fileName = input.fileName ?? (kind === 'image' ? 'photo.jpg' : 'clip.mp4');
  const mimeType = input.mimeType ?? (kind === 'image' ? 'image/jpeg' : 'video/mp4');
  const draft = await input.user.mutation(api.shares.getOrCreateDraft, {
    circleId: input.circleId,
  });
  const uploadId = await input.t.run(async (ctx) => {
    return await ctx.db.insert('uploads', {
      shareBatchId: draft.shareBatchId as Id<'shareBatches'>,
      circleId: input.circleId,
      createdBy: input.viewerId,
      providerKind: 's3',
      pendingStorage: testS3StorageReference(fileName),
      kind,
      fileName,
      mimeType,
      status: 'uploading',
      createdAt: Date.now(),
    });
  });
  const completed = await input.user.mutation(internal.uploads.finalizeComplete, {
    uploadId,
    fileName,
    sizeBytes: input.sizeBytes ?? 2048,
    ...(input.capturedAt !== undefined ? { capturedAt: input.capturedAt } : {}),
    ...(input.location !== undefined ? { location: input.location } : {}),
  });

  return {
    shareBatchId: draft.shareBatchId as Id<'shareBatches'>,
    uploadId,
    assetId: completed.assetId as Id<'assets'>,
  };
}

async function createPublishedShare(input: {
  t: TestDb;
  user: TestUser;
  viewerId: Id<'users'>;
  circleId: Id<'circles'>;
  fileName?: string;
  caption?: string;
  capturedAt?: number;
  location?: {
    latitude: number;
    longitude: number;
    accuracyMeters?: number;
    label?: string;
    city?: string;
    region?: string;
    country?: string;
    source: 'embedded' | 'device-fallback';
  };
}) {
  const uploaded = await createUploadedDraftAsset({
    t: input.t,
    user: input.user,
    viewerId: input.viewerId,
    circleId: input.circleId,
    fileName: input.fileName,
    capturedAt: input.capturedAt,
    location: input.location,
  });

  await input.user.mutation(api.shares.publish, {
    shareBatchId: uploaded.shareBatchId,
    ...(input.caption ? { caption: input.caption } : {}),
  });

  return uploaded;
}

async function countEngagementRows(input: {
  t: TestDb;
  shareBatchId: Id<'shareBatches'>;
}) {
  return await input.t.run(async (ctx) => {
    const db = ctx.db as unknown as {
      query: (tableName: string) => {
        withIndex: (
          indexName: string,
          range: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
        ) => AsyncIterable<unknown>;
      };
    };
    let comments = 0;
    let reactions = 0;

    for await (const comment of db
      .query('comments')
      .withIndex('by_share_batch', (q) => q.eq('shareBatchId', input.shareBatchId))) {
      void comment;
      comments += 1;
    }

    for await (const reaction of db
      .query('reactions')
      .withIndex('by_share_batch', (q) => q.eq('shareBatchId', input.shareBatchId))) {
      void reaction;
      reactions += 1;
    }

    return { comments, reactions };
  });
}

async function countActivityInboxRows(input: {
  t: TestDb;
  shareBatchId: Id<'shareBatches'>;
}) {
  return await input.t.run(async (ctx) => {
    const db = ctx.db as unknown as {
      query: (tableName: string) => {
        withIndex: (
          indexName: string,
          range: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
        ) => AsyncIterable<unknown>;
      };
    };
    let rows = 0;

    for await (const item of db
      .query('activityInboxItems')
      .withIndex('by_share_batch', (q) => q.eq('shareBatchId', input.shareBatchId))) {
      void item;
      rows += 1;
    }

    return rows;
  });
}

async function listNotificationDeliveryAttempts(input: {
  t: TestDb;
  shareBatchId: Id<'shareBatches'>;
}) {
  return await input.t.run(async (ctx) => {
    const db = ctx.db as unknown as {
      query: (tableName: string) => {
        withIndex: (
          indexName: string,
          range: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
        ) => { collect: () => Promise<Array<Record<string, unknown>>> };
      };
    };

    return await db
      .query('notificationDeliveryAttempts')
      .withIndex('by_share_batch', (q) => q.eq('shareBatchId', input.shareBatchId))
      .collect();
  });
}

async function listMemoryRowsForShare(input: {
  t: TestDb;
  shareBatchId: Id<'shareBatches'>;
}) {
  return await input.t.run(async (ctx) => {
    const db = ctx.db as unknown as {
      query: (tableName: string) => {
        withIndex: (
          indexName: string,
          range: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
        ) => { collect: () => Promise<Array<Record<string, unknown>>> };
      };
    };

    return await db
      .query('memoryItems')
      .withIndex('by_share_batch', (q) => q.eq('shareBatchId', input.shareBatchId))
      .collect();
  });
}

async function countNotificationDevices(input: {
  t: TestDb;
  userId: Id<'users'>;
}) {
  return await input.t.run(async (ctx) => {
    const db = ctx.db as unknown as {
      query: (tableName: string) => {
        withIndex: (
          indexName: string,
          range: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
        ) => { collect: () => Promise<Array<Record<string, unknown>>> };
      };
    };
    const devices = await db
      .query('notificationDevices')
      .withIndex('by_user', (q) => q.eq('userId', input.userId))
      .collect();

    return devices.length;
  });
}

async function createQueuedPushAttempt(input?: {
  disabledKind?: 'share.published' | 'comment.created' | 'reaction.set';
  locale?: string;
}) {
  const t = createTestDb();
  const owner = await createCircleFor(t, 'owner@example.com', 'Family Circle');
  const invite = await owner.user.mutation(api.invites.create, {
    circleId: owner.circleId,
    invitedEmail: 'member@example.com',
    role: 'member',
  });
  const member = await upsertViewer(t, 'member@example.com', 'Member');
  await member.user.mutation(api.invites.accept, { token: invite.token });
  await member.user.mutation(api.notifications.registerDevice, {
    instanceUrl: 'https://cloud.example.com',
    token: 'ExponentPushToken[member-device]',
    platform: 'ios',
    appVersion: '0.1.0',
    ...(input?.locale ? { locale: input.locale } : {}),
  });

  if (input?.disabledKind) {
    await member.user.mutation(api.notifications.updatePreferences, {
      kind: input.disabledKind,
      enabled: false,
    });
  }

  const published = await createPublishedShare({
    t,
    user: owner.user,
    viewerId: owner.viewer._id,
    circleId: owner.circleId,
    fileName: 'push-delivery.jpg',
  });
  const [attempt] = await listNotificationDeliveryAttempts({
    t,
    shareBatchId: published.shareBatchId,
  });

  if (!attempt) {
    throw new Error('Expected notification attempt to be created.');
  }

  return {
    t,
    owner,
    member,
    published,
    attempt: attempt as unknown as Doc<'notificationDeliveryAttempts'>,
  };
}

describe('instance discovery configuration', () => {
  test('builds cloud and self-hosted public instance manifests from env', () => {
    expect(
      buildPublicInstanceConfigFromEnv({
        PUBLIC_INSTANCE_BASE_URL: 'https://cloud.example.com/',
        PUBLIC_CONVEX_URL: 'https://cloud.convex.cloud/',
        PUBLIC_AUTH_PUBLISHABLE_KEY: 'pk_test_123',
        PUBLIC_DEPLOYMENT_KIND: 'cloud',
        PUBLIC_MINIMUM_APP_VERSION: '0.2.0',
      }),
    ).toMatchObject({
      instance: {
        baseUrl: 'https://cloud.example.com',
      },
      backend: {
        convexUrl: 'https://cloud.convex.cloud',
      },
      auth: {
        provider: 'clerk',
        mode: 'native',
        publicConfig: {
          publishableKey: 'pk_test_123',
        },
      },
      deployment: {
        kind: 'cloud',
      },
      billing: {
        enabled: true,
        provider: 'revenuecat',
      },
      client: {
        minimumAppVersion: '0.2.0',
      },
    });

    expect(
      buildPublicInstanceConfigFromEnv({
        PUBLIC_INSTANCE_BASE_URL: 'https://home.example.com',
        PUBLIC_CONVEX_URL: 'https://home.convex.cloud',
        PUBLIC_AUTH_PUBLISHABLE_KEY: 'pk_test_home',
        PUBLIC_DEPLOYMENT_KIND: 'self-hosted',
      }),
    ).toMatchObject({
      auth: {
        provider: 'clerk',
        publicConfig: {
          publishableKey: 'pk_test_home',
        },
      },
      deployment: {
        kind: 'self-hosted',
      },
      billing: {
        enabled: false,
      },
    });
  });

  test('instance manifests require a Clerk publishable key', () => {
    expect(() =>
      buildPublicInstanceConfigFromEnv({
        PUBLIC_INSTANCE_BASE_URL: 'https://cloud.example.com/',
        PUBLIC_CONVEX_URL: 'https://cloud.convex.cloud/',
        PUBLIC_DEPLOYMENT_KIND: 'cloud',
      }),
    ).toThrow(/PUBLIC_AUTH_PUBLISHABLE_KEY/i);
  });
});

describe('deployment billing policy', () => {
  test('defaults to a cloud deployment with RevenueCat billing', () => {
    expect(getDeploymentPolicyFromEnv({})).toEqual({
      kind: 'cloud',
      isCloud: true,
      isSelfHosted: false,
      billing: {
        enabled: true,
        provider: 'revenuecat',
      },
    });
  });

  test('self-hosted deployments disable billing', () => {
    expect(getDeploymentPolicyFromEnv({ PUBLIC_DEPLOYMENT_KIND: 'self-hosted' })).toEqual({
      kind: 'self-hosted',
      isCloud: false,
      isSelfHosted: true,
      billing: {
        enabled: false,
      },
    });
  });

  test('default cloud billing plans are paid-only', () => {
    expect(DEFAULT_CLOUD_BILLING_PLANS.map((plan) => plan.id)).toEqual([
      'cloud_plus',
      'cloud_max',
    ]);
    expect(
      DEFAULT_CLOUD_BILLING_PLANS.some((plan) =>
        `${plan.id} ${plan.name} ${plan.monthlyPriceLabel ?? ''}`
          .toLowerCase()
          .includes('free'),
      ),
    ).toBe(false);
  });

  test('plan tiers define hard storage and circle quotas without upload count limits', () => {
    expect(CLOUD_PLAN_QUOTAS.cloud_plus.storageBytes).toBe(100 * 1024 ** 3);
    expect(CLOUD_PLAN_QUOTAS.cloud_plus.maxCircles).toBe(3);
    expect(CLOUD_PLAN_QUOTAS.cloud_max.storageBytes).toBe(250 * 1024 ** 3);
    expect(CLOUD_PLAN_QUOTAS.cloud_max.maxCircles).toBe(10);
    expect(CLOUD_PLAN_QUOTAS.cloud_plus).not.toHaveProperty('monthlyUploads');
    expect(currentPeriodKey(Date.UTC(2026, 7, 16))).toBe('2026-08');
    expect(currentPeriodKey(Date.UTC(2026, 11, 31, 23, 59))).toBe('2026-12');
  });
});

describe('viewer bootstrap', () => {
  test('upsertFromIdentity returns a serialized viewer record for new and existing users', async () => {
    const t = createTestDb();
    const user = t.withIdentity(clerkIdentity('ada@example.com', 'Ada'));

    const created = await user.mutation(api.users.upsertFromIdentity, {
      email: 'ada@example.com',
      displayName: 'Ada',
    });

    expect(created).toMatchObject({
      email: 'ada@example.com',
      displayName: 'Ada',
      authProvider: 'clerk',
      hasProfileImage: false,
    });
    expect(typeof created).toBe('object');

    const updated = await user.mutation(api.users.upsertFromIdentity, {
      displayName: 'Ada Lovelace',
    });

    expect(updated).toMatchObject({
      _id: (created as { _id: string })._id,
      email: 'ada@example.com',
      displayName: 'Ada Lovelace',
    });
  });
});

describe('invites', () => {
  test('new invites store hashed tokens and raw legacy tokens still resolve', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');

    const created = await owner.user.mutation(api.invites.create, {
      circleId: owner.circleId,
      invitedEmail: 'friend@example.com',
      role: 'member',
    });
    const stored = await t.run(async (ctx) => await ctx.db.get(created.inviteId));

    expect(stored?.tokenHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(stored?.tokenHash).not.toBe(created.token);

    const invitee = await upsertViewer(t, 'friend@example.com', 'Friend');
    await createLegacyInvite({
      t,
      circleId: owner.circleId,
      invitedBy: owner.viewer._id,
      invitedEmail: 'friend@example.com',
      token: 'legacy-token',
    });

    await expect(
      invitee.user.query(api.invites.preview, { token: created.token }),
    ).resolves.toMatchObject({
      circleId: owner.circleId,
      canAccept: true,
      emailMatchesViewer: true,
    });
    await expect(
      invitee.user.query(api.invites.preview, { token: 'legacy-token' }),
    ).resolves.toMatchObject({
      circleId: owner.circleId,
      canAccept: true,
      emailMatchesViewer: true,
    });
  });

  test('accept enforces pending status, expiry, and matching viewer email', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const mismatch = await upsertViewer(t, 'wrong@example.com', 'Wrong Account');
    const invite = await owner.user.mutation(api.invites.create, {
      circleId: owner.circleId,
      invitedEmail: 'target@example.com',
      role: 'member',
    });

    await expect(
      mismatch.user.query(api.invites.preview, { token: invite.token }),
    ).resolves.toMatchObject({
      canAccept: false,
      emailMatchesViewer: false,
    });
    await expect(mismatch.user.mutation(api.invites.accept, { token: invite.token })).rejects.toThrow(
      /email/i,
    );

    const target = await upsertViewer(t, 'target@example.com', 'Target');
    await t.run(async (ctx) => {
      const stored = await ctx.db.get(invite.inviteId);
      if (!stored) {
        throw new Error('invite missing');
      }
      await ctx.db.patch(stored._id, {
        expiresAt: Date.now() - 1,
      });
    });

    await expect(
      target.user.query(api.invites.preview, { token: invite.token }),
    ).resolves.toMatchObject({
      status: 'expired',
      canAccept: false,
    });
    await expect(target.user.mutation(api.invites.accept, { token: invite.token })).rejects.toThrow(
      /expired/i,
    );
  });

  test('open invites can be accepted once by any non-member viewer', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const firstInvitee = await upsertViewer(t, 'first@example.com', 'First Invitee');
    const secondInvitee = await upsertViewer(t, 'second@example.com', 'Second Invitee');
    const invite = await owner.user.mutation(api.invites.create, {
      circleId: owner.circleId,
      mode: 'open',
      role: 'member',
    });

    await expect(
      firstInvitee.user.query(api.invites.preview, { token: invite.token }),
    ).resolves.toMatchObject({
      mode: 'open',
      invitedEmail: null,
      canAccept: true,
      emailMatchesViewer: true,
      isAlreadyMember: false,
    });

    await expect(
      firstInvitee.user.mutation(api.invites.accept, { token: invite.token }),
    ).resolves.toMatchObject({
      inviteId: invite.inviteId,
      circleId: owner.circleId,
    });
    await expect(getCircleStats(t, owner.circleId)).resolves.toMatchObject({
      memberCount: 2,
    });

    await expect(
      secondInvitee.user.query(api.invites.preview, { token: invite.token }),
    ).resolves.toMatchObject({
      status: 'accepted',
      canAccept: false,
      acceptedBy: {
        userId: firstInvitee.viewer._id,
        displayName: 'First Invitee',
      },
    });
    await expect(
      secondInvitee.user.mutation(api.invites.accept, { token: invite.token }),
    ).rejects.toThrow(/pending/i);
  });

  test('open invite previews do not let existing members consume the link', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const invite = await owner.user.mutation(api.invites.create, {
      circleId: owner.circleId,
      mode: 'open',
      role: 'admin',
    });

    await expect(owner.user.query(api.invites.preview, { token: invite.token })).resolves.toMatchObject({
      mode: 'open',
      role: 'admin',
      canAccept: false,
      isAlreadyMember: true,
    });
    await expect(owner.user.mutation(api.invites.accept, { token: invite.token })).rejects.toThrow(
      /already/i,
    );

    const stored = await t.run(async (ctx) => await ctx.db.get(invite.inviteId));
    expect(stored).toMatchObject({
      status: 'pending',
    });
    expect(stored?.acceptedAt).toBeUndefined();
    expect(stored?.acceptedBy).toBeUndefined();
  });

  test('invite list and revoke expose open invite metadata', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const openInvite = await owner.user.mutation(api.invites.create, {
      circleId: owner.circleId,
      mode: 'open',
      role: 'admin',
    });
    await owner.user.mutation(api.invites.create, {
      circleId: owner.circleId,
      mode: 'email',
      invitedEmail: 'email@example.com',
      role: 'member',
    });

    await expect(owner.user.query(api.invites.listForCircle, { circleId: owner.circleId })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          _id: openInvite.inviteId,
          mode: 'open',
          invitedEmail: null,
          role: 'admin',
          acceptedBy: null,
          canRevoke: true,
        }),
        expect.objectContaining({
          mode: 'email',
          invitedEmail: 'email@example.com',
          role: 'member',
        }),
      ]),
    );

    await owner.user.mutation(api.invites.revoke, { inviteId: openInvite.inviteId });

    await expect(owner.user.query(api.invites.listForCircle, { circleId: owner.circleId })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          _id: openInvite.inviteId,
          mode: 'open',
          status: 'revoked',
          canRevoke: false,
        }),
      ]),
    );
  });

  test('circle invite list is bounded to the newest expiring invites', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const totalInvites = EXPECTED_CIRCLE_INVITE_LIST_LIMIT + 5;
    const now = Date.now();

    await t.run(async (ctx) => {
      for (let index = 0; index < totalInvites; index++) {
        await ctx.db.insert('invites', {
          circleId: owner.circleId,
          invitedEmail: `invite-${index}@example.com`,
          role: 'member',
          tokenHash: `sha256:${String(index).padStart(64, '0')}`,
          status: 'pending',
          invitedBy: owner.viewer._id,
          expiresAt: now + index,
        });
      }
    });

    const invites = await owner.user.query(api.invites.listForCircle, {
      circleId: owner.circleId,
    });

    expect(invites).toHaveLength(EXPECTED_CIRCLE_INVITE_LIST_LIMIT);
    expect(invites[0]?.invitedEmail).toBe(`invite-${totalInvites - 1}@example.com`);
    expect(invites[invites.length - 1]?.invitedEmail).toBe(
      `invite-${totalInvites - EXPECTED_CIRCLE_INVITE_LIST_LIMIT}@example.com`,
    );
    expect(invites.some((invite) => invite.invitedEmail === 'invite-0@example.com')).toBe(false);
  });
});

describe('circle authorization and stats', () => {
  test('new circles store their owner as billing owner', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');

    const stored = await t.run(async (ctx) => await ctx.db.get(owner.circleId));

    expect(stored?.billingOwnerId).toBe(owner.viewer._id);
  });

  test('ownership transfer moves the billing owner', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const target = await upsertViewer(t, 'next-owner@example.com', 'Next Owner');
    const memberId = await t.run(async (ctx) => {
      return await ctx.db.insert('circleMembers', {
        circleId: owner.circleId,
        userId: target.viewer._id,
        role: 'member',
        joinedAt: Date.now(),
      });
    });

    await owner.user.mutation(api.circles.transferOwnership, {
      circleId: owner.circleId,
      targetMemberId: memberId,
    });

    const stored = await t.run(async (ctx) => await ctx.db.get(owner.circleId));

    expect(stored?.billingOwnerId).toBe(target.viewer._id);
  });

  test('circle billing context charges the owner for member usage', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const member = await upsertViewer(t, 'member@example.com', 'Member');

    await t.run(async (ctx) => {
      await ctx.db.insert('circleMembers', {
        circleId: owner.circleId,
        userId: member.viewer._id,
        role: 'member',
        joinedAt: Date.now(),
      });
    });

    const context = await member.user.query(internal.billing.getCircleOwnerForBilling, {
      circleId: owner.circleId,
    });

    expect(context.billingOwner._id).toBe(owner.viewer._id);
    expect(context.viewerId).toBe(member.viewer._id);
    expect(context.entityId).toBe(owner.circleId);
  });

  test('circle image upload authorization returns the circle billing owner', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');

    const context = await owner.user.query(internal.circles.authorizeImageUpload, {
      circleId: owner.circleId,
    });

    expect(context.billingOwner._id).toBe(owner.viewer._id);
    expect(context.circleId).toBe(owner.circleId);
  });

  test('circle billing status is visible only to the billing owner', async () => {
    await withDeploymentKind('cloud', async () => {
      const t = createTestDb();
      const owner = await createCircleFor(t, 'owner@example.com');
      const member = await upsertViewer(t, 'member@example.com', 'Member');

      await t.run(async (ctx) => {
        await ctx.db.insert('circleMembers', {
          circleId: owner.circleId,
          userId: member.viewer._id,
          role: 'member',
          joinedAt: Date.now(),
        });
      });

      await expect(
        member.user.query(api.billing.statusForCircle, {
          circleId: owner.circleId,
        }),
      ).rejects.toThrow(/billing owner/i);
      await expect(
        owner.user.query(api.billing.statusForCircle, {
          circleId: owner.circleId,
        }),
      ).resolves.toMatchObject({
        deployment: 'cloud',
        billing: {
          customerId: owner.viewer._id,
        },
      });
    });
  });

  test('cloud billing status exposes the active RevenueCat entitlement for the viewer', async () => {
    await withDeploymentKind('cloud', async () => {
      await withRevenueCatSecret(async () => {
        mockEntitledTier('cloud_plus');
        rcMocks.getActiveSubscriptions.mockResolvedValue([
          {
            productId: 'cloud_plus_monthly',
            entitlementIds: ['cloud_plus'],
            expirationAtMs: 1_750_000_000_000,
          },
        ]);
        rcMocks.getCustomer.mockResolvedValue({
          appUserId: 'ignored',
          managementUrl: 'https://apps.apple.com/account/subscriptions',
        });

        const t = createTestDb();
        const { user, viewer } = await upsertViewer(t, 'owner@example.com', 'Owner');

        await expect(user.query(api.billing.status, {})).resolves.toMatchObject({
          deployment: 'cloud',
          billing: {
            provider: 'revenuecat',
            customerId: viewer._id,
          },
          activePlanIds: ['cloud_plus'],
          subscriptions: [
            {
              planId: 'cloud_plus',
              status: 'active',
              currentPeriodEnd: 1_750_000_000_000,
            },
          ],
          managementUrl: 'https://apps.apple.com/account/subscriptions',
        });
        expect(rcMocks.hasEntitlement).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ appUserId: viewer._id }),
        );
      });
    });
  });

  test('circle billing status exposes the active RevenueCat entitlement for the owner', async () => {
    await withDeploymentKind('cloud', async () => {
      await withRevenueCatSecret(async () => {
        mockEntitledTier('cloud_plus');
        rcMocks.getActiveSubscriptions.mockResolvedValue([
          {
            productId: 'cloud_plus_monthly',
            entitlementIds: ['cloud_plus'],
          },
        ]);
        rcMocks.getCustomer.mockResolvedValue(null);

        const t = createTestDb();
        const owner = await createCircleFor(t, 'owner@example.com');

        await expect(
          owner.user.query(api.billing.statusForCircle, {
            circleId: owner.circleId,
          }),
        ).resolves.toMatchObject({
          deployment: 'cloud',
          billing: {
            customerId: owner.viewer._id,
          },
          activePlanIds: ['cloud_plus'],
        });
      });
    });
  });

  test('cloud billing status treats a missing RevenueCat customer as no active plan', async () => {
    await withDeploymentKind('cloud', async () => {
      await withRevenueCatSecret(async () => {
        mockEntitledTier(null);
        rcMocks.getActiveSubscriptions.mockResolvedValue([]);
        rcMocks.getCustomer.mockResolvedValue(null);

        const t = createTestDb();
        const { user } = await upsertViewer(t, 'owner@example.com', 'Owner');

        await expect(user.query(api.billing.status, {})).resolves.toMatchObject({
          deployment: 'cloud',
          activePlanIds: [],
          subscriptions: [],
          balances: [],
        });
      });
    });
  });

  test('cloud billing status reports plan quotas and current usage', async () => {
    await withDeploymentKind('cloud', async () => {
      await withRevenueCatSecret(async () => {
        mockEntitledTier('cloud_plus');
        rcMocks.getActiveSubscriptions.mockResolvedValue([]);
        rcMocks.getCustomer.mockResolvedValue(null);

        const t = createTestDb();
        const { user, viewer } = await upsertViewer(t, 'owner@example.com', 'Owner');

        await t.run(async (ctx) => {
          await ctx.db.insert('billingUsage', {
            ownerId: viewer._id,
            periodKey: currentPeriodKey(),
            uploadCount: 12,
          });
          await ctx.db.insert('billingStorage', {
            ownerId: viewer._id,
            totalBytes: 4096,
          });
        });

        const status = await user.query(api.billing.status, {});

        expect(status.balances).toEqual([
          expect.objectContaining({
            featureId: 'storage_bytes',
            granted: CLOUD_PLAN_QUOTAS.cloud_plus.storageBytes,
            usage: 4096,
            overageAllowed: false,
          }),
          expect.objectContaining({
            featureId: 'circles',
            granted: CLOUD_PLAN_QUOTAS.cloud_plus.maxCircles,
            usage: 0,
            remaining: CLOUD_PLAN_QUOTAS.cloud_plus.maxCircles,
            overageAllowed: false,
          }),
        ]);
      });
    });
  });

  test('cloud billing status surfaces RevenueCat component errors', async () => {
    await withDeploymentKind('cloud', async () => {
      await withRevenueCatSecret(async () => {
        rcMocks.hasEntitlement.mockReset();
        rcMocks.hasEntitlement.mockRejectedValue(new Error('RevenueCat sync unavailable'));
        rcMocks.getActiveSubscriptions.mockResolvedValue([]);
        rcMocks.getCustomer.mockResolvedValue(null);

        const t = createTestDb();
        const { user } = await upsertViewer(t, 'owner@example.com', 'Owner');

        await expect(user.query(api.billing.status, {})).rejects.toThrow(
          /RevenueCat sync unavailable/i,
        );
      });
    });
  });

  test('cloud upload readiness allows owner uploads with an active entitlement under quota', async () => {
    await withDeploymentKind('cloud', async () => {
      await withRevenueCatSecret(async () => {
        mockEntitledTier('cloud_plus');
        const t = createTestDb();
        const owner = await createCircleFor(t, 'owner@example.com');

        await expect(
          owner.user.query(api.billing.uploadReadinessForCircle, {
            circleId: owner.circleId,
          }),
        ).resolves.toMatchObject({
          deployment: 'cloud',
          canUpload: true,
          viewerIsBillingOwner: true,
          billingRequired: true,
          reason: 'ready',
        });
        expect(rcMocks.hasEntitlement).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            appUserId: owner.viewer._id,
          }),
        );
      });
    });
  });

  test('cloud upload readiness blocks owner uploads without an active entitlement', async () => {
    await withDeploymentKind('cloud', async () => {
      await withRevenueCatSecret(async () => {
        // Create while entitled, then let the entitlement lapse.
        mockEntitledTier('cloud_plus');
        const t = createTestDb();
        const owner = await createCircleFor(t, 'owner@example.com');
        mockEntitledTier(null);

        await expect(
          owner.user.query(api.billing.uploadReadinessForCircle, {
            circleId: owner.circleId,
          }),
        ).resolves.toMatchObject({
          deployment: 'cloud',
          canUpload: false,
          viewerIsBillingOwner: true,
          billingRequired: true,
          reason: 'plan_required',
        });
      });
    });
  });

  test('cloud upload readiness blocks uploads once the storage quota is exhausted', async () => {
    await withDeploymentKind('cloud', async () => {
      await withRevenueCatSecret(async () => {
        mockEntitledTier('cloud_plus');
        const t = createTestDb();
        const owner = await createCircleFor(t, 'owner@example.com');

        await t.run(async (ctx) => {
          await ctx.db.insert('billingStorage', {
            ownerId: owner.viewer._id,
            totalBytes: CLOUD_PLAN_QUOTAS.cloud_plus.storageBytes,
          });
        });

        await expect(
          owner.user.query(api.billing.uploadReadinessForCircle, {
            circleId: owner.circleId,
          }),
        ).resolves.toMatchObject({
          deployment: 'cloud',
          canUpload: false,
          viewerIsBillingOwner: true,
          billingRequired: true,
          reason: 'quota_exceeded',
        });
      });
    });
  });

  test('cloud upload readiness ignores upload counts — only storage limits apply', async () => {
    await withDeploymentKind('cloud', async () => {
      await withRevenueCatSecret(async () => {
        mockEntitledTier('cloud_plus');
        const t = createTestDb();
        const owner = await createCircleFor(t, 'owner@example.com');

        await t.run(async (ctx) => {
          await ctx.db.insert('billingUsage', {
            ownerId: owner.viewer._id,
            periodKey: currentPeriodKey(),
            uploadCount: 1_000_000,
          });
        });

        await expect(
          owner.user.query(api.billing.uploadReadinessForCircle, {
            circleId: owner.circleId,
          }),
        ).resolves.toMatchObject({
          reason: 'ready',
          canUpload: true,
        });
      });
    });
  });

  test('cloud upload readiness distinguishes provider failures from missing plans', async () => {
    await withDeploymentKind('cloud', async () => {
      await withRevenueCatSecret(async () => {
        // Create while entitled; the provider outage starts afterwards.
        mockEntitledTier('cloud_plus');
        const t = createTestDb();
        const owner = await createCircleFor(t, 'owner@example.com');
        rcMocks.hasEntitlement.mockReset();
        rcMocks.hasEntitlement.mockRejectedValue(new Error('service unavailable'));

        await expect(
          owner.user.query(api.billing.uploadReadinessForCircle, {
            circleId: owner.circleId,
          }),
        ).resolves.toMatchObject({
          deployment: 'cloud',
          canUpload: false,
          viewerIsBillingOwner: true,
          billingRequired: true,
          reason: 'billing_check_failed',
        });
      });
    });
  });

  test('cloud upload readiness gives invited members only safe owner-required status', async () => {
    await withDeploymentKind('cloud', async () => {
      const t = createTestDb();
      const owner = await createCircleFor(t, 'owner@example.com');
      const member = await upsertViewer(t, 'member@example.com', 'Member');

      await t.run(async (ctx) => {
        await ctx.db.insert('circleMembers', {
          circleId: owner.circleId,
          userId: member.viewer._id,
          role: 'member',
          joinedAt: Date.now(),
        });
      });

      await expect(
        member.user.query(api.billing.uploadReadinessForCircle, {
          circleId: owner.circleId,
        }),
      ).resolves.toMatchObject({
        deployment: 'cloud',
        canUpload: false,
        viewerIsBillingOwner: false,
        billingRequired: true,
        reason: 'billing_not_configured',
      });
    });
  });

  test('self-hosted upload readiness always allows circle members', async () => {
    await withDeploymentKind('self-hosted', async () => {
      const t = createTestDb();
      const owner = await createCircleFor(t, 'owner@example.com');
      const member = await upsertViewer(t, 'member@example.com', 'Member');

      await t.run(async (ctx) => {
        await ctx.db.insert('circleMembers', {
          circleId: owner.circleId,
          userId: member.viewer._id,
          role: 'member',
          joinedAt: Date.now(),
        });
      });

      await expect(
        member.user.query(api.billing.uploadReadinessForCircle, {
          circleId: owner.circleId,
        }),
      ).resolves.toMatchObject({
        deployment: 'self-hosted',
        canUpload: true,
        viewerIsBillingOwner: false,
        billingRequired: false,
        reason: 'self_hosted',
      });
    });
  });

  test('circle creation requires an active plan when billing is configured', async () => {
    await withDeploymentKind('cloud', async () => {
      await withRevenueCatSecret(async () => {
        mockEntitledTier(null);
        const t = createTestDb();
        const { user } = await upsertViewer(t, 'owner@example.com', 'Owner');

        await expect(
          user.mutation(api.circles.create, { name: 'Family' }),
        ).rejects.toThrow(/active cloud plan is required to create a circle/i);
      });
    });
  });

  test('circle creation stops at the plan circle limit', async () => {
    await withDeploymentKind('cloud', async () => {
      await withRevenueCatSecret(async () => {
        mockEntitledTier('cloud_plus');
        const t = createTestDb();
        const { user } = await upsertViewer(t, 'owner@example.com', 'Owner');

        for (let index = 0; index < CLOUD_PLAN_QUOTAS.cloud_plus.maxCircles; index += 1) {
          await user.mutation(api.circles.create, { name: `Circle ${index + 1}` });
        }

        await expect(
          user.mutation(api.circles.create, { name: 'One too many' }),
        ).rejects.toThrow(/circle limit is reached/i);
      });
    });
  });

  test('circle creation stays open while cloud billing is not configured', async () => {
    await withDeploymentKind('cloud', async () => {
      const t = createTestDb();
      const { user } = await upsertViewer(t, 'owner@example.com', 'Owner');

      await expect(
        user.mutation(api.circles.create, { name: 'Family' }),
      ).resolves.toMatchObject({ circleId: expect.any(String) });
    });
  });

  test('a downgrade keeps existing circles but blocks creating new ones', async () => {
    await withDeploymentKind('cloud', async () => {
      await withRevenueCatSecret(async () => {
        mockEntitledTier('cloud_max');
        const t = createTestDb();
        const { user } = await upsertViewer(t, 'owner@example.com', 'Owner');

        for (let index = 0; index < CLOUD_PLAN_QUOTAS.cloud_plus.maxCircles + 1; index += 1) {
          await user.mutation(api.circles.create, { name: `Circle ${index + 1}` });
        }

        mockEntitledTier('cloud_plus');

        await expect(
          user.mutation(api.circles.create, { name: 'After downgrade' }),
        ).rejects.toThrow(/circle limit is reached/i);
        // Existing circles stay usable: upload readiness only meters uploads.
        const readiness = await user.query(api.billing.circleCreationReadiness, {});
        expect(readiness).toMatchObject({
          reason: 'limit_reached',
          canCreate: false,
          usedCircles: CLOUD_PLAN_QUOTAS.cloud_plus.maxCircles + 1,
          maxCircles: CLOUD_PLAN_QUOTAS.cloud_plus.maxCircles,
        });
      });
    });
  });

  test('ownership transfer requires the new owner to have a free circle slot', async () => {
    await withDeploymentKind('cloud', async () => {
      await withRevenueCatSecret(async () => {
        mockEntitledTier('cloud_plus');
        const t = createTestDb();
        const owner = await createCircleFor(t, 'owner@example.com');
        const member = await upsertViewer(t, 'member@example.com', 'Member');

        const memberMembershipId = await t.run(async (ctx) => {
          return await ctx.db.insert('circleMembers', {
            circleId: owner.circleId,
            userId: member.viewer._id,
            role: 'member',
            joinedAt: Date.now(),
          });
        });

        // Only the current owner is entitled; the member has no plan.
        rcMocks.hasEntitlement.mockReset();
        rcMocks.hasEntitlement.mockImplementation(
          async (_ctx: unknown, args: { appUserId: string; entitlementId: string }) =>
            args.appUserId === owner.viewer._id && args.entitlementId === 'cloud_plus',
        );

        await expect(
          owner.user.mutation(api.circles.transferOwnership, {
            circleId: owner.circleId,
            targetMemberId: memberMembershipId,
          }),
        ).rejects.toThrow(/new owner needs an active cloud plan/i);

        // Once the member subscribes, the transfer moves billing to them.
        mockEntitledTier('cloud_plus');
        await owner.user.mutation(api.circles.transferOwnership, {
          circleId: owner.circleId,
          targetMemberId: memberMembershipId,
        });

        const stored = await t.run(async (ctx) => await ctx.db.get(owner.circleId));
        expect(stored?.billingOwnerId).toBe(member.viewer._id);
      });
    });
  });

  test('circle creation readiness reports plan, slot, and limit state', async () => {
    await withDeploymentKind('cloud', async () => {
      await withRevenueCatSecret(async () => {
        mockEntitledTier(null);
        const t = createTestDb();
        const { user } = await upsertViewer(t, 'owner@example.com', 'Owner');

        await expect(user.query(api.billing.circleCreationReadiness, {})).resolves.toMatchObject({
          deployment: 'cloud',
          canCreate: false,
          reason: 'plan_required',
          usedCircles: 0,
          maxCircles: null,
        });

        mockEntitledTier('cloud_plus');
        await user.mutation(api.circles.create, { name: 'Family' });

        await expect(user.query(api.billing.circleCreationReadiness, {})).resolves.toMatchObject({
          deployment: 'cloud',
          canCreate: true,
          reason: 'ready',
          usedCircles: 1,
          maxCircles: CLOUD_PLAN_QUOTAS.cloud_plus.maxCircles,
        });
      });
    });
  });

  test('syncPurchases pulls the subscriber from RevenueCat and mirrors it into Convex', async () => {
    await withDeploymentKind('cloud', async () => {
      await withRevenueCatSecret(async () => {
        await withRevenueCatApiKey(async () => {
          mockEntitledTier(null);
          rcMocks.syncSubscriber.mockReset();
          const t = createTestDb();
          const { user, viewer } = await upsertViewer(t, 'owner@example.com', 'Owner');
          const subscriber = {
            entitlements: {
              cloud_plus: {
                product_identifier: 'cloud_plus_monthly',
                expires_date: '2999-01-01T00:00:00Z',
                purchase_date: '2026-08-22T08:00:00Z',
              },
            },
            subscriptions: {},
            original_app_user_id: viewer._id,
          };
          const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(JSON.stringify({ subscriber }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          );
          rcMocks.syncSubscriber.mockImplementation(async () => {
            // The mirrored entitlement becomes visible to the tier lookup.
            mockEntitledTier('cloud_plus');
            return { subscriptions: 0, entitlements: 1, nonSubscriptions: 0 };
          });

          try {
            await expect(user.action(api.billing.syncPurchases, {})).resolves.toEqual({
              status: 'synced',
              activePlanId: 'cloud_plus',
            });

            expect(fetchSpy).toHaveBeenCalledTimes(1);
            const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
            expect(url).toBe(
              `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(viewer._id)}`,
            );
            expect((init.headers as Record<string, string>).Authorization).toBe(
              'Bearer sk_test_revenuecat_key',
            );
            expect(rcMocks.syncSubscriber).toHaveBeenCalledWith(expect.anything(), {
              appUserId: viewer._id,
              subscriber,
            });
          } finally {
            fetchSpy.mockRestore();
          }
        });
      });
    });
  });

  test('syncPurchases reports failures without throwing and skips when unconfigured', async () => {
    await withDeploymentKind('cloud', async () => {
      await withRevenueCatSecret(async () => {
        mockEntitledTier(null);
        rcMocks.syncSubscriber.mockReset();
        const t = createTestDb();
        const { user } = await upsertViewer(t, 'owner@example.com', 'Owner');

        // Without REVENUECAT_API_KEY the action is a no-op.
        await expect(user.action(api.billing.syncPurchases, {})).resolves.toEqual({
          status: 'not_configured',
          activePlanId: null,
        });
        expect(rcMocks.syncSubscriber).not.toHaveBeenCalled();

        await withRevenueCatApiKey(async () => {
          const fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValue(new Response('nope', { status: 401 }));

          try {
            await expect(user.action(api.billing.syncPurchases, {})).resolves.toEqual({
              status: 'failed',
              activePlanId: null,
            });
            expect(rcMocks.syncSubscriber).not.toHaveBeenCalled();
          } finally {
            fetchSpy.mockRestore();
          }
        });
      });
    });

    await withDeploymentKind('self-hosted', async () => {
      const t = createTestDb();
      const { user } = await upsertViewer(t, 'owner@example.com', 'Owner');

      await expect(user.action(api.billing.syncPurchases, {})).resolves.toEqual({
        status: 'self_hosted',
        activePlanId: null,
      });
    });
  });

  test('self-hosted circle creation readiness is unrestricted', async () => {
    await withDeploymentKind('self-hosted', async () => {
      const t = createTestDb();
      const { user } = await upsertViewer(t, 'owner@example.com', 'Owner');

      await expect(user.query(api.billing.circleCreationReadiness, {})).resolves.toMatchObject({
        deployment: 'self-hosted',
        canCreate: true,
        billingRequired: false,
        reason: 'self_hosted',
      });
    });
  });

  test('retention sweep tracks lapsed owners with storage and clears on win-back', async () => {
    await withDeploymentKind('cloud', async () => {
      await withRevenueCatSecret(async () => {
        mockEntitledTier(null);
        const t = createTestDb();
        const { viewer } = await upsertViewer(t, 'owner@example.com', 'Owner');

        await t.run(async (ctx) => {
          await ctx.db.insert('billingStorage', { ownerId: viewer._id, totalBytes: 4096 });
        });

        await t.mutation(internal.billingRetention.sweep, {});

        const lapsedRow = await t.run(async (ctx) =>
          await ctx.db
            .query('billingRetention')
            .withIndex('by_owner', (q) => q.eq('ownerId', viewer._id))
            .unique(),
        );
        expect(lapsedRow).toMatchObject({ warningCount: 0 });
        expect(lapsedRow?.lapsedAt).toBeGreaterThan(0);

        // Re-subscribing clears the retention state entirely.
        mockEntitledTier('cloud_plus');
        await t.mutation(internal.billingRetention.sweep, {});

        const cleared = await t.run(async (ctx) =>
          await ctx.db
            .query('billingRetention')
            .withIndex('by_owner', (q) => q.eq('ownerId', viewer._id))
            .unique(),
        );
        expect(cleared).toBeNull();
      });
    });
  });

  test('retention sweep emails warnings after grace and marks deletable after the final one', async () => {
    await withDeploymentKind('cloud', async () => {
      await withRevenueCatSecret(async () => {
        await withResendKey(async () => {
          mockEntitledTier(null);
          resendMocks.sendEmail.mockReset();
          resendMocks.sendEmail.mockResolvedValue('email_id');

          const t = createTestDb();
          const { viewer } = await upsertViewer(t, 'owner@example.com', 'Owner');
          const longAgo = Date.now() - RETENTION_GRACE_MS - 1000;

          await t.run(async (ctx) => {
            await ctx.db.insert('billingStorage', { ownerId: viewer._id, totalBytes: 4096 });
            await ctx.db.insert('billingRetention', {
              ownerId: viewer._id,
              lapsedAt: longAgo,
              warningCount: 0,
              updatedAt: longAgo,
            });
          });

          await t.mutation(internal.billingRetention.sweep, {});

          expect(resendMocks.sendEmail).toHaveBeenCalledTimes(1);
          expect(resendMocks.sendEmail).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ to: 'owner@example.com' }),
          );

          let row = await t.run(async (ctx) =>
            await ctx.db
              .query('billingRetention')
              .withIndex('by_owner', (q) => q.eq('ownerId', viewer._id))
              .unique(),
          );
          expect(row).toMatchObject({ warningCount: 1 });
          expect(row?.deletableAt).toBeUndefined();

          // A sweep inside the 30-day warning interval sends nothing new.
          await t.mutation(internal.billingRetention.sweep, {});
          expect(resendMocks.sendEmail).toHaveBeenCalledTimes(1);

          // Fast-forward to the final warning: it sets the deletable marker.
          await t.run(async (ctx) => {
            const current = await ctx.db
              .query('billingRetention')
              .withIndex('by_owner', (q) => q.eq('ownerId', viewer._id))
              .unique();
            if (current) {
              await ctx.db.patch(current._id, {
                warningCount: RETENTION_MAX_WARNINGS - 1,
                lastWarnedAt: Date.now() - RETENTION_WARNING_INTERVAL_MS - 1000,
              });
            }
          });
          await t.mutation(internal.billingRetention.sweep, {});

          row = await t.run(async (ctx) =>
            await ctx.db
              .query('billingRetention')
              .withIndex('by_owner', (q) => q.eq('ownerId', viewer._id))
              .unique(),
          );
          expect(row).toMatchObject({ warningCount: RETENTION_MAX_WARNINGS });
          expect(row?.deletableAt).toBeGreaterThan(Date.now());

          // Once deletableAt passes, the owner shows up for manual cleanup.
          await t.run(async (ctx) => {
            const current = await ctx.db
              .query('billingRetention')
              .withIndex('by_owner', (q) => q.eq('ownerId', viewer._id))
              .unique();
            if (current) {
              await ctx.db.patch(current._id, { deletableAt: Date.now() - 1000 });
            }
          });
          const deletable = await t.query(internal.billingRetention.listDeletable, {});
          expect(deletable).toHaveLength(1);
          expect(deletable[0]).toMatchObject({
            ownerId: viewer._id,
            email: 'owner@example.com',
            totalBytes: 4096,
          });
        });
      });
    });
  });

  test('retention warnings are not counted while Resend is unconfigured', async () => {
    await withDeploymentKind('cloud', async () => {
      await withRevenueCatSecret(async () => {
        mockEntitledTier(null);
        resendMocks.sendEmail.mockReset();

        const t = createTestDb();
        const { viewer } = await upsertViewer(t, 'owner@example.com', 'Owner');
        const longAgo = Date.now() - RETENTION_GRACE_MS - 1000;

        await t.run(async (ctx) => {
          await ctx.db.insert('billingStorage', { ownerId: viewer._id, totalBytes: 4096 });
          await ctx.db.insert('billingRetention', {
            ownerId: viewer._id,
            lapsedAt: longAgo,
            warningCount: 0,
            updatedAt: longAgo,
          });
        });

        await t.mutation(internal.billingRetention.sweep, {});

        expect(resendMocks.sendEmail).not.toHaveBeenCalled();
        const row = await t.run(async (ctx) =>
          await ctx.db
            .query('billingRetention')
            .withIndex('by_owner', (q) => q.eq('ownerId', viewer._id))
            .unique(),
        );
        expect(row).toMatchObject({ warningCount: 0 });
      });
    });
  });

  test('circle stats track member count through create, accept, remove, and leave', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');

    await expect(getCircleStats(t, owner.circleId)).resolves.toMatchObject({
      circleId: owner.circleId,
      memberCount: 1,
      imageCount: 0,
      videoCount: 0,
      totalSizeBytes: 0,
    });

    const invite = await owner.user.mutation(api.invites.create, {
      circleId: owner.circleId,
      invitedEmail: 'admin@example.com',
      role: 'admin',
    });
    const admin = await upsertViewer(t, 'admin@example.com', 'Admin');
    await admin.user.mutation(api.invites.accept, { token: invite.token });

    await expect(getCircleStats(t, owner.circleId)).resolves.toMatchObject({
      memberCount: 2,
    });

    const membersAfterAccept = await owner.user.query(api.circles.listMembers, {
      circleId: owner.circleId,
    });
    const adminMembership = membersAfterAccept.find((member) => member.userId === admin.viewer._id);
    expect(adminMembership).toBeDefined();

    await owner.user.mutation(api.circles.removeMember, {
      circleId: owner.circleId,
      memberId: adminMembership!._id as Id<'circleMembers'>,
    });
    await expect(getCircleStats(t, owner.circleId)).resolves.toMatchObject({
      memberCount: 1,
    });

    const memberInvite = await owner.user.mutation(api.invites.create, {
      circleId: owner.circleId,
      invitedEmail: 'member@example.com',
      role: 'member',
    });
    const member = await upsertViewer(t, 'member@example.com', 'Member');
    await member.user.mutation(api.invites.accept, { token: memberInvite.token });
    await member.user.mutation(api.circles.leave, { circleId: owner.circleId });

    await expect(getCircleStats(t, owner.circleId)).resolves.toMatchObject({
      memberCount: 1,
    });
  });

  test('circle member list is bounded for large circles', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const extraMembers = EXPECTED_CIRCLE_MEMBER_LIST_LIMIT + 5;
    const now = Date.now();

    await t.run(async (ctx) => {
      for (let index = 0; index < extraMembers; index++) {
        const userId = await ctx.db.insert('users', {
          tokenIdentifier: `${CLERK_TEST_ISSUER}|user_member_${index}`,
          authProvider: 'clerk',
          authSubject: `user_member_${index}`,
          email: `member-${index}@example.com`,
          displayName: `Member ${String(index).padStart(3, '0')}`,
          createdAt: now + index,
        });

        await ctx.db.insert('circleMembers', {
          circleId: owner.circleId,
          userId,
          role: 'member',
          joinedAt: now + index,
        });
      }
    });

    const members = await owner.user.query(api.circles.listMembers, {
      circleId: owner.circleId,
    });

    expect(members).toHaveLength(EXPECTED_CIRCLE_MEMBER_LIST_LIMIT);
    expect(members.some((member) => member.userId === owner.viewer._id)).toBe(true);
    expect(
      members.some((member) => member.email === `member-${extraMembers - 1}@example.com`),
    ).toBe(false);
  });

  test('members cannot perform admin-only circle operations', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const invite = await owner.user.mutation(api.invites.create, {
      circleId: owner.circleId,
      invitedEmail: 'member@example.com',
      role: 'member',
    });
    const member = await upsertViewer(t, 'member@example.com', 'Member');
    await member.user.mutation(api.invites.accept, { token: invite.token });

    await expect(
      member.user.mutation(api.invites.create, {
        circleId: owner.circleId,
        invitedEmail: 'other@example.com',
        role: 'member',
      }),
    ).rejects.toThrow(/invite/i);
    await expect(
      member.user.mutation(api.circles.update, {
        circleId: owner.circleId,
        name: 'Renamed',
      }),
    ).rejects.toThrow(/edit/i);
    await expect(
      member.user.action(api.circles.createImageTarget, {
        circleId: owner.circleId,
        mimeType: 'image/jpeg',
        fileName: 'circle.jpg',
        sizeBytes: 2048,
      }),
    ).rejects.toThrow(/update the circle image/i);
  });

  test('viewer circle list is paginated and storage stats are bounded', async () => {
    const t = createTestDb();
    const { user, viewer } = await upsertViewer(t, 'collector@example.com', 'Collector');
    const circleIds: Id<'circles'>[] = [];

    for (let index = 0; index < 105; index++) {
      const created = await user.mutation(api.circles.create, {
        name: `Circle ${index.toString().padStart(3, '0')}`,
      });
      circleIds.push(created.circleId as Id<'circles'>);
    }

    const lastCircleId = circleIds[circleIds.length - 1]!;
    await createUploadedDraftAsset({
      t,
      user,
      viewerId: viewer._id,
      circleId: lastCircleId,
      sizeBytes: 1234,
    });

    const firstPage = await user.query(api.circles.listForViewer, {
      paginationOpts: { numItems: 20, cursor: null },
    });
    expect(firstPage.page).toHaveLength(20);
    expect(firstPage.isDone).toBe(false);
    expect(firstPage.page[0]?._id).toBe(lastCircleId);

    const secondPage = await user.query(api.circles.listForViewer, {
      paginationOpts: { numItems: 20, cursor: firstPage.continueCursor },
    });
    expect(secondPage.page).toHaveLength(20);
    expect(secondPage.page.some((circle) => circle._id === lastCircleId)).toBe(false);

    await expect(user.query(api.storageStats.forViewer, {})).resolves.toEqual({
      imageCount: 1,
      videoCount: 0,
      totalSizeBytes: 1234,
      circleCount: EXPECTED_STORAGE_STATS_CIRCLE_LIMIT,
      isTruncated: true,
    });
  });

  test('authenticated storage connection check reports missing S3 configuration', async () => {
    const originalBucket = process.env.S3_BUCKET;
    delete process.env.S3_BUCKET;

    try {
      const t = createTestDb();
      const { user } = await upsertViewer(t, 'storage@example.com', 'Storage Tester');

      await expect(user.action(api.storageStats.checkConnection, {})).resolves.toMatchObject({
        ok: false,
        message: expect.stringMatching(/S3_BUCKET|S3/i),
      });
    } finally {
      if (originalBucket === undefined) {
        delete process.env.S3_BUCKET;
      } else {
        process.env.S3_BUCKET = originalBucket;
      }
    }
  });
});

describe('shares, uploads, and feed', () => {
  test('S3 verification returns the server-observed object size', async () => {
    await withS3SigningEnv(async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(
          new Response(null, {
            status: 200,
            headers: {
              'content-length': '4096',
            },
          }),
        );

      try {
        await expect(
          verifyS3ObjectExists({
            storage: {
              provider: 's3',
              bucket: 'media-bucket',
              region: 'us-east-1',
              objectKey: 'circles/circle-1/share-1/photo.jpg',
            },
          }),
        ).resolves.toEqual({
          sizeBytes: 4096,
        });
      } finally {
        fetchSpy.mockRestore();
      }
    });
  });

  test('upload target authorization bills the circle owner for member uploads', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const member = await upsertViewer(t, 'member@example.com', 'Member');

    await t.run(async (ctx) => {
      await ctx.db.insert('circleMembers', {
        circleId: owner.circleId,
        userId: member.viewer._id,
        role: 'member',
        joinedAt: Date.now(),
      });
    });
    const draft = await member.user.mutation(api.shares.getOrCreateDraft, {
      circleId: owner.circleId,
    });

    const context = await member.user.query(internal.uploads.authorizeCreateTarget, {
      circleId: owner.circleId,
      shareBatchId: draft.shareBatchId as Id<'shareBatches'>,
      mimeType: 'image/jpeg',
      kind: 'image',
      fileName: 'photo.jpg',
      sizeBytes: 2048,
      previewSizeBytes: 512,
    });

    expect(context.billingOwner._id).toBe(owner.viewer._id);
    expect(context.circleId).toBe(owner.circleId);
    expect(context.shareBatchId).toBe(draft.shareBatchId);
  });

  test('cloud share deletion credits the storage gauge of the billing owner', async () => {
    await withDeploymentKind('cloud', async () => {
      await withRevenueCatSecret(async () => {
        mockEntitledTier('cloud_plus');
        const t = createTestDb();
        const owner = await createCircleFor(t, 'owner@example.com');
        const published = await createPublishedShare({
          t,
          user: owner.user,
          viewerId: owner.viewer._id,
          circleId: owner.circleId,
          fileName: 'cloud-delete.jpg',
        });

        await t.run(async (ctx) => {
          await ctx.db.insert('billingStorage', {
            ownerId: owner.viewer._id,
            totalBytes: 5000,
          });
        });

        await owner.user.action(api.shares.deleteShare, {
          shareBatchId: published.shareBatchId,
        });

        const storageRow = await t.run(async (ctx) =>
          await ctx.db
            .query('billingStorage')
            .withIndex('by_owner', (q) => q.eq('ownerId', owner.viewer._id))
            .unique(),
        );

        expect(storageRow?.totalBytes).toBe(5000 - 2048);
      });
    });
  });

  test('asset read urls can explicitly return preview or original storage', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const draft = await owner.user.mutation(api.shares.getOrCreateDraft, {
      circleId: owner.circleId,
    });
    const originalStorage = testS3StorageReference('original.jpg');
    const previewStorage = testS3StorageReference('preview.jpg');
    const assetId = await t.run(async (ctx) => {
      return await ctx.db.insert('assets', {
        shareBatchId: draft.shareBatchId as Id<'shareBatches'>,
        circleId: owner.circleId,
        kind: 'image',
        fileName: 'photo.jpg',
        mimeType: 'image/jpeg',
        storage: originalStorage,
        previewStorage,
        createdAt: Date.now(),
      });
    });

    const originalReadUrl = await owner.user.action(api.assets.getReadUrl, {
      assetId,
      variant: 'original',
    });
    const previewReadUrl = await owner.user.action(api.assets.getReadUrl, {
      assetId,
      variant: 'preview',
    });

    expect(originalReadUrl.url).toContain(originalStorage.objectKey);
    expect(previewReadUrl.url).toContain(previewStorage.objectKey);
  });

  test('asset read urls reject not-yet-migrated legacy convex-files storage', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const draft = await owner.user.mutation(api.shares.getOrCreateDraft, {
      circleId: owner.circleId,
    });
    const storageId = await t.run(async (ctx) => {
      return await ctx.storage.store(new Blob(['legacy'], { type: 'image/jpeg' }));
    });
    const assetId = await t.run(async (ctx) => {
      return await ctx.db.insert('assets', {
        shareBatchId: draft.shareBatchId as Id<'shareBatches'>,
        circleId: owner.circleId,
        kind: 'image',
        fileName: 'legacy.jpg',
        mimeType: 'image/jpeg',
        storage: {
          provider: 'convex-files',
          storageId,
        },
        createdAt: Date.now(),
      });
    });

    await expect(
      owner.user.action(api.assets.getReadUrl, {
        assetId,
        variant: 'original',
      }),
    ).rejects.toThrow(/Legacy media must be migrated to S3/i);
  });

  test('upload completion stores optional preview storage on the created asset', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const draft = await owner.user.mutation(api.shares.getOrCreateDraft, {
      circleId: owner.circleId,
    });
    const pendingStorage = testS3StorageReference('clip.mp4');
    const previewPendingStorage = testS3StorageReference('clip-preview.jpg');
    const uploadId = await t.run(async (ctx) => {
      return await ctx.db.insert('uploads', {
        shareBatchId: draft.shareBatchId as Id<'shareBatches'>,
        circleId: owner.circleId,
        createdBy: owner.viewer._id,
        providerKind: 's3',
        pendingStorage,
        previewPendingStorage,
        kind: 'video',
        fileName: 'clip.mp4',
        mimeType: 'video/mp4',
        status: 'uploading',
        createdAt: Date.now(),
      });
    });

    const completed = await owner.user.mutation(internal.uploads.finalizeComplete, {
      uploadId,
      previewObjectKey: previewPendingStorage.objectKey,
      fileName: 'clip.mp4',
      sizeBytes: 8192,
      durationSeconds: 12,
    });
    const storedAsset = await t.run(async (ctx) => {
      return await ctx.db.get(completed.assetId as Id<'assets'>);
    });

    expect(storedAsset).toMatchObject({
      kind: 'video',
      storage: pendingStorage,
      previewStorage: previewPendingStorage,
    });
  });

  test('draft asset metadata and read urls stay private to the draft author until published', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const invite = await owner.user.mutation(api.invites.create, {
      circleId: owner.circleId,
      invitedEmail: 'member@example.com',
      role: 'member',
    });
    const member = await upsertViewer(t, 'member@example.com', 'Member');
    await member.user.mutation(api.invites.accept, { token: invite.token });
    const uploaded = await createUploadedDraftAsset({
      t,
      user: owner.user,
      viewerId: owner.viewer._id,
      circleId: owner.circleId,
      fileName: 'private-draft.jpg',
      sizeBytes: 2048,
    });

    await expect(
      member.user.query(api.assets.listForShareBatch, {
        shareBatchId: uploaded.shareBatchId,
      }),
    ).rejects.toThrow(/draft/i);
    await expect(
      member.user.action(api.assets.getReadUrl, {
        assetId: uploaded.assetId,
        variant: 'original',
      }),
    ).rejects.toThrow(/draft/i);

    await owner.user.mutation(api.shares.publish, {
      shareBatchId: uploaded.shareBatchId,
    });

    await expect(
      member.user.query(api.assets.listForShareBatch, {
        shareBatchId: uploaded.shareBatchId,
      }),
    ).resolves.toHaveLength(1);

    const readUrl = await member.user.action(api.assets.getReadUrl, {
      assetId: uploaded.assetId,
      variant: 'original',
    });

    expect(readUrl.url).toEqual(expect.any(String));
  });

  test('standalone asset listing returns every draft asset up to the display bound', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const draft = await owner.user.mutation(api.shares.getOrCreateDraft, {
      circleId: owner.circleId,
    });
    const storageId = await t.run(async (ctx) => {
      return await ctx.storage.store(new Blob(['legacy'], { type: 'image/jpeg' }));
    });

    await t.run(async (ctx) => {
      for (let index = 0; index < 12; index++) {
        await ctx.db.insert('assets', {
          shareBatchId: draft.shareBatchId as Id<'shareBatches'>,
          circleId: owner.circleId,
          kind: 'image',
          fileName: `legacy-${index}.jpg`,
          mimeType: 'image/jpeg',
          storage: {
            provider: 'convex-files',
            storageId,
          },
          createdAt: Date.now() + index,
        });
      }
    });

    const assets = await owner.user.query(api.assets.listForShareBatch, {
      shareBatchId: draft.shareBatchId as Id<'shareBatches'>,
    });

    expect(assets).toHaveLength(12);
  });

  test('self-hosted standalone asset listing is bounded for large shares', async () => {
    await withDeploymentKind('self-hosted', async () => {
      const t = createTestDb();
      const owner = await createCircleFor(t, 'owner@example.com');
      const draft = await owner.user.mutation(api.shares.getOrCreateDraft, {
        circleId: owner.circleId,
      });
      const storageId = await t.run(async (ctx) => {
        return await ctx.storage.store(new Blob(['legacy'], { type: 'image/jpeg' }));
      });

      await t.run(async (ctx) => {
        for (let index = 0; index < EXPECTED_SHARE_ASSET_DISPLAY_LIMIT + 5; index++) {
          await ctx.db.insert('assets', {
            shareBatchId: draft.shareBatchId as Id<'shareBatches'>,
            circleId: owner.circleId,
            kind: 'image',
            fileName: `self-hosted-${index}.jpg`,
            mimeType: 'image/jpeg',
            storage: {
              provider: 'convex-files',
              storageId,
            },
            createdAt: Date.now() + index,
          });
        }
      });

      const assets = await owner.user.query(api.assets.listForShareBatch, {
        shareBatchId: draft.shareBatchId as Id<'shareBatches'>,
      });

      expect(assets).toHaveLength(EXPECTED_SHARE_ASSET_DISPLAY_LIMIT);
    });
  });

  test('only the draft author can finalize an upload into a share batch', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const invite = await owner.user.mutation(api.invites.create, {
      circleId: owner.circleId,
      invitedEmail: 'member@example.com',
      role: 'member',
    });
    const member = await upsertViewer(t, 'member@example.com', 'Member');
    await member.user.mutation(api.invites.accept, { token: invite.token });
    const draft = await owner.user.mutation(api.shares.getOrCreateDraft, {
      circleId: owner.circleId,
    });
    const uploadId = await t.run(async (ctx) => {
      return await ctx.db.insert('uploads', {
        shareBatchId: draft.shareBatchId as Id<'shareBatches'>,
        circleId: owner.circleId,
        createdBy: owner.viewer._id,
        providerKind: 's3',
        pendingStorage: testS3StorageReference('photo.jpg'),
        kind: 'image',
        fileName: 'photo.jpg',
        mimeType: 'image/jpeg',
        status: 'uploading',
        createdAt: Date.now(),
      });
    });

    await expect(
      member.user.mutation(internal.uploads.finalizeComplete, {
        uploadId,
        fileName: 'photo.jpg',
        sizeBytes: 2048,
      }),
    ).rejects.toThrow(/draft author/i);
  });

  test('uploads cannot be finalized after the draft is published', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const existing = await createUploadedDraftAsset({
      t,
      user: owner.user,
      viewerId: owner.viewer._id,
      circleId: owner.circleId,
      fileName: 'ready.jpg',
      sizeBytes: 1024,
    });
    await owner.user.mutation(api.shares.publish, {
      shareBatchId: existing.shareBatchId,
    });

    const uploadId = await t.run(async (ctx) => {
      return await ctx.db.insert('uploads', {
        shareBatchId: existing.shareBatchId,
        circleId: owner.circleId,
        createdBy: owner.viewer._id,
        providerKind: 's3',
        pendingStorage: testS3StorageReference('late.jpg'),
        kind: 'image',
        fileName: 'late.jpg',
        mimeType: 'image/jpeg',
        status: 'uploading',
        createdAt: Date.now(),
      });
    });

    await expect(
      owner.user.mutation(internal.uploads.finalizeComplete, {
        uploadId,
        fileName: 'late.jpg',
        sizeBytes: 2048,
      }),
    ).rejects.toThrow(/draft/i);
  });

  test('upload finalization accepts an eleventh draft asset', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    let shareBatchId: Id<'shareBatches'> | null = null;

    for (let index = 0; index < 10; index++) {
      const uploaded = await createUploadedDraftAsset({
        t,
        user: owner.user,
        viewerId: owner.viewer._id,
        circleId: owner.circleId,
        fileName: `photo-${index}.jpg`,
      });
      shareBatchId = uploaded.shareBatchId;
    }

    const uploadId = await t.run(async (ctx) => {
      return await ctx.db.insert('uploads', {
        shareBatchId: shareBatchId!,
        circleId: owner.circleId,
        createdBy: owner.viewer._id,
        providerKind: 's3',
        pendingStorage: testS3StorageReference('too-many.jpg'),
        kind: 'image',
        fileName: 'too-many.jpg',
        mimeType: 'image/jpeg',
        status: 'uploading',
        createdAt: Date.now(),
      });
    });

    await expect(
      owner.user.mutation(internal.uploads.finalizeComplete, {
        uploadId,
        fileName: 'too-many.jpg',
        sizeBytes: 1024,
      }),
    ).resolves.toMatchObject({
      assetId: expect.any(String),
    });
  });

  test('upload finalization rejects unsupported image MIME metadata', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const draft = await owner.user.mutation(api.shares.getOrCreateDraft, {
      circleId: owner.circleId,
    });
    const uploadId = await t.run(async (ctx) => {
      return await ctx.db.insert('uploads', {
        shareBatchId: draft.shareBatchId as Id<'shareBatches'>,
        circleId: owner.circleId,
        createdBy: owner.viewer._id,
        providerKind: 's3',
        pendingStorage: testS3StorageReference('animated.gif'),
        kind: 'image',
        fileName: 'animated.gif',
        mimeType: 'image/gif',
        status: 'uploading',
        createdAt: Date.now(),
      });
    });

    await expect(
      owner.user.mutation(internal.uploads.finalizeComplete, {
        uploadId,
        fileName: 'animated.gif',
        sizeBytes: 1024,
      }),
    ).rejects.toThrow(/file type/i);
  });

  test('upload finalization accepts large original media metadata', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const draft = await owner.user.mutation(api.shares.getOrCreateDraft, {
      circleId: owner.circleId,
    });
    const uploadId = await t.run(async (ctx) => {
      return await ctx.db.insert('uploads', {
        shareBatchId: draft.shareBatchId as Id<'shareBatches'>,
        circleId: owner.circleId,
        createdBy: owner.viewer._id,
        providerKind: 's3',
        pendingStorage: testS3StorageReference('large.jpg'),
        kind: 'image',
        fileName: 'large.jpg',
        mimeType: 'image/jpeg',
        status: 'uploading',
        createdAt: Date.now(),
      });
    });

    const completed = await owner.user.mutation(internal.uploads.finalizeComplete, {
      uploadId,
      fileName: 'large.jpg',
      sizeBytes: 512 * 1024 * 1024,
    });
    const storedAsset = await t.run(async (ctx) => {
      return await ctx.db.get(completed.assetId as Id<'assets'>);
    });

    expect(storedAsset).toMatchObject({
      fileName: 'large.jpg',
      sizeBytes: 512 * 1024 * 1024,
    });
  });

  test('upload finalization accepts videos of any duration', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const draft = await owner.user.mutation(api.shares.getOrCreateDraft, {
      circleId: owner.circleId,
    });
    const uploadId = await t.run(async (ctx) => {
      return await ctx.db.insert('uploads', {
        shareBatchId: draft.shareBatchId as Id<'shareBatches'>,
        circleId: owner.circleId,
        createdBy: owner.viewer._id,
        providerKind: 's3',
        pendingStorage: testS3StorageReference('long.mp4'),
        kind: 'video',
        fileName: 'long.mp4',
        mimeType: 'video/mp4',
        status: 'uploading',
        createdAt: Date.now(),
      });
    });

    await expect(
      owner.user.mutation(internal.uploads.finalizeComplete, {
        uploadId,
        fileName: 'long.mp4',
        sizeBytes: 1024,
        durationSeconds: 3600,
      }),
    ).resolves.toMatchObject({
      assetId: expect.any(String),
    });
  });

  test('upload finalization accepts videos without duration metadata', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const draft = await owner.user.mutation(api.shares.getOrCreateDraft, {
      circleId: owner.circleId,
    });
    const uploadId = await t.run(async (ctx) => {
      return await ctx.db.insert('uploads', {
        shareBatchId: draft.shareBatchId as Id<'shareBatches'>,
        circleId: owner.circleId,
        createdBy: owner.viewer._id,
        providerKind: 's3',
        pendingStorage: testS3StorageReference('missing-duration.mp4'),
        kind: 'video',
        fileName: 'missing-duration.mp4',
        mimeType: 'video/mp4',
        status: 'uploading',
        createdAt: Date.now(),
      });
    });

    await expect(
      owner.user.mutation(internal.uploads.finalizeComplete, {
        uploadId,
        fileName: 'missing-duration.mp4',
        sizeBytes: 1024,
      }),
    ).resolves.toMatchObject({
      assetId: expect.any(String),
    });
  });

  test('self-hosted upload finalization accepts long videos in large drafts', async () => {
    await withDeploymentKind('self-hosted', async () => {
      const t = createTestDb();
      const owner = await createCircleFor(t, 'owner@example.com');
      let shareBatchId: Id<'shareBatches'> | null = null;

      for (let index = 0; index < 10; index++) {
        const uploaded = await createUploadedDraftAsset({
          t,
          user: owner.user,
          viewerId: owner.viewer._id,
          circleId: owner.circleId,
          fileName: `self-hosted-${index}.jpg`,
        });
        shareBatchId = uploaded.shareBatchId;
      }

      const uploadId = await t.run(async (ctx) => {
        return await ctx.db.insert('uploads', {
          shareBatchId: shareBatchId!,
          circleId: owner.circleId,
          createdBy: owner.viewer._id,
          providerKind: 's3',
          pendingStorage: testS3StorageReference('long-self-hosted.mp4'),
          kind: 'video',
          fileName: 'long-self-hosted.mp4',
          mimeType: 'video/mp4',
          status: 'uploading',
          createdAt: Date.now(),
        });
      });

      await expect(
        owner.user.mutation(internal.uploads.finalizeComplete, {
          uploadId,
          fileName: 'long-self-hosted.mp4',
          sizeBytes: 1024,
          durationSeconds: 90,
        }),
      ).resolves.toMatchObject({
        assetId: expect.any(String),
      });

      await expect(countShareChildren(t, shareBatchId!)).resolves.toMatchObject({
        assetCount: 11,
      });
    });
  });

  test('large self-hosted shares return bounded assets with stored total counts', async () => {
    await withDeploymentKind('self-hosted', async () => {
      const t = createTestDb();
      const owner = await createCircleFor(t, 'owner@example.com');
      const now = Date.now();
      const totalAssets = EXPECTED_SHARE_ASSET_DISPLAY_LIMIT + 5;
      const draftShareBatchId = await t.run(async (ctx) => {
        return await ctx.db.insert('shareBatches', {
          circleId: owner.circleId,
          authorId: owner.viewer._id,
          assetCount: totalAssets,
          status: 'draft',
          createdAt: now,
          updatedAt: now,
        });
      });
      const publishedShareBatchId = await t.run(async (ctx) => {
        return await ctx.db.insert('shareBatches', {
          circleId: owner.circleId,
          authorId: owner.viewer._id,
          assetCount: totalAssets,
          status: 'published',
          createdAt: now,
          updatedAt: now,
          publishedAt: now,
        });
      });

      await t.run(async (ctx) => {
        for (const shareBatchId of [draftShareBatchId, publishedShareBatchId]) {
          for (let index = 0; index < totalAssets; index++) {
            const storageId = await ctx.storage.store(
              new Blob([`asset-${shareBatchId}-${index}`], { type: 'image/jpeg' }),
            );

            await ctx.db.insert('assets', {
              shareBatchId,
              circleId: owner.circleId,
              kind: 'image',
              fileName: `asset-${index}.jpg`,
              mimeType: 'image/jpeg',
              storage: {
                provider: 'convex-files',
                storageId,
              },
              createdAt: now + index,
            });
          }
        }
      });

      const draft = await owner.user.query(api.shares.getDraftForCircle, {
        circleId: owner.circleId,
      });
      const published = await owner.user.query(api.shares.getById, {
        shareBatchId: publishedShareBatchId,
      });

      expect(draft?.assetCount).toBe(totalAssets);
      expect(draft?.assets).toHaveLength(EXPECTED_SHARE_ASSET_DISPLAY_LIMIT);
      expect(published?.assetCount).toBe(totalAssets);
      expect(published?.assets).toHaveLength(EXPECTED_SHARE_ASSET_DISPLAY_LIMIT);
    });
  });

  test('draft share asset count is maintained as assets are finalized and deleted', async () => {
    await withDeploymentKind('self-hosted', async () => {
      const t = createTestDb();
      const owner = await createCircleFor(t, 'owner@example.com');
      const uploaded = await createUploadedDraftAsset({
        t,
        user: owner.user,
        viewerId: owner.viewer._id,
        circleId: owner.circleId,
        fileName: 'counted.jpg',
      });

      await expect(
        t.run(async (ctx) => await ctx.db.get(uploaded.shareBatchId)),
      ).resolves.toMatchObject({
        assetCount: 1,
      });

      await owner.user.action(api.assets.deleteDraftAsset, {
        assetId: uploaded.assetId,
      });

      await expect(
        t.run(async (ctx) => await ctx.db.get(uploaded.shareBatchId)),
      ).resolves.toMatchObject({
        assetCount: 0,
      });
    });
  });

  test('publish requires an uploaded asset and feed listing is paginated with a hero asset', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const draft = await owner.user.mutation(api.shares.getOrCreateDraft, {
      circleId: owner.circleId,
    });

    await expect(
      owner.user.mutation(api.shares.publish, { shareBatchId: draft.shareBatchId }),
    ).rejects.toThrow(/asset/i);

    const first = await createUploadedDraftAsset({
      t,
      user: owner.user,
      viewerId: owner.viewer._id,
      circleId: owner.circleId,
      fileName: 'first.jpg',
      sizeBytes: 1000,
    });
    await owner.user.mutation(api.shares.publish, {
      shareBatchId: first.shareBatchId,
      caption: 'First post',
    });

    const second = await createUploadedDraftAsset({
      t,
      user: owner.user,
      viewerId: owner.viewer._id,
      circleId: owner.circleId,
      fileName: 'second.jpg',
      sizeBytes: 2000,
    });
    await owner.user.mutation(api.shares.publish, {
      shareBatchId: second.shareBatchId,
      caption: 'Second post',
    });

    const firstPage = await owner.user.query(api.shares.listForCircle, {
      circleId: owner.circleId,
      paginationOpts: { numItems: 1, cursor: null },
    });

    expect(firstPage.page).toHaveLength(1);
    expect(firstPage.page[0]).toMatchObject({
      _id: second.shareBatchId,
      caption: 'Second post',
      assetCount: 1,
      heroAsset: {
        fileName: 'second.jpg',
      },
    });
    expect('assets' in firstPage.page[0]).toBe(false);
    expect(firstPage.isDone).toBe(false);

    const secondPage = await owner.user.query(api.shares.listForCircle, {
      circleId: owner.circleId,
      paginationOpts: { numItems: 1, cursor: firstPage.continueCursor },
    });

    expect(secondPage.page).toHaveLength(1);
    expect(secondPage.page[0]).toMatchObject({
      _id: first.shareBatchId,
      heroAsset: {
        fileName: 'first.jpg',
      },
    });
    expect(secondPage.isDone).toBe(true);
  });

  test('published shares expose share-level and asset-level comments and reactions to members', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const invite = await owner.user.mutation(api.invites.create, {
      circleId: owner.circleId,
      invitedEmail: 'member@example.com',
      role: 'member',
    });
    const member = await upsertViewer(t, 'member@example.com', 'Member');
    await member.user.mutation(api.invites.accept, { token: invite.token });
    const published = await createPublishedShare({
      t,
      user: owner.user,
      viewerId: owner.viewer._id,
      circleId: owner.circleId,
      fileName: 'engaged.jpg',
      caption: 'Engaged post',
    });

    const shareComment = await owner.user.mutation(api.comments.create, {
      shareBatchId: published.shareBatchId,
      body: 'This belongs to the whole post.',
    });
    const assetComment = await member.user.mutation(api.comments.create, {
      shareBatchId: published.shareBatchId,
      assetId: published.assetId,
      body: 'This is about the photo.',
    });
    await member.user.mutation(api.reactions.set, {
      shareBatchId: published.shareBatchId,
      emoji: '😍',
    });
    await owner.user.mutation(api.reactions.set, {
      shareBatchId: published.shareBatchId,
      assetId: published.assetId,
      emoji: '👍🏽',
    });

    await expect(
      member.user.query(api.comments.listForShare, {
        shareBatchId: published.shareBatchId,
        paginationOpts: { numItems: 10, cursor: null },
      }),
    ).resolves.toMatchObject({
      page: [
        {
          _id: shareComment.commentId,
          targetKind: 'share',
          assetId: null,
          body: 'This belongs to the whole post.',
          authorId: owner.viewer._id,
          canDelete: false,
        },
      ],
    });
    await expect(
      owner.user.query(api.comments.listForShare, {
        shareBatchId: published.shareBatchId,
        assetId: published.assetId,
        paginationOpts: { numItems: 10, cursor: null },
      }),
    ).resolves.toMatchObject({
      page: [
        {
          _id: assetComment.commentId,
          targetKind: 'asset',
          assetId: published.assetId,
          body: 'This is about the photo.',
          authorId: member.viewer._id,
          canDelete: true,
        },
      ],
    });

    const reactions = await member.user.query(api.reactions.listForShare, {
      shareBatchId: published.shareBatchId,
    });

    expect(reactions.targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetKind: 'share',
          assetId: null,
          reactionCount: 1,
          viewerReaction: '😍',
          topReactions: [
            {
              emoji: '😍',
              count: 1,
              reactedByViewer: true,
            },
          ],
        }),
        expect.objectContaining({
          targetKind: 'asset',
          assetId: published.assetId,
          reactionCount: 1,
          viewerReaction: null,
          topReactions: [
            {
              emoji: '👍🏽',
              count: 1,
              reactedByViewer: false,
            },
          ],
        }),
      ]),
    );

    const feed = await member.user.query(api.shares.listForCircle, {
      circleId: owner.circleId,
      paginationOpts: { numItems: 10, cursor: null },
    });
    const detail = await member.user.query(api.shares.getById, {
      shareBatchId: published.shareBatchId,
    });

    expect(feed.page[0]).toMatchObject({
      engagement: {
        commentCount: 2,
        reactionCount: 2,
        topReactions: [
          { emoji: '😍', count: 1, reactedByViewer: true },
          { emoji: '👍🏽', count: 1, reactedByViewer: false },
        ],
      },
    });
    expect(detail).toMatchObject({
      engagement: {
        commentCount: 2,
        reactionCount: 2,
      },
      shareTargetEngagement: {
        commentCount: 1,
        reactionCount: 1,
        topReactions: [
          { emoji: '😍', count: 1, reactedByViewer: true },
        ],
      },
      assets: [
        expect.objectContaining({
          _id: published.assetId,
          engagement: expect.objectContaining({
            commentCount: 1,
            reactionCount: 1,
          }),
        }),
      ],
    });
  });

  test('engagement APIs enforce membership, publication, and asset ownership', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const outsider = await upsertViewer(t, 'outsider@example.com', 'Outsider');
    const published = await createPublishedShare({
      t,
      user: owner.user,
      viewerId: owner.viewer._id,
      circleId: owner.circleId,
      fileName: 'published.jpg',
    });
    const otherPublished = await createPublishedShare({
      t,
      user: owner.user,
      viewerId: owner.viewer._id,
      circleId: owner.circleId,
      fileName: 'other.jpg',
    });
    const draft = await createUploadedDraftAsset({
      t,
      user: owner.user,
      viewerId: owner.viewer._id,
      circleId: owner.circleId,
      fileName: 'draft.jpg',
    });

    await expect(
      outsider.user.query(api.comments.listForShare, {
        shareBatchId: published.shareBatchId,
        paginationOpts: { numItems: 10, cursor: null },
      }),
    ).rejects.toThrow(/membership/i);
    await expect(
      outsider.user.mutation(api.comments.create, {
        shareBatchId: published.shareBatchId,
        body: 'No access.',
      }),
    ).rejects.toThrow(/membership/i);
    await expect(
      outsider.user.mutation(api.reactions.set, {
        shareBatchId: published.shareBatchId,
        emoji: '🔥',
      }),
    ).rejects.toThrow(/membership/i);
    await expect(
      owner.user.mutation(api.comments.create, {
        shareBatchId: draft.shareBatchId,
        body: 'Draft comment.',
      }),
    ).rejects.toThrow(/published/i);
    await expect(
      owner.user.mutation(api.reactions.set, {
        shareBatchId: draft.shareBatchId,
        emoji: '🔥',
      }),
    ).rejects.toThrow(/published/i);
    await expect(
      owner.user.mutation(api.comments.create, {
        shareBatchId: published.shareBatchId,
        assetId: otherPublished.assetId,
        body: 'Wrong asset.',
      }),
    ).rejects.toThrow(/asset/i);
    await expect(
      owner.user.mutation(api.reactions.set, {
        shareBatchId: published.shareBatchId,
        assetId: otherPublished.assetId,
        emoji: '🔥',
      }),
    ).rejects.toThrow(/asset/i);
  });

  test('reaction replacement and engagement validation keep one emoji reaction per user target', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const published = await createPublishedShare({
      t,
      user: owner.user,
      viewerId: owner.viewer._id,
      circleId: owner.circleId,
      fileName: 'reaction.jpg',
    });

    await owner.user.mutation(api.reactions.set, {
      shareBatchId: published.shareBatchId,
      emoji: '👍',
    });
    await owner.user.mutation(api.reactions.set, {
      shareBatchId: published.shareBatchId,
      emoji: '😍',
    });

    const reactions = await owner.user.query(api.reactions.listForShare, {
      shareBatchId: published.shareBatchId,
    });

    expect(reactions.targets).toEqual([
      {
        targetKind: 'share',
        assetId: null,
        reactionCount: 1,
        viewerReaction: '😍',
        topReactions: [
          {
            emoji: '😍',
            count: 1,
            reactedByViewer: true,
          },
        ],
      },
    ]);
    await expect(
      owner.user.mutation(api.reactions.set, {
        shareBatchId: published.shareBatchId,
        emoji: 'ok',
      }),
    ).rejects.toThrow(/emoji/i);
    await expect(
      owner.user.mutation(api.reactions.set, {
        shareBatchId: published.shareBatchId,
        emoji: '👍👍',
      }),
    ).rejects.toThrow(/single emoji/i);
    await expect(
      owner.user.mutation(api.comments.create, {
        shareBatchId: published.shareBatchId,
        body: '   ',
      }),
    ).rejects.toThrow(/comment/i);
    await expect(
      owner.user.mutation(api.comments.create, {
        shareBatchId: published.shareBatchId,
        body: 'x'.repeat(COMMENT_MAX_BODY_LENGTH + 1),
      }),
    ).rejects.toThrow(/1000/i);
  });

  test('comment deletion follows author, share author, and admin permissions', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const memberInvite = await owner.user.mutation(api.invites.create, {
      circleId: owner.circleId,
      invitedEmail: 'member@example.com',
      role: 'member',
    });
    const adminInvite = await owner.user.mutation(api.invites.create, {
      circleId: owner.circleId,
      invitedEmail: 'admin@example.com',
      role: 'admin',
    });
    const member = await upsertViewer(t, 'member@example.com', 'Member');
    const admin = await upsertViewer(t, 'admin@example.com', 'Admin');
    await member.user.mutation(api.invites.accept, { token: memberInvite.token });
    await admin.user.mutation(api.invites.accept, { token: adminInvite.token });
    const published = await createPublishedShare({
      t,
      user: owner.user,
      viewerId: owner.viewer._id,
      circleId: owner.circleId,
      fileName: 'comments.jpg',
    });
    const memberComment = await member.user.mutation(api.comments.create, {
      shareBatchId: published.shareBatchId,
      body: 'Member comment.',
    });
    const ownerComment = await owner.user.mutation(api.comments.create, {
      shareBatchId: published.shareBatchId,
      body: 'Owner comment.',
    });

    await expect(
      member.user.mutation(api.comments.delete, {
        commentId: ownerComment.commentId,
      }),
    ).rejects.toThrow(/delete/i);
    await expect(
      owner.user.mutation(api.comments.delete, {
        commentId: memberComment.commentId,
      }),
    ).resolves.toEqual({ commentId: memberComment.commentId });
    await expect(
      admin.user.mutation(api.comments.delete, {
        commentId: ownerComment.commentId,
      }),
    ).resolves.toEqual({ commentId: ownerComment.commentId });

    const remaining = await owner.user.query(api.comments.listForShare, {
      shareBatchId: published.shareBatchId,
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(remaining.page).toEqual([]);
  });

  test('share deletion removes comments and reactions with the deleted share', async () => {
    await withDeploymentKind('self-hosted', async () => {
      const t = createTestDb();
      const owner = await createCircleFor(t, 'owner@example.com');
      const invite = await owner.user.mutation(api.invites.create, {
        circleId: owner.circleId,
        invitedEmail: 'member@example.com',
        role: 'member',
      });
      const member = await upsertViewer(t, 'member@example.com', 'Member');
      await member.user.mutation(api.invites.accept, { token: invite.token });
      const published = await createPublishedShare({
        t,
        user: owner.user,
        viewerId: owner.viewer._id,
        circleId: owner.circleId,
        fileName: 'cleanup.jpg',
      });

      await owner.user.mutation(api.comments.create, {
        shareBatchId: published.shareBatchId,
        body: 'Delete me with the share.',
      });
      await owner.user.mutation(api.comments.create, {
        shareBatchId: published.shareBatchId,
        assetId: published.assetId,
        body: 'Delete this asset comment too.',
      });
      await owner.user.mutation(api.reactions.set, {
        shareBatchId: published.shareBatchId,
        emoji: '🔥',
      });
      await owner.user.mutation(api.reactions.set, {
        shareBatchId: published.shareBatchId,
        assetId: published.assetId,
        emoji: '📷',
      });

      await expect(countEngagementRows({ t, shareBatchId: published.shareBatchId })).resolves.toEqual({
        comments: 2,
        reactions: 2,
      });
      await expect(
        listActivityEventsForEntity(t, owner.circleId, published.shareBatchId),
      ).resolves.toHaveLength(5);
      await expect(
        countActivityInboxRows({ t, shareBatchId: published.shareBatchId }),
      ).resolves.toBeGreaterThan(0);
      await expect(
        listNotificationDeliveryAttempts({ t, shareBatchId: published.shareBatchId }),
      ).resolves.not.toHaveLength(0);

      await owner.user.action(api.shares.deleteShare, {
        shareBatchId: published.shareBatchId,
      });

      await expect(countEngagementRows({ t, shareBatchId: published.shareBatchId })).resolves.toEqual({
        comments: 0,
        reactions: 0,
      });
      await expect(
        listActivityEventsForEntity(t, owner.circleId, published.shareBatchId),
      ).resolves.toHaveLength(0);
      await expect(
        countActivityInboxRows({ t, shareBatchId: published.shareBatchId }),
      ).resolves.toBe(0);
      await expect(
        listNotificationDeliveryAttempts({ t, shareBatchId: published.shareBatchId }),
      ).resolves.toHaveLength(0);
    });
  });

  test('activity listing includes publish, comment, and reaction events for members only', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const invite = await owner.user.mutation(api.invites.create, {
      circleId: owner.circleId,
      invitedEmail: 'member@example.com',
      role: 'member',
    });
    const member = await upsertViewer(t, 'member@example.com', 'Member');
    await member.user.mutation(api.invites.accept, { token: invite.token });
    const outsiderCircle = await createCircleFor(t, 'outsider@example.com', 'Outsider Circle');
    const published = await createPublishedShare({
      t,
      user: owner.user,
      viewerId: owner.viewer._id,
      circleId: owner.circleId,
      fileName: 'activity.jpg',
    });

    await createPublishedShare({
      t,
      user: outsiderCircle.user,
      viewerId: outsiderCircle.viewer._id,
      circleId: outsiderCircle.circleId,
      fileName: 'outside.jpg',
    });
    await member.user.mutation(api.comments.create, {
      shareBatchId: published.shareBatchId,
      assetId: published.assetId,
      body: 'Activity comment.',
    });
    await owner.user.mutation(api.reactions.set, {
      shareBatchId: published.shareBatchId,
      emoji: '🔥',
    });

    const activity = await member.user.query(api.activity.listForViewer, {
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(activity.page).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          circleId: owner.circleId,
          actorId: owner.viewer._id,
          type: 'share.published',
          shareBatchId: published.shareBatchId,
          assetId: null,
        }),
        expect.objectContaining({
          circleId: owner.circleId,
          actorId: member.viewer._id,
          type: 'comment.created',
          shareBatchId: published.shareBatchId,
          assetId: published.assetId,
        }),
        expect.objectContaining({
          circleId: owner.circleId,
          actorId: owner.viewer._id,
          type: 'reaction.set',
          shareBatchId: published.shareBatchId,
          assetId: null,
        }),
      ]),
    );
    expect(activity.page.map((event) => event.circleId)).not.toContain(outsiderCircle.circleId);
    expect(activity.page.every((event) => event.displayText.length > 0)).toBe(true);
  });

  test('activity inbox creates unread recipient rows and pre-read actor self-events', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const invite = await owner.user.mutation(api.invites.create, {
      circleId: owner.circleId,
      invitedEmail: 'member@example.com',
      role: 'member',
    });
    const member = await upsertViewer(t, 'member@example.com', 'Member');
    await member.user.mutation(api.invites.accept, { token: invite.token });
    const published = await createPublishedShare({
      t,
      user: owner.user,
      viewerId: owner.viewer._id,
      circleId: owner.circleId,
      fileName: 'inbox.jpg',
    });

    await member.user.mutation(api.comments.create, {
      shareBatchId: published.shareBatchId,
      assetId: published.assetId,
      body: 'Inbox comment.',
    });
    await owner.user.mutation(api.reactions.set, {
      shareBatchId: published.shareBatchId,
      emoji: '🔥',
    });

    // Owner: the member's join + comment are unread; member: share + reaction.
    await expect(owner.user.query(api.activity.summaryForViewer, {})).resolves.toEqual({
      unreadCount: 2,
      hasUnread: true,
    });
    await expect(member.user.query(api.activity.summaryForViewer, {})).resolves.toEqual({
      unreadCount: 2,
      hasUnread: true,
    });

    const memberInbox = await member.user.query(api.activity.listInboxForViewer, {
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(memberInbox.page).toHaveLength(4);
    expect(memberInbox.page).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorId: member.viewer._id,
          type: 'member.joined',
          circleId: owner.circleId,
          shareBatchId: null,
          assetId: null,
          status: 'read',
        }),
        expect.objectContaining({
          actorId: owner.viewer._id,
          type: 'share.published',
          shareBatchId: published.shareBatchId,
          assetId: null,
          status: 'unread',
        }),
        expect.objectContaining({
          actorId: owner.viewer._id,
          type: 'reaction.set',
          shareBatchId: published.shareBatchId,
          assetId: null,
          status: 'unread',
        }),
        // Own action shows in the full history, but never as unread.
        expect.objectContaining({
          actorId: member.viewer._id,
          type: 'comment.created',
          shareBatchId: published.shareBatchId,
          assetId: published.assetId,
          status: 'read',
        }),
      ]),
    );

    const ownerInbox = await owner.user.query(api.activity.listInboxForViewer, {
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(ownerInbox.page).toHaveLength(4);
    expect(ownerInbox.page).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorId: member.viewer._id,
          type: 'member.joined',
          shareBatchId: null,
          status: 'unread',
        }),
        expect.objectContaining({
          actorId: member.viewer._id,
          type: 'comment.created',
          shareBatchId: published.shareBatchId,
          assetId: published.assetId,
          status: 'unread',
        }),
        expect.objectContaining({
          actorId: owner.viewer._id,
          type: 'share.published',
          status: 'read',
        }),
        expect.objectContaining({
          actorId: owner.viewer._id,
          type: 'reaction.set',
          status: 'read',
        }),
      ]),
    );
  });

  test('notification device registration is scoped by instance URL', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const first = await owner.user.mutation(api.notifications.registerDevice, {
      instanceUrl: 'https://cloud.example.com',
      token: 'ExponentPushToken[same-device]',
      platform: 'ios',
      appVersion: '0.1.0',
    });
    const duplicate = await owner.user.mutation(api.notifications.registerDevice, {
      instanceUrl: 'https://cloud.example.com',
      token: 'ExponentPushToken[same-device]',
      platform: 'ios',
      appVersion: '0.1.0',
    });
    const secondInstance = await owner.user.mutation(api.notifications.registerDevice, {
      instanceUrl: 'https://self.example.com',
      token: 'ExponentPushToken[same-device]',
      platform: 'ios',
      appVersion: '0.1.0',
    });

    expect(duplicate.deviceId).toBe(first.deviceId);
    expect(secondInstance.deviceId).not.toBe(first.deviceId);
    await expect(countNotificationDevices({ t, userId: owner.viewer._id })).resolves.toBe(2);
    await expect(
      t.run(async (ctx) => await ctx.db.get(first.deviceId as Id<'notificationDevices'>)),
    ).resolves.toMatchObject({ disabledAt: expect.any(Number) });
  });

  test('registering a push token disables the previous account registration', async () => {
    const t = createTestDb();
    const firstViewer = await upsertViewer(t, 'first@example.com', 'First');
    const secondViewer = await upsertViewer(t, 'second@example.com', 'Second');
    const token = 'ExponentPushToken[shared-device]';
    const first = await firstViewer.user.mutation(api.notifications.registerDevice, {
      instanceUrl: 'https://cloud.example.com',
      token,
      platform: 'ios',
    });

    await secondViewer.user.mutation(api.notifications.registerDevice, {
      instanceUrl: 'https://cloud.example.com',
      token,
      platform: 'ios',
    });

    await expect(
      t.run(async (ctx) => await ctx.db.get(first.deviceId as Id<'notificationDevices'>)),
    ).resolves.toMatchObject({ disabledAt: expect.any(Number) });
  });

  test('notification preferences default on and can be updated per kind', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');

    await expect(owner.user.query(api.notifications.getPreferences, {})).resolves.toEqual([
      { kind: 'share.published', enabled: true, updatedAt: null },
      { kind: 'comment.created', enabled: true, updatedAt: null },
      { kind: 'reaction.set', enabled: true, updatedAt: null },
      { kind: 'member.joined', enabled: true, updatedAt: null },
    ]);

    await owner.user.mutation(api.notifications.updatePreferences, {
      kind: 'reaction.set',
      enabled: false,
    });

    await expect(owner.user.query(api.notifications.getPreferences, {})).resolves.toEqual([
      { kind: 'share.published', enabled: true, updatedAt: null },
      { kind: 'comment.created', enabled: true, updatedAt: null },
      expect.objectContaining({ kind: 'reaction.set', enabled: false }),
      { kind: 'member.joined', enabled: true, updatedAt: null },
    ]);
  });

  test('notification attempts are inspectable and skipped without provider secrets', async () => {
    await withoutExpoPushAccessToken(async () => {
      const t = createTestDb();
      const owner = await createCircleFor(t, 'owner@example.com');
      const invite = await owner.user.mutation(api.invites.create, {
        circleId: owner.circleId,
        invitedEmail: 'member@example.com',
        role: 'member',
      });
      const member = await upsertViewer(t, 'member@example.com', 'Member');
      await member.user.mutation(api.invites.accept, { token: invite.token });
      await member.user.mutation(api.notifications.registerDevice, {
        instanceUrl: 'https://cloud.example.com',
        token: 'ExponentPushToken[member-device]',
        platform: 'android',
        appVersion: '0.1.0',
      });
      const published = await createPublishedShare({
        t,
        user: owner.user,
        viewerId: owner.viewer._id,
        circleId: owner.circleId,
        fileName: 'push.jpg',
      });

      await expect(
        listNotificationDeliveryAttempts({ t, shareBatchId: published.shareBatchId }),
      ).resolves.toEqual([
        expect.objectContaining({
          userId: member.viewer._id,
          kind: 'share.published',
          shareBatchId: published.shareBatchId,
          status: 'skipped',
          skipReason: 'provider_not_configured',
        }),
      ]);
    });
  });

  test('queued notification attempts are sent to Expo with bearer auth and deep-link payload', async () => {
    await withExpoPushAccessToken(async () => {
      const now = 1_725_000_000_000;
      const { attempt, owner, published, t } = await createQueuedPushAttempt();
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [{ status: 'ok', id: 'expo-receipt-1' }],
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      );

      try {
        await expect(
          owner.user.action(internal.notifications.dispatchQueued, { now }),
        ).resolves.toEqual({
          scanned: 1,
          sent: 1,
          failed: 0,
          retried: 0,
          skipped: 0,
        });

        expect(fetchSpy).toHaveBeenCalledTimes(1);
        const [, init] = fetchSpy.mock.calls[0]!;
        const request = init as { headers?: Record<string, string>; body?: string };
        const messages = JSON.parse(request.body ?? '[]') as Array<{
          to: string;
          title: string;
          body: string;
          data: Record<string, unknown>;
        }>;

        expect(fetchSpy.mock.calls[0]?.[0]).toBe('https://exp.host/--/api/v2/push/send');
        expect(request.headers).toMatchObject({
          Authorization: 'Bearer expo-push-test-token',
          'Content-Type': 'application/json',
        });
        expect(messages).toEqual([
          expect.objectContaining({
            to: 'ExponentPushToken[member-device]',
            title: 'owner@example.com hat etwas geteilt',
            body: 'Neuer Beitrag in Family Circle',
            // Unread inbox items for the member: the join is their own
            // (pre-read), so only the share counts.
            badge: 1,
            channelId: 'shares',
            threadId: owner.circleId,
            sound: 'default',
            priority: 'high',
            ttl: 24 * 60 * 60,
            data: expect.objectContaining({
              instanceUrl: expect.any(String),
              activityEventId: attempt.activityEventId,
              inboxItemId: attempt.inboxItemId,
              kind: 'share.published',
              circleId: owner.circleId,
              shareBatchId: published.shareBatchId,
            }),
          }),
        ]);
        expect(messages[0]).not.toHaveProperty('collapseId');
        await expect(t.run(async (ctx) => await ctx.db.get(attempt._id))).resolves.toMatchObject({
          status: 'queued',
          providerMessageId: 'expo-receipt-1',
          updatedAt: now,
        });
      } finally {
        fetchSpy.mockRestore();
      }
    });
  });

  test('Expo push ticket errors fail the notification attempt', async () => {
    await withExpoPushAccessToken(async () => {
      const now = 1_725_000_000_000;
      const { attempt, owner, t } = await createQueuedPushAttempt();
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [
              {
                status: 'error',
                message: 'The notification payload is invalid.',
                details: { error: 'MessageTooBig' },
              },
            ],
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      );

      try {
        await expect(
          owner.user.action(internal.notifications.dispatchQueued, { now }),
        ).resolves.toEqual({
          scanned: 1,
          sent: 0,
          failed: 1,
          retried: 0,
          skipped: 0,
        });
        await expect(t.run(async (ctx) => await ctx.db.get(attempt._id))).resolves.toMatchObject({
          status: 'failed',
          errorMessage: 'The notification payload is invalid.',
          updatedAt: now,
        });
      } finally {
        fetchSpy.mockRestore();
      }
    });
  });

  test('transient Expo send failures leave notification attempts queued for retry', async () => {
    await withExpoPushAccessToken(async () => {
      const { attempt, owner, t } = await createQueuedPushAttempt();
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('rate limited', {
          status: 429,
        }),
      );

      try {
        await expect(
          owner.user.action(internal.notifications.dispatchQueued, {
            now: 1_725_000_000_000,
          }),
        ).resolves.toEqual({
          scanned: 1,
          sent: 0,
          failed: 0,
          retried: 1,
          skipped: 0,
        });
        const storedAttempt = await t.run(async (ctx) => await ctx.db.get(attempt._id));
        expect(storedAttempt).toMatchObject({
          status: 'queued',
        });
        expect(storedAttempt).not.toHaveProperty('providerMessageId');
      } finally {
        fetchSpy.mockRestore();
      }
    });
  });

  test('Expo send network errors leave notification attempts queued for retry', async () => {
    await withExpoPushAccessToken(async () => {
      const { attempt, owner, t } = await createQueuedPushAttempt();
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockRejectedValue(new Error('socket hang up'));

      try {
        await expect(
          owner.user.action(internal.notifications.dispatchQueued, {
            now: 1_725_000_000_000,
          }),
        ).resolves.toEqual({
          scanned: 1,
          sent: 0,
          failed: 0,
          retried: 1,
          skipped: 0,
        });
        const storedAttempt = await t.run(async (ctx) => await ctx.db.get(attempt._id));
        expect(storedAttempt).toMatchObject({
          status: 'queued',
        });
        expect(storedAttempt).not.toHaveProperty('providerMessageId');
      } finally {
        fetchSpy.mockRestore();
      }
    });
  });

  test('Expo push receipts mark delivered attempts', async () => {
    await withExpoPushAccessToken(async () => {
      const now = 1_725_000_000_000;
      const { attempt, owner, t } = await createQueuedPushAttempt();
      await t.run(async (ctx) => {
        await ctx.db.patch(attempt._id, {
          providerMessageId: 'expo-receipt-ok',
          updatedAt: now - 16 * 60 * 1000,
        });
      });
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            data: {
              'expo-receipt-ok': { status: 'ok' },
            },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      );

      try {
        await expect(
          owner.user.action(internal.notifications.checkReceipts, { now }),
        ).resolves.toEqual({
          scanned: 1,
          delivered: 1,
          failed: 0,
          missing: 0,
          retried: 0,
          skipped: 0,
        });

        expect(fetchSpy).toHaveBeenCalledTimes(1);
        const [, init] = fetchSpy.mock.calls[0]!;
        const request = init as { body?: string };
        expect(fetchSpy.mock.calls[0]?.[0]).toBe('https://exp.host/--/api/v2/push/getReceipts');
        expect(JSON.parse(request.body ?? '{}')).toEqual({
          ids: ['expo-receipt-ok'],
        });
        await expect(t.run(async (ctx) => await ctx.db.get(attempt._id))).resolves.toMatchObject({
          status: 'delivered',
          updatedAt: now,
        });
      } finally {
        fetchSpy.mockRestore();
      }
    });
  });

  test('DeviceNotRegistered push receipts fail the attempt and disable the device', async () => {
    await withExpoPushAccessToken(async () => {
      const now = 1_725_000_000_000;
      const { attempt, owner, t } = await createQueuedPushAttempt();
      await t.run(async (ctx) => {
        await ctx.db.patch(attempt._id, {
          providerMessageId: 'expo-receipt-unregistered',
          updatedAt: now - 16 * 60 * 1000,
        });
      });
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            data: {
              'expo-receipt-unregistered': {
                status: 'error',
                message: 'Device is not registered.',
                details: { error: 'DeviceNotRegistered' },
              },
            },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      );

      try {
        await expect(
          owner.user.action(internal.notifications.checkReceipts, { now }),
        ).resolves.toEqual({
          scanned: 1,
          delivered: 0,
          failed: 1,
          missing: 0,
          retried: 0,
          skipped: 0,
        });
        await expect(t.run(async (ctx) => await ctx.db.get(attempt._id))).resolves.toMatchObject({
          status: 'failed',
          errorMessage: 'Device is not registered.',
          updatedAt: now,
        });
        await expect(
          t.run(async (ctx) =>
            attempt.deviceId ? await ctx.db.get(attempt.deviceId) : null,
          ),
        ).resolves.toMatchObject({
          disabledAt: now,
        });
      } finally {
        fetchSpy.mockRestore();
      }
    });
  });

  test('push copy follows the registered device locale', async () => {
    await withExpoPushAccessToken(async () => {
      const { attempt, owner, t } = await createQueuedPushAttempt({ locale: 'en-US' });
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ data: [{ status: 'ok', id: 'expo-receipt-en' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

      try {
        await owner.user.action(internal.notifications.dispatchQueued, {
          now: 1_725_000_000_000,
        });

        const [, init] = fetchSpy.mock.calls[0]!;
        const messages = JSON.parse((init as { body?: string }).body ?? '[]') as Array<{
          title: string;
          body: string;
        }>;

        expect(messages[0]).toMatchObject({
          title: 'owner@example.com shared something',
          body: 'New post in Family Circle',
        });
        await expect(t.run(async (ctx) => await ctx.db.get(attempt._id))).resolves.toMatchObject({
          providerMessageId: 'expo-receipt-en',
        });
      } finally {
        fetchSpy.mockRestore();
      }
    });
  });

  test('reactions only push to the share author and collapse per target', async () => {
    await withExpoPushAccessToken(async () => {
      const { member, owner, published, t } = await createQueuedPushAttempt();
      // A third member who must not be pushed about someone else's reaction.
      const bystanderInvite = await owner.user.mutation(api.invites.create, {
        circleId: owner.circleId,
        invitedEmail: 'bystander@example.com',
        role: 'member',
      });
      const bystander = await upsertViewer(t, 'bystander@example.com', 'Bystander');
      await bystander.user.mutation(api.invites.accept, { token: bystanderInvite.token });
      await bystander.user.mutation(api.notifications.registerDevice, {
        instanceUrl: 'https://cloud.example.com',
        token: 'ExponentPushToken[bystander-device]',
        platform: 'android',
      });
      await owner.user.mutation(api.notifications.registerDevice, {
        instanceUrl: 'https://cloud.example.com',
        token: 'ExponentPushToken[owner-device]',
        platform: 'ios',
      });

      await member.user.mutation(api.reactions.set, {
        shareBatchId: published.shareBatchId,
        assetId: published.assetId,
        emoji: '🔥',
      });

      const attempts = await listNotificationDeliveryAttempts({
        t,
        shareBatchId: published.shareBatchId,
      });
      const reactionAttempts = attempts.filter((row) => row.kind === 'reaction.set');

      // Only the author (owner) gets a reaction push; the bystander still has
      // the event in their inbox but no delivery attempt.
      expect(reactionAttempts).toHaveLength(1);
      expect(reactionAttempts[0]).toMatchObject({
        userId: owner.viewer._id,
        status: 'queued',
      });
      const bystanderInbox = await bystander.user.query(api.activity.listInboxForViewer, {
        paginationOpts: { numItems: 10, cursor: null },
      });
      expect(bystanderInbox.page).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'reaction.set', status: 'unread' }),
        ]),
      );

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [
              { status: 'ok', id: 'r1' },
              { status: 'ok', id: 'r2' },
              { status: 'ok', id: 'r3' },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );

      try {
        await owner.user.action(internal.notifications.dispatchQueued, {
          now: 1_725_000_000_000,
        });

        const [, init] = fetchSpy.mock.calls[0]!;
        const messages = JSON.parse((init as { body?: string }).body ?? '[]') as Array<{
          to: string;
          title: string;
          body: string;
          channelId: string;
          collapseId?: string;
          data: Record<string, string>;
        }>;
        const reactionMessage = messages.find((message) => message.data.kind === 'reaction.set');

        expect(reactionMessage).toMatchObject({
          to: 'ExponentPushToken[owner-device]',
          title: 'Member hat mit 🔥 reagiert',
          body: 'Neue Reaktion auf deinen Beitrag in Family Circle',
          channelId: 'engagement',
          collapseId: `reaction:${published.shareBatchId}:${published.assetId}`,
          data: expect.objectContaining({
            shareBatchId: published.shareBatchId,
            assetId: published.assetId,
          }),
        });
      } finally {
        fetchSpy.mockRestore();
      }
    });
  });

  test('accepting an invite notifies existing members with a circle deep link', async () => {
    await withExpoPushAccessToken(async () => {
      const t = createTestDb();
      const owner = await createCircleFor(t, 'owner@example.com', 'Family Circle');
      await owner.user.mutation(api.notifications.registerDevice, {
        instanceUrl: 'https://cloud.example.com',
        token: 'ExponentPushToken[owner-device]',
        platform: 'ios',
      });
      const invite = await owner.user.mutation(api.invites.create, {
        circleId: owner.circleId,
        invitedEmail: 'member@example.com',
        role: 'member',
      });
      const member = await upsertViewer(t, 'member@example.com', 'Member');
      await member.user.mutation(api.invites.accept, { token: invite.token });

      const attempts = await t.run(async (ctx) =>
        await ctx.db
          .query('notificationDeliveryAttempts')
          .withIndex('by_user_and_created_at', (q) => q.eq('userId', owner.viewer._id))
          .collect(),
      );
      expect(attempts).toEqual([
        expect.objectContaining({
          kind: 'member.joined',
          circleId: owner.circleId,
          status: 'queued',
        }),
      ]);
      expect(attempts[0]).not.toHaveProperty('shareBatchId');

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ data: [{ status: 'ok', id: 'join-1' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

      try {
        await expect(
          owner.user.action(internal.notifications.dispatchQueued, { now: 1_725_000_000_000 }),
        ).resolves.toMatchObject({ sent: 1, failed: 0 });

        const [, init] = fetchSpy.mock.calls[0]!;
        const messages = JSON.parse((init as { body?: string }).body ?? '[]') as Array<{
          title: string;
          body: string;
          channelId: string;
          collapseId?: string;
          data: Record<string, string>;
        }>;

        expect(messages[0]).toMatchObject({
          title: 'Member ist beigetreten',
          body: 'Neues Mitglied in Family Circle',
          channelId: 'circle',
          collapseId: `member:${owner.circleId}`,
          data: expect.objectContaining({
            kind: 'member.joined',
            circleId: owner.circleId,
          }),
        });
        expect(messages[0]!.data).not.toHaveProperty('shareBatchId');
      } finally {
        fetchSpy.mockRestore();
      }

      // The joiner sees their own join pre-read; the owner sees it unread.
      const memberInbox = await member.user.query(api.activity.listInboxForViewer, {
        paginationOpts: { numItems: 10, cursor: null },
      });
      expect(memberInbox.page).toEqual([
        expect.objectContaining({
          type: 'member.joined',
          shareBatchId: null,
          status: 'read',
          displayText: 'Member ist dem Circle beigetreten.',
        }),
      ]);
    });
  });

  test('queued pushes are dropped once the activity was read elsewhere', async () => {
    await withExpoPushAccessToken(async () => {
      const { attempt, member, owner, t } = await createQueuedPushAttempt();
      await member.user.mutation(api.activity.markRead, {
        inboxItemId: attempt.inboxItemId!,
      });
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      try {
        await expect(
          owner.user.action(internal.notifications.dispatchQueued, { now: 1_725_000_000_000 }),
        ).resolves.toMatchObject({ scanned: 1, sent: 0, failed: 1 });

        expect(fetchSpy).not.toHaveBeenCalled();
        await expect(t.run(async (ctx) => await ctx.db.get(attempt._id))).resolves.toMatchObject({
          status: 'failed',
          errorMessage: 'Activity was read before delivery.',
        });
        // Nothing wrong with the device; it must stay registered.
        await expect(
          t.run(async (ctx) => (attempt.deviceId ? await ctx.db.get(attempt.deviceId) : null)),
        ).resolves.not.toHaveProperty('disabledAt');
      } finally {
        fetchSpy.mockRestore();
      }
    });
  });

  test('queued pushes older than two days expire instead of flooding devices', async () => {
    await withExpoPushAccessToken(async () => {
      const { attempt, owner, t } = await createQueuedPushAttempt();
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      try {
        await expect(
          owner.user.action(internal.notifications.dispatchQueued, {
            now: attempt.createdAt + 3 * 24 * 60 * 60 * 1000,
          }),
        ).resolves.toMatchObject({ scanned: 1, sent: 0, failed: 1 });

        expect(fetchSpy).not.toHaveBeenCalled();
        await expect(t.run(async (ctx) => await ctx.db.get(attempt._id))).resolves.toMatchObject({
          status: 'failed',
          errorMessage: 'Notification expired before the provider was configured.',
        });
      } finally {
        fetchSpy.mockRestore();
      }
    });
  });

  test('EXPO_PUSH_ENABLED allows sending without an access token', async () => {
    await withoutExpoPushAccessToken(async () => {
      const originalEnabled = process.env.EXPO_PUSH_ENABLED;
      process.env.EXPO_PUSH_ENABLED = 'true';
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ data: [{ status: 'ok', id: 'anon-1' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

      try {
        const { attempt, owner } = await createQueuedPushAttempt();

        expect(attempt).toMatchObject({ status: 'queued' });
        await expect(
          owner.user.action(internal.notifications.dispatchQueued, { now: 1_725_000_000_000 }),
        ).resolves.toMatchObject({ sent: 1 });

        const [, init] = fetchSpy.mock.calls[0]!;
        expect((init as { headers?: Record<string, string> }).headers).not.toHaveProperty(
          'Authorization',
        );
      } finally {
        fetchSpy.mockRestore();

        if (originalEnabled === undefined) {
          delete process.env.EXPO_PUSH_ENABLED;
        } else {
          process.env.EXPO_PUSH_ENABLED = originalEnabled;
        }
      }
    });
  });

  test('MessageRateExceeded tickets leave the attempt queued for retry', async () => {
    await withExpoPushAccessToken(async () => {
      const { attempt, owner, t } = await createQueuedPushAttempt();
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [
              {
                status: 'error',
                message: 'Too many notifications.',
                details: { error: 'MessageRateExceeded' },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );

      try {
        await expect(
          owner.user.action(internal.notifications.dispatchQueued, { now: 1_725_000_000_000 }),
        ).resolves.toEqual({ scanned: 1, sent: 0, failed: 0, retried: 1, skipped: 0 });

        const stored = await t.run(async (ctx) => await ctx.db.get(attempt._id));
        expect(stored).toMatchObject({ status: 'queued' });
        expect(stored).not.toHaveProperty('providerMessageId');
      } finally {
        fetchSpy.mockRestore();
      }
    });
  });

  test('disabled notification preferences create skipped attempts that are never sent', async () => {
    await withExpoPushAccessToken(async () => {
      const { attempt, owner } = await createQueuedPushAttempt({
        disabledKind: 'share.published',
      });
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [{ status: 'ok', id: 'unexpected' }],
          }),
          { status: 200 },
        ),
      );

      try {
        expect(attempt).toMatchObject({
          status: 'skipped',
          skipReason: 'preference_disabled',
        });
        await expect(
          owner.user.action(internal.notifications.dispatchQueued, {
            now: 1_725_000_000_000,
          }),
        ).resolves.toEqual({
          scanned: 0,
          sent: 0,
          failed: 0,
          retried: 0,
          skipped: 0,
        });
        expect(fetchSpy).not.toHaveBeenCalled();
      } finally {
        fetchSpy.mockRestore();
      }
    });
  });

  test('activity inbox read mutations are idempotent and scoped to the viewer', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const invite = await owner.user.mutation(api.invites.create, {
      circleId: owner.circleId,
      invitedEmail: 'member@example.com',
      role: 'member',
    });
    const member = await upsertViewer(t, 'member@example.com', 'Member');
    const outsider = await createCircleFor(t, 'outsider@example.com');
    await member.user.mutation(api.invites.accept, { token: invite.token });
    const published = await createPublishedShare({
      t,
      user: owner.user,
      viewerId: owner.viewer._id,
      circleId: owner.circleId,
      fileName: 'read-state.jpg',
    });
    await owner.user.mutation(api.reactions.set, {
      shareBatchId: published.shareBatchId,
      emoji: '❤️',
    });
    const memberInbox = await member.user.query(api.activity.listInboxForViewer, {
      paginationOpts: { numItems: 10, cursor: null },
    });

    // Share + reaction from the owner, plus the member's own (pre-read) join.
    expect(memberInbox.page).toHaveLength(3);

    const [firstItem, ...allItems] = memberInbox.page;

    await expect(
      outsider.user.mutation(api.activity.markRead, {
        inboxItemId: firstItem!._id,
      }),
    ).rejects.toThrow(/activity/i);
    await expect(
      member.user.mutation(api.activity.markRead, {
        inboxItemId: firstItem!._id,
      }),
    ).resolves.toEqual({
      inboxItemId: firstItem!._id,
      status: 'read',
    });
    await expect(
      member.user.mutation(api.activity.markRead, {
        inboxItemId: firstItem!._id,
      }),
    ).resolves.toEqual({
      inboxItemId: firstItem!._id,
      status: 'read',
    });
    await expect(member.user.query(api.activity.summaryForViewer, {})).resolves.toEqual({
      unreadCount: 1,
      hasUnread: true,
    });
    await expect(
      member.user.mutation(api.activity.markManyRead, {
        inboxItemIds: [firstItem!, ...allItems].map((item) => item._id),
      }),
    ).resolves.toEqual({
      readCount: 3,
    });
    await expect(member.user.query(api.activity.summaryForViewer, {})).resolves.toEqual({
      unreadCount: 0,
      hasUnread: false,
    });
  });

  test('activity inbox unread summary caps at ninety-nine', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');

    await t.run(async (ctx) => {
      const db = ctx.db as unknown as {
        insert: (tableName: string, value: Record<string, unknown>) => Promise<string>;
      };
      const shareBatchId = await db.insert('shareBatches', {
        circleId: owner.circleId,
        authorId: owner.viewer._id,
        assetCount: 1,
        status: 'published',
        createdAt: 0,
        updatedAt: 0,
        publishedAt: 0,
      });

      for (let index = 0; index < 105; index++) {
        const activityEventId = await db.insert('activityEvents', {
          circleId: owner.circleId,
          actorId: owner.viewer._id,
          type: 'share.published',
          entityId: shareBatchId,
          shareBatchId,
          createdAt: index,
        });

        await db.insert('activityInboxItems', {
          activityEventId,
          userId: owner.viewer._id,
          circleId: owner.circleId,
          actorId: owner.viewer._id,
          type: 'share.published',
          shareBatchId,
          status: 'unread',
          createdAt: index,
        });
      }
    });

    await expect(owner.user.query(api.activity.summaryForViewer, {})).resolves.toEqual({
      unreadCount: 99,
      hasUnread: true,
    });
  });

  test('activity listing paginates across viewer circles', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'activity-owner@example.com');
    const secondCircle = await owner.user.mutation(api.circles.create, {
      name: 'Second',
      description: 'Second private circle',
    });
    const first = await createPublishedShare({
      t,
      user: owner.user,
      viewerId: owner.viewer._id,
      circleId: owner.circleId,
      fileName: 'first-activity.jpg',
    });
    const second = await createPublishedShare({
      t,
      user: owner.user,
      viewerId: owner.viewer._id,
      circleId: secondCircle.circleId as Id<'circles'>,
      fileName: 'second-activity.jpg',
    });

    const firstPage = await owner.user.query(api.activity.listForViewer, {
      paginationOpts: { numItems: 1, cursor: null },
    });

    expect(firstPage.page).toHaveLength(1);
    expect(firstPage.isDone).toBe(false);

    const secondPage = await owner.user.query(api.activity.listForViewer, {
      paginationOpts: { numItems: 1, cursor: firstPage.continueCursor },
    });

    expect([...firstPage.page, ...secondPage.page].map((event) => event.shareBatchId)).toEqual(
      expect.arrayContaining([first.shareBatchId, second.shareBatchId]),
    );
  });

  test('upload finalization persists captured dates for memory timelines', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const capturedAt = Date.parse('2026-04-18T09:30:00.000Z');
    const uploaded = await createUploadedDraftAsset({
      t,
      user: owner.user,
      viewerId: owner.viewer._id,
      circleId: owner.circleId,
      capturedAt,
    });

    await expect(t.run(async (ctx) => await ctx.db.get(uploaded.assetId))).resolves.toMatchObject({
      capturedAt,
    });
  });

  test('publishing creates memory items using captured date or publish date fallback', async () => {
    vi.useFakeTimers();
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const capturedAt = Date.parse('2026-04-18T09:30:00.000Z');
    const publishedAt = Date.parse('2026-05-01T12:00:00.000Z');

    try {
      vi.setSystemTime(new Date(publishedAt));
      const captured = await createPublishedShare({
        t,
        user: owner.user,
        viewerId: owner.viewer._id,
        circleId: owner.circleId,
        fileName: 'captured.jpg',
        caption: 'Captured memory',
        capturedAt,
      });
      const fallback = await createPublishedShare({
        t,
        user: owner.user,
        viewerId: owner.viewer._id,
        circleId: owner.circleId,
        fileName: 'fallback.jpg',
      });

      await expect(listMemoryRowsForShare({ t, shareBatchId: captured.shareBatchId })).resolves.toEqual([
        expect.objectContaining({
          shareBatchId: captured.shareBatchId,
          assetId: captured.assetId,
          capturedAt,
          timelineAt: capturedAt,
          publishedAt,
        }),
      ]);
      await expect(listMemoryRowsForShare({ t, shareBatchId: fallback.shareBatchId })).resolves.toEqual([
        expect.objectContaining({
          shareBatchId: fallback.shareBatchId,
          assetId: fallback.assetId,
          timelineAt: publishedAt,
          publishedAt,
        }),
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  test('memory timeline is membership scoped and filterable by circle', async () => {
    vi.useFakeTimers();
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const secondCircle = await owner.user.mutation(api.circles.create, {
      name: 'Second',
      description: 'Second private circle',
    });
    const outsider = await createCircleFor(t, 'outsider@example.com');

    try {
      vi.setSystemTime(new Date('2026-05-01T12:00:00.000Z'));
      const first = await createPublishedShare({
        t,
        user: owner.user,
        viewerId: owner.viewer._id,
        circleId: owner.circleId,
        fileName: 'april.jpg',
        capturedAt: Date.parse('2026-04-18T09:30:00.000Z'),
      });
      vi.setSystemTime(new Date('2026-05-02T12:00:00.000Z'));
      const second = await createPublishedShare({
        t,
        user: owner.user,
        viewerId: owner.viewer._id,
        circleId: secondCircle.circleId as Id<'circles'>,
        fileName: 'may.jpg',
        capturedAt: Date.parse('2026-05-02T08:00:00.000Z'),
      });
      await createPublishedShare({
        t,
        user: outsider.user,
        viewerId: outsider.viewer._id,
        circleId: outsider.circleId,
        fileName: 'outsider.jpg',
        capturedAt: Date.parse('2026-06-01T08:00:00.000Z'),
      });

      const all = await owner.user.query(api.memories.listForViewer, {
        paginationOpts: { numItems: 10, cursor: null },
      });
      const filtered = await owner.user.query(api.memories.listForViewer, {
        circleId: owner.circleId,
        paginationOpts: { numItems: 10, cursor: null },
      });

      expect(all.page.map((item) => item.assetId)).toEqual([second.assetId, first.assetId]);
      expect(all.page.every((item) => item.authorName.length > 0 && item.circleName.length > 0)).toBe(true);
      expect(filtered.page.map((item) => item.assetId)).toEqual([first.assetId]);
      await expect(
        outsider.user.query(api.memories.listForViewer, {
          circleId: owner.circleId,
          paginationOpts: { numItems: 10, cursor: null },
        }),
      ).rejects.toThrow(/membership|circle/i);
    } finally {
      vi.useRealTimers();
    }
  });

  test('publishing creates month and place discovery facets with filterable memories', async () => {
    vi.useFakeTimers();
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const berlinLocation = {
      latitude: 52.520008,
      longitude: 13.404954,
      label: 'Berlin, Deutschland',
      city: 'Berlin',
      country: 'Deutschland',
      source: 'embedded' as const,
    };
    const capturedAt = Date.parse('2026-04-18T09:30:00.000Z');

    try {
      vi.setSystemTime(new Date('2026-05-01T12:00:00.000Z'));
      const located = await createPublishedShare({
        t,
        user: owner.user,
        viewerId: owner.viewer._id,
        circleId: owner.circleId,
        fileName: 'berlin.jpg',
        caption: 'Spring in Berlin',
        capturedAt,
        location: berlinLocation,
      });
      const unlocated = await createPublishedShare({
        t,
        user: owner.user,
        viewerId: owner.viewer._id,
        circleId: owner.circleId,
        fileName: 'home.jpg',
        caption: 'No GPS data',
        capturedAt: Date.parse('2026-04-20T09:30:00.000Z'),
      });

      const discovery = await owner.user.query(api.memories.discoveryForViewer, {
        circleId: owner.circleId,
      });

      expect(discovery.months).toEqual([
        expect.objectContaining({
          key: '2026-04',
          itemCount: 2,
          coverAssetId: unlocated.assetId,
        }),
      ]);
      expect(discovery.places).toEqual([
        expect.objectContaining({
          key: '52.520:13.405',
          label: 'Berlin, Deutschland',
          latitude: berlinLocation.latitude,
          longitude: berlinLocation.longitude,
          itemCount: 1,
          coverAssetId: located.assetId,
        }),
      ]);

      await expect(
        owner.user.query(api.memories.listForViewer, {
          circleId: owner.circleId,
          filter: { kind: 'month', key: '2026-04' },
          paginationOpts: { numItems: 10, cursor: null },
        }),
      ).resolves.toMatchObject({
        page: [
          expect.objectContaining({ assetId: unlocated.assetId, monthKey: '2026-04' }),
          expect.objectContaining({ assetId: located.assetId, monthKey: '2026-04' }),
        ],
      });
      await expect(
        owner.user.query(api.memories.listForViewer, {
          circleId: owner.circleId,
          filter: { kind: 'place', key: '52.520:13.405' },
          paginationOpts: { numItems: 10, cursor: null },
        }),
      ).resolves.toMatchObject({
        page: [
          expect.objectContaining({
            assetId: located.assetId,
            placeKey: '52.520:13.405',
            placeLabel: 'Berlin, Deutschland',
          }),
        ],
      });
    } finally {
      vi.useRealTimers();
    }
  });

  test('memory discovery facets are removed when a share is deleted', async () => {
    await withDeploymentKind('self-hosted', async () => {
      const t = createTestDb();
      const owner = await createCircleFor(t, 'owner@example.com');
      const published = await createPublishedShare({
        t,
        user: owner.user,
        viewerId: owner.viewer._id,
        circleId: owner.circleId,
        fileName: 'delete-place.jpg',
        capturedAt: Date.parse('2026-04-18T09:30:00.000Z'),
        location: {
          latitude: 52.520008,
          longitude: 13.404954,
          label: 'Berlin, Deutschland',
          source: 'embedded',
        },
      });

      await expect(
        owner.user.query(api.memories.discoveryForViewer, { circleId: owner.circleId }),
      ).resolves.toMatchObject({
        months: [expect.objectContaining({ key: '2026-04', itemCount: 1 })],
        places: [expect.objectContaining({ key: '52.520:13.405', itemCount: 1 })],
      });

      await owner.user.action(api.shares.deleteShare, {
        shareBatchId: published.shareBatchId,
      });

      await expect(
        owner.user.query(api.memories.discoveryForViewer, { circleId: owner.circleId }),
      ).resolves.toEqual({
        months: [],
        places: [],
      });
    });
  });

  test('memory discovery backfill supports dry-run and idempotent real runs', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const shareBatchId = await t.run(async (ctx) => {
      return await ctx.db.insert('shareBatches', {
        circleId: owner.circleId,
        authorId: owner.viewer._id,
        caption: 'Legacy place',
        assetCount: 1,
        status: 'published',
        createdAt: 1,
        updatedAt: 2,
        publishedAt: Date.parse('2026-04-30T12:00:00.000Z'),
      });
    });
    const assetId = await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob(['legacy'], { type: 'image/jpeg' }));

      return await ctx.db.insert('assets', {
        shareBatchId,
        circleId: owner.circleId,
        kind: 'image',
        fileName: 'legacy-place.jpg',
        mimeType: 'image/jpeg',
        storage: {
          provider: 'convex-files',
          storageId,
        },
        createdAt: 2,
        capturedAt: Date.parse('2026-04-18T09:30:00.000Z'),
        location: {
          latitude: 52.520008,
          longitude: 13.404954,
          label: 'Berlin, Deutschland',
          source: 'embedded',
        },
      });
    });
    await t.run(async (ctx) => {
      await ctx.db.insert('memoryItems', {
        circleId: owner.circleId,
        shareBatchId,
        assetId,
        authorId: owner.viewer._id,
        kind: 'image',
        capturedAt: Date.parse('2026-04-18T09:30:00.000Z'),
        timelineAt: Date.parse('2026-04-18T09:30:00.000Z'),
        publishedAt: Date.parse('2026-04-30T12:00:00.000Z'),
        createdAt: 3,
      });
    });

    await expect(
      owner.user.mutation(internal.memories.backfillDiscoveryBatch, {
        batchSize: 10,
        dryRun: true,
      }),
    ).resolves.toMatchObject({
      scanned: 1,
      patched: 1,
      summaryWrites: 2,
      hasMore: false,
    });
    await expect(
      owner.user.query(api.memories.discoveryForViewer, { circleId: owner.circleId }),
    ).resolves.toEqual({ months: [], places: [] });

    await expect(
      owner.user.mutation(internal.memories.backfillDiscoveryBatch, {
        batchSize: 10,
      }),
    ).resolves.toMatchObject({
      scanned: 1,
      patched: 1,
      summaryWrites: 2,
      hasMore: false,
    });
    await expect(
      owner.user.query(api.memories.discoveryForViewer, { circleId: owner.circleId }),
    ).resolves.toMatchObject({
      months: [expect.objectContaining({ key: '2026-04', itemCount: 1 })],
      places: [expect.objectContaining({ key: '52.520:13.405', itemCount: 1 })],
    });
    await expect(
      owner.user.mutation(internal.memories.backfillDiscoveryBatch, {
        batchSize: 10,
      }),
    ).resolves.toMatchObject({
      patched: 0,
      summaryWrites: 0,
    });
  });

  test('share deletion and legacy backfill maintain memory items', async () => {
    await withDeploymentKind('self-hosted', async () => {
      const t = createTestDb();
      const owner = await createCircleFor(t, 'owner@example.com');
      const published = await createPublishedShare({
        t,
        user: owner.user,
        viewerId: owner.viewer._id,
        circleId: owner.circleId,
        fileName: 'delete-memory.jpg',
      });

      await expect(listMemoryRowsForShare({ t, shareBatchId: published.shareBatchId })).resolves.toHaveLength(1);
      await owner.user.action(api.shares.deleteShare, {
        shareBatchId: published.shareBatchId,
      });
      await expect(listMemoryRowsForShare({ t, shareBatchId: published.shareBatchId })).resolves.toHaveLength(0);

      const legacy = await t.run(async (ctx) => {
        const shareBatchId = await ctx.db.insert('shareBatches', {
          circleId: owner.circleId,
          authorId: owner.viewer._id,
          caption: 'Legacy',
          assetCount: 1,
          status: 'published',
          createdAt: 1,
          updatedAt: 2,
          publishedAt: 3,
        });
        const storageId = await ctx.storage.store(new Blob(['legacy'], { type: 'image/jpeg' }));
        const assetId = await ctx.db.insert('assets', {
          shareBatchId,
          circleId: owner.circleId,
          kind: 'image',
          fileName: 'legacy.jpg',
          mimeType: 'image/jpeg',
          storage: {
            provider: 'convex-files',
            storageId,
          },
          createdAt: 2,
        });

        return { shareBatchId, assetId };
      });

      await expect(
        owner.user.mutation(internal.memories.backfillBatch, { batchSize: 10 }),
      ).resolves.toMatchObject({
        scanned: expect.any(Number),
        inserted: 1,
        hasMore: false,
      });
      await expect(
        owner.user.mutation(internal.memories.backfillBatch, { batchSize: 10 }),
      ).resolves.toMatchObject({
        inserted: 0,
      });
      await expect(listMemoryRowsForShare({ t, shareBatchId: legacy.shareBatchId })).resolves.toEqual([
        expect.objectContaining({
          assetId: legacy.assetId,
          timelineAt: 3,
          publishedAt: 3,
        }),
      ]);
    });
  });

  test('memory backfill cursors do not skip shares with identical publish times', async () => {
    await withDeploymentKind('self-hosted', async () => {
      const t = createTestDb();
      const owner = await createCircleFor(t, 'owner@example.com');
      const publishedAt = Date.parse('2026-05-01T12:00:00.000Z');
      const shareBatchIds = await t.run(async (ctx) => {
        const ids: Id<'shareBatches'>[] = [];

        for (const suffix of ['one', 'two']) {
          const shareBatchId = await ctx.db.insert('shareBatches', {
            circleId: owner.circleId,
            authorId: owner.viewer._id,
            caption: `Legacy ${suffix}`,
            assetCount: 1,
            status: 'published',
            createdAt: publishedAt - 1,
            updatedAt: publishedAt,
            publishedAt,
          });
          const storageId = await ctx.storage.store(
            new Blob([suffix], { type: 'image/jpeg' }),
          );
          await ctx.db.insert('assets', {
            shareBatchId,
            circleId: owner.circleId,
            kind: 'image',
            fileName: `${suffix}.jpg`,
            mimeType: 'image/jpeg',
            storage: {
              provider: 'convex-files',
              storageId,
            },
            createdAt: publishedAt,
          });
          ids.push(shareBatchId);
        }

        return ids;
      });
      let cursor: string | null = null;
      let hasMore = true;
      let inserted = 0;

      while (hasMore) {
        const result: {
          inserted: number;
          hasMore: boolean;
          continueCursor: string;
        } = await owner.user.mutation(internal.memories.backfillBatch, {
          cursor,
          batchSize: 1,
        });
        inserted += result.inserted;
        cursor = result.continueCursor;
        hasMore = result.hasMore;
      }

      expect(inserted).toBe(2);
      for (const shareBatchId of shareBatchIds) {
        await expect(listMemoryRowsForShare({ t, shareBatchId })).resolves.toHaveLength(1);
      }
    });
  });

  test('publish rejects drafts with unresolved upload rows', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const uploaded = await createUploadedDraftAsset({
      t,
      user: owner.user,
      viewerId: owner.viewer._id,
      circleId: owner.circleId,
      fileName: 'ready.jpg',
      sizeBytes: 1024,
    });

    await t.run(async (ctx) => {
      await ctx.db.insert('uploads', {
        shareBatchId: uploaded.shareBatchId,
        circleId: owner.circleId,
        createdBy: owner.viewer._id,
        providerKind: 'convex-files',
        kind: 'image',
        fileName: 'failed.jpg',
        mimeType: 'image/jpeg',
        status: 'failed',
        failureReason: 'Upload failed before completion.',
        createdAt: Date.now(),
      });
    });

    await expect(
      owner.user.mutation(api.shares.publish, {
        shareBatchId: uploaded.shareBatchId,
      }),
    ).rejects.toThrow(/upload/i);
  });

  test('draft exposes persisted unresolved uploads so they can be discarded after restart', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const uploaded = await createUploadedDraftAsset({
      t,
      user: owner.user,
      viewerId: owner.viewer._id,
      circleId: owner.circleId,
      fileName: 'ready.jpg',
      sizeBytes: 1024,
    });
    const failedUploadId = await t.run(async (ctx) => {
      return await ctx.db.insert('uploads', {
        shareBatchId: uploaded.shareBatchId,
        circleId: owner.circleId,
        createdBy: owner.viewer._id,
        providerKind: 'convex-files',
        kind: 'image',
        fileName: 'interrupted.jpg',
        mimeType: 'image/jpeg',
        status: 'failed',
        failureReason: 'Network dropped.',
        createdAt: Date.now(),
      });
    });

    const draftBefore = await owner.user.query(api.shares.getDraftForCircle, {
      circleId: owner.circleId,
    });

    expect(draftBefore?.unresolvedUploads).toEqual([
      expect.objectContaining({
        _id: failedUploadId,
        fileName: 'interrupted.jpg',
        status: 'failed',
        failureReason: 'Network dropped.',
      }),
    ]);

    await owner.user.action(api.uploads.discard, { uploadId: failedUploadId });

    const draftAfter = await owner.user.query(api.shares.getDraftForCircle, {
      circleId: owner.circleId,
    });

    expect(draftAfter?.unresolvedUploads).toEqual([]);
    await expect(
      owner.user.mutation(api.shares.publish, { shareBatchId: uploaded.shareBatchId }),
    ).resolves.toMatchObject({ shareBatchId: uploaded.shareBatchId, assetCount: 1 });
  });

  test('discard is idempotent for completed and already-discarded uploads', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const uploaded = await createUploadedDraftAsset({
      t,
      user: owner.user,
      viewerId: owner.viewer._id,
      circleId: owner.circleId,
      fileName: 'ready.jpg',
      sizeBytes: 1024,
    });

    // A stale client queue item may reference an upload that already completed
    // into an asset. Discard must report that instead of throwing, and must not
    // touch the upload row, the asset, or its storage.
    await expect(
      owner.user.action(api.uploads.discard, { uploadId: uploaded.uploadId }),
    ).resolves.toMatchObject({ outcome: 'completed' });

    await t.run(async (ctx) => {
      expect(await ctx.db.get(uploaded.uploadId)).not.toBeNull();
      expect(await ctx.db.get(uploaded.assetId)).not.toBeNull();
    });

    const failedUploadId = await t.run(async (ctx) => {
      return await ctx.db.insert('uploads', {
        shareBatchId: uploaded.shareBatchId,
        circleId: owner.circleId,
        createdBy: owner.viewer._id,
        providerKind: 'convex-files',
        kind: 'image',
        fileName: 'interrupted.jpg',
        mimeType: 'image/jpeg',
        status: 'failed',
        failureReason: 'Network dropped.',
        createdAt: Date.now(),
      });
    });

    await expect(
      owner.user.action(api.uploads.discard, { uploadId: failedUploadId }),
    ).resolves.toMatchObject({ outcome: 'discarded' });
    await expect(
      owner.user.action(api.uploads.discard, { uploadId: failedUploadId }),
    ).resolves.toMatchObject({ outcome: 'missing' });
  });

  test('storage counters track upload completion, draft asset deletion, and share deletion', async () => {
    await withDeploymentKind('self-hosted', async () => {
      const t = createTestDb();
      const owner = await createCircleFor(t, 'owner@example.com');
      const uploaded = await createUploadedDraftAsset({
        t,
        user: owner.user,
        viewerId: owner.viewer._id,
        circleId: owner.circleId,
        sizeBytes: 4096,
      });

      await expect(getCircleStats(t, owner.circleId)).resolves.toMatchObject({
        imageCount: 1,
        videoCount: 0,
        totalSizeBytes: 4096,
      });
      await expect(owner.user.query(api.storageStats.forViewer, {})).resolves.toEqual({
        imageCount: 1,
        videoCount: 0,
        totalSizeBytes: 4096,
        circleCount: 1,
        isTruncated: false,
      });

      await owner.user.action(api.assets.deleteDraftAsset, {
        assetId: uploaded.assetId,
      });
      await expect(getCircleStats(t, owner.circleId)).resolves.toMatchObject({
        imageCount: 0,
        videoCount: 0,
        totalSizeBytes: 0,
      });

      const republished = await createUploadedDraftAsset({
        t,
        user: owner.user,
        viewerId: owner.viewer._id,
        circleId: owner.circleId,
        kind: 'video',
        fileName: 'clip.mp4',
        mimeType: 'video/mp4',
        sizeBytes: 8192,
      });
      await owner.user.mutation(api.shares.publish, {
        shareBatchId: republished.shareBatchId,
      });
      await expect(getCircleStats(t, owner.circleId)).resolves.toMatchObject({
        imageCount: 0,
        videoCount: 1,
        totalSizeBytes: 8192,
      });

      await owner.user.action(api.shares.deleteShare, {
        shareBatchId: republished.shareBatchId,
      });
      await expect(getCircleStats(t, owner.circleId)).resolves.toMatchObject({
        imageCount: 0,
        videoCount: 0,
        totalSizeBytes: 0,
      });
    });
  });

  test('draft asset deletion uses the asset upload index without touching unrelated uploads', async () => {
    await withDeploymentKind('self-hosted', async () => {
      const t = createTestDb();
      const owner = await createCircleFor(t, 'owner@example.com');
      const draft = await owner.user.mutation(api.shares.getOrCreateDraft, {
        circleId: owner.circleId,
      });
      const now = Date.now();
      const targetStorageId = await t.run(async (ctx) => {
        return await ctx.storage.store(new Blob(['target'], { type: 'image/jpeg' }));
      });
      const targetAssetId = await t.run(async (ctx) => {
        return await ctx.db.insert('assets', {
          shareBatchId: draft.shareBatchId as Id<'shareBatches'>,
          circleId: owner.circleId,
          kind: 'image',
          fileName: 'target.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: 100,
          storage: {
            provider: 'convex-files',
            storageId: targetStorageId,
          },
          createdAt: now,
        });
      });
      const targetUploadId = await t.run(async (ctx) => {
        return await ctx.db.insert('uploads', {
          shareBatchId: draft.shareBatchId as Id<'shareBatches'>,
          circleId: owner.circleId,
          createdBy: owner.viewer._id,
          assetId: targetAssetId,
          providerKind: 'convex-files',
          kind: 'image',
          fileName: 'target.jpg',
          mimeType: 'image/jpeg',
          storage: {
            provider: 'convex-files',
            storageId: targetStorageId,
          },
          status: 'uploaded',
          createdAt: now,
          completedAt: now,
        });
      });

      await t.run(async (ctx) => {
        for (let index = 0; index < 75; index++) {
          const storageId = await ctx.storage.store(
            new Blob([`unrelated-${index}`], { type: 'image/jpeg' }),
          );
          const assetId = await ctx.db.insert('assets', {
            shareBatchId: draft.shareBatchId as Id<'shareBatches'>,
            circleId: owner.circleId,
            kind: 'image',
            fileName: `unrelated-${index}.jpg`,
            mimeType: 'image/jpeg',
            storage: {
              provider: 'convex-files',
              storageId,
            },
            createdAt: now + index + 1,
          });

          await ctx.db.insert('uploads', {
            shareBatchId: draft.shareBatchId as Id<'shareBatches'>,
            circleId: owner.circleId,
            createdBy: owner.viewer._id,
            assetId,
            providerKind: 'convex-files',
            kind: 'image',
            fileName: `unrelated-${index}.jpg`,
            mimeType: 'image/jpeg',
            storage: {
              provider: 'convex-files',
              storageId,
            },
            status: 'uploaded',
            createdAt: now + index + 1,
            completedAt: now + index + 1,
          });
        }
      });

      await expect(
        t.run(async (ctx) => {
          return await ctx.db
            .query('uploads')
            .withIndex('by_asset', (q) => q.eq('assetId', targetAssetId))
            .collect();
        }),
      ).resolves.toHaveLength(1);
      await expect(countUploadsForShareBatch(t, draft.shareBatchId as Id<'shareBatches'>))
        .resolves.toBe(76);

      await owner.user.action(api.assets.deleteDraftAsset, {
        assetId: targetAssetId,
      });

      await expect(t.run(async (ctx) => await ctx.db.get(targetAssetId))).resolves.toBeNull();
      await expect(t.run(async (ctx) => await ctx.db.get(targetUploadId))).resolves.toBeNull();
      await expect(countUploadsForShareBatch(t, draft.shareBatchId as Id<'shareBatches'>))
        .resolves.toBe(75);
    });
  });

  test('draft asset deletion rejects anomalous assets with too many linked uploads', async () => {
    await withDeploymentKind('self-hosted', async () => {
      const t = createTestDb();
      const owner = await createCircleFor(t, 'owner@example.com');
      const draft = await owner.user.mutation(api.shares.getOrCreateDraft, {
        circleId: owner.circleId,
      });
      const now = Date.now();
      const storageId = await t.run(async (ctx) => {
        return await ctx.storage.store(new Blob(['target'], { type: 'image/jpeg' }));
      });
      const assetId = await t.run(async (ctx) => {
        return await ctx.db.insert('assets', {
          shareBatchId: draft.shareBatchId as Id<'shareBatches'>,
          circleId: owner.circleId,
          kind: 'image',
          fileName: 'overlinked.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: 100,
          storage: {
            provider: 'convex-files',
            storageId,
          },
          createdAt: now,
        });
      });
      const uploadIds = await t.run(async (ctx) => {
        const insertedUploadIds: Array<Id<'uploads'>> = [];

        for (let index = 0; index < EXPECTED_ASSET_LINKED_UPLOAD_DELETE_LIMIT + 1; index++) {
          insertedUploadIds.push(
            await ctx.db.insert('uploads', {
              shareBatchId: draft.shareBatchId as Id<'shareBatches'>,
              circleId: owner.circleId,
              createdBy: owner.viewer._id,
              assetId,
              providerKind: 'convex-files',
              kind: 'image',
              fileName: `overlinked-${index}.jpg`,
              mimeType: 'image/jpeg',
              storage: {
                provider: 'convex-files',
                storageId,
              },
              status: 'uploaded',
              createdAt: now + index,
              completedAt: now + index,
            }),
          );
        }

        return insertedUploadIds;
      });

      await expect(
        owner.user.action(api.assets.deleteDraftAsset, {
          assetId,
        }),
      ).rejects.toThrow(/too many linked uploads/i);
      await expect(t.run(async (ctx) => await ctx.db.get(assetId))).resolves.not.toBeNull();

      for (const uploadId of uploadIds) {
        await expect(t.run(async (ctx) => await ctx.db.get(uploadId))).resolves.not.toBeNull();
      }
    });
  });

  test('share deletion removes all legacy over-capacity assets and uploads', async () => {
    await withDeploymentKind('self-hosted', async () => {
      const t = createTestDb();
      const owner = await createCircleFor(t, 'owner@example.com');
      const now = Date.now();
      const shareBatchId = await t.run(async (ctx) => {
        return await ctx.db.insert('shareBatches', {
          circleId: owner.circleId,
          authorId: owner.viewer._id,
          assetCount: 12,
          status: 'published',
          createdAt: now,
          updatedAt: now,
          publishedAt: now,
        });
      });

      await t.run(async (ctx) => {
        for (let index = 0; index < 12; index++) {
          const storageId = await ctx.storage.store(
            new Blob([`legacy-${index}`], { type: 'image/jpeg' }),
          );
          const assetId = await ctx.db.insert('assets', {
            shareBatchId,
            circleId: owner.circleId,
            kind: 'image',
            fileName: `legacy-${index}.jpg`,
            mimeType: 'image/jpeg',
            sizeBytes: 100,
            storage: {
              provider: 'convex-files',
              storageId,
            },
            createdAt: now + index,
          });

          await ctx.db.insert('uploads', {
            shareBatchId,
            circleId: owner.circleId,
            createdBy: owner.viewer._id,
            assetId,
            providerKind: 'convex-files',
            kind: 'image',
            fileName: `legacy-${index}.jpg`,
            mimeType: 'image/jpeg',
            storage: {
              provider: 'convex-files',
              storageId,
            },
            status: 'uploaded',
            createdAt: now + index,
            completedAt: now + index,
          });
        }

        await ctx.db.insert('activityEvents', {
          circleId: owner.circleId,
          actorId: owner.viewer._id,
          type: 'share.published',
          entityId: shareBatchId,
          createdAt: now,
        });

        const stats = await ctx.db
          .query('circleStats')
          .withIndex('by_circle', (q) => q.eq('circleId', owner.circleId))
          .unique();

        if (!stats) {
          throw new Error('Expected circle stats row to exist.');
        }

        await ctx.db.patch(stats._id, {
          imageCount: 12,
          videoCount: 0,
          totalSizeBytes: 12 * 100,
          updatedAt: now,
        });
      });

      await expect(countShareChildren(t, shareBatchId)).resolves.toEqual({
        assetCount: 12,
        uploadCount: 12,
      });

      await owner.user.action(api.shares.deleteShare, { shareBatchId });

      await expect(countShareChildren(t, shareBatchId)).resolves.toEqual({
        assetCount: 0,
        uploadCount: 0,
      });
      await expect(t.run(async (ctx) => await ctx.db.get(shareBatchId))).resolves.toBeNull();
      await expect(
        listActivityEventsForEntity(t, owner.circleId, shareBatchId),
      ).resolves.toHaveLength(0);

      await expect(getCircleStats(t, owner.circleId)).resolves.toMatchObject({
        imageCount: 0,
        videoCount: 0,
        totalSizeBytes: 0,
      });
    });
  });

  test('share deletion removes its activity event after more than 100 circle events', async () => {
    await withDeploymentKind('self-hosted', async () => {
      const t = createTestDb();
      const owner = await createCircleFor(t, 'owner@example.com');

      await t.run(async (ctx) => {
        for (let index = 0; index < 105; index++) {
          await ctx.db.insert('activityEvents', {
            circleId: owner.circleId,
            actorId: owner.viewer._id,
            type: 'share.published',
            entityId: `legacy-share-${index}`,
            createdAt: index,
          });
        }
      });

      const uploaded = await createUploadedDraftAsset({
        t,
        user: owner.user,
        viewerId: owner.viewer._id,
        circleId: owner.circleId,
        fileName: 'cleanup-target.jpg',
      });

      await owner.user.mutation(api.shares.publish, {
        shareBatchId: uploaded.shareBatchId,
      });
      await expect(
        listActivityEventsForEntity(t, owner.circleId, uploaded.shareBatchId),
      ).resolves.toHaveLength(1);

      await owner.user.action(api.shares.deleteShare, {
        shareBatchId: uploaded.shareBatchId,
      });

      await expect(
        listActivityEventsForEntity(t, owner.circleId, uploaded.shareBatchId),
      ).resolves.toHaveLength(0);
    });
  });

  test('share deletion batches same-share activity events before finalizing', async () => {
    await withDeploymentKind('self-hosted', async () => {
      const t = createTestDb();
      const owner = await createCircleFor(t, 'owner@example.com');
      const published = await createPublishedShare({
        t,
        user: owner.user,
        viewerId: owner.viewer._id,
        circleId: owner.circleId,
        fileName: 'activity-batch.jpg',
      });

      await t.run(async (ctx) => {
        for (let index = 0; index < EXPECTED_SHARE_DELETE_BATCH_SIZE + 3; index++) {
          await ctx.db.insert('activityEvents', {
            circleId: owner.circleId,
            actorId: owner.viewer._id,
            type: 'comment.created',
            entityId: published.shareBatchId,
            shareBatchId: published.shareBatchId,
            createdAt: Date.now() + index,
          });
        }
      });

      const firstDeleteContext = await owner.user.query(internal.shares.getDeleteContext, {
        shareBatchId: published.shareBatchId,
      }) as {
        activityEventIds?: Id<'activityEvents'>[];
        isFinalBatch: boolean;
      };

      expect(firstDeleteContext.activityEventIds).toHaveLength(EXPECTED_SHARE_DELETE_BATCH_SIZE);
      expect(firstDeleteContext.isFinalBatch).toBe(false);

      await owner.user.action(api.shares.deleteShare, {
        shareBatchId: published.shareBatchId,
      });

      await expect(
        listActivityEventsForEntity(t, owner.circleId, published.shareBatchId),
      ).resolves.toHaveLength(0);
      await expect(t.run(async (ctx) => await ctx.db.get(published.shareBatchId))).resolves.toBeNull();
    });
  });

  test('stale media cleanup deletes old pending upload rows and storage references', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const draft = await owner.user.mutation(api.shares.getOrCreateDraft, {
      circleId: owner.circleId,
    });
    const now = Date.now();
    const staleCreatedAt = now - 25 * 60 * 60 * 1000;
    const uploadId = await t.run(async (ctx) => {
      return await ctx.db.insert('uploads', {
        shareBatchId: draft.shareBatchId as Id<'shareBatches'>,
        circleId: owner.circleId,
        createdBy: owner.viewer._id,
        providerKind: 's3',
        pendingStorage: {
          provider: 's3',
          bucket: 'media-bucket',
          objectKey: 'stale/original.jpg',
        },
        previewPendingStorage: {
          provider: 's3',
          bucket: 'media-bucket',
          objectKey: 'stale/preview.jpg',
        },
        kind: 'image',
        fileName: 'original.jpg',
        mimeType: 'image/jpeg',
        status: 'uploading',
        createdAt: staleCreatedAt,
      });
    });
    const imageUploadId = await t.run(async (ctx) => {
      return await ctx.db.insert('imageUploads', {
        targetKind: 'user-profile',
        userId: owner.viewer._id,
        providerKind: 's3',
        pendingStorage: {
          provider: 's3',
          bucket: 'media-bucket',
          objectKey: 'stale/profile.jpg',
        },
        fileName: 'profile.jpg',
        mimeType: 'image/jpeg',
        status: 'failed',
        failureReason: 'interrupted',
        createdAt: staleCreatedAt,
      });
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, {
        status: 204,
      }),
    );

    try {
      await withS3SigningEnv(async () => {
        await expect(
          owner.user.action(internal.mediaCleanup.cleanupStale, {
            now,
          }),
        ).resolves.toEqual({
          scanned: 2,
          deleted: 2,
          failed: 0,
          hasMore: false,
        });
      });

      expect(fetchSpy).toHaveBeenCalledTimes(3);
      await expect(t.run(async (ctx) => await ctx.db.get(uploadId))).resolves.toBeNull();
      await expect(t.run(async (ctx) => await ctx.db.get(imageUploadId))).resolves.toBeNull();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test('stale media cleanup is bounded and ignores recent or completed upload rows', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const draft = await owner.user.mutation(api.shares.getOrCreateDraft, {
      circleId: owner.circleId,
    });
    const now = Date.now();
    const staleCreatedAt = now - 25 * 60 * 60 * 1000;
    const recentCreatedAt = now - 60 * 60 * 1000;
    const completedStorageId = await t.run(async (ctx) => {
      return await ctx.storage.store(new Blob(['completed'], { type: 'image/jpeg' }));
    });
    const completedAssetId = await t.run(async (ctx) => {
      return await ctx.db.insert('assets', {
        shareBatchId: draft.shareBatchId as Id<'shareBatches'>,
        circleId: owner.circleId,
        kind: 'image',
        fileName: 'completed.jpg',
        mimeType: 'image/jpeg',
        storage: {
          provider: 'convex-files',
          storageId: completedStorageId,
        },
        createdAt: staleCreatedAt,
      });
    });
    const preservedIds = await t.run(async (ctx) => {
      const ids: Array<Id<'uploads'>> = [];

      for (let index = 0; index < 51; index++) {
        ids.push(
          await ctx.db.insert('uploads', {
            shareBatchId: draft.shareBatchId as Id<'shareBatches'>,
            circleId: owner.circleId,
            createdBy: owner.viewer._id,
            providerKind: 's3',
            pendingStorage: {
              provider: 's3',
              bucket: 'media-bucket',
              objectKey: `stale/batch-${index}.jpg`,
            },
            kind: 'image',
            fileName: `batch-${index}.jpg`,
            mimeType: 'image/jpeg',
            status: 'failed',
            failureReason: 'interrupted',
            createdAt: staleCreatedAt + index,
          }),
        );
      }

      const recentId = await ctx.db.insert('uploads', {
        shareBatchId: draft.shareBatchId as Id<'shareBatches'>,
        circleId: owner.circleId,
        createdBy: owner.viewer._id,
        providerKind: 's3',
        pendingStorage: {
          provider: 's3',
          bucket: 'media-bucket',
          objectKey: 'recent/upload.jpg',
        },
        kind: 'image',
        fileName: 'recent.jpg',
        mimeType: 'image/jpeg',
        status: 'uploading',
        createdAt: recentCreatedAt,
      });
      const completedUploadId = await ctx.db.insert('uploads', {
        shareBatchId: draft.shareBatchId as Id<'shareBatches'>,
        circleId: owner.circleId,
        createdBy: owner.viewer._id,
        assetId: completedAssetId,
        providerKind: 'convex-files',
        kind: 'image',
        fileName: 'completed.jpg',
        mimeType: 'image/jpeg',
        storage: {
          provider: 'convex-files',
          storageId: completedStorageId,
        },
        status: 'uploaded',
        createdAt: staleCreatedAt,
        completedAt: staleCreatedAt,
      });

      return {
        firstStaleId: ids[0]!,
        lastStaleId: ids[50]!,
        recentId,
        completedUploadId,
      };
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, {
        status: 204,
      }),
    );

    try {
      await withS3SigningEnv(async () => {
        await expect(
          owner.user.action(internal.mediaCleanup.cleanupStale, {
            now,
          }),
        ).resolves.toEqual({
          scanned: 50,
          deleted: 50,
          failed: 0,
          hasMore: true,
        });
      });

      await expect(t.run(async (ctx) => await ctx.db.get(preservedIds.firstStaleId)))
        .resolves.toBeNull();
      await expect(t.run(async (ctx) => await ctx.db.get(preservedIds.lastStaleId)))
        .resolves.toMatchObject({
          status: 'failed',
        });
      await expect(t.run(async (ctx) => await ctx.db.get(preservedIds.recentId)))
        .resolves.toMatchObject({
          status: 'uploading',
        });
      await expect(t.run(async (ctx) => await ctx.db.get(preservedIds.completedUploadId)))
        .resolves.toMatchObject({
          status: 'uploaded',
          assetId: completedAssetId,
        });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test('stale media cleanup schedules follow-up batches when requested', async () => {
    vi.useFakeTimers();
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const draft = await owner.user.mutation(api.shares.getOrCreateDraft, {
      circleId: owner.circleId,
    });
    const now = Date.now();
    const staleCreatedAt = now - 25 * 60 * 60 * 1000;

    await t.run(async (ctx) => {
      for (let index = 0; index < 51; index++) {
        await ctx.db.insert('uploads', {
          shareBatchId: draft.shareBatchId as Id<'shareBatches'>,
          circleId: owner.circleId,
          createdBy: owner.viewer._id,
          providerKind: 's3',
          pendingStorage: {
            provider: 's3',
            bucket: 'media-bucket',
            objectKey: `stale/scheduled-${index}.jpg`,
          },
          kind: 'image',
          fileName: `scheduled-${index}.jpg`,
          mimeType: 'image/jpeg',
          status: 'failed',
          failureReason: 'interrupted',
          createdAt: staleCreatedAt + index,
        });
      }
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, {
        status: 204,
      }),
    );

    try {
      await withS3SigningEnv(async () => {
        await expect(
          owner.user.action(internal.mediaCleanup.cleanupStale, {
            now,
            continueOnMore: true,
          }),
        ).resolves.toEqual({
          scanned: 50,
          deleted: 50,
          failed: 0,
          hasMore: true,
        });

        await owner.user.finishAllScheduledFunctions(() => vi.runAllTimers());
      });

      const remaining = await countUploadsForShareBatch(
        t,
        draft.shareBatchId as Id<'shareBatches'>,
      );

      expect(remaining).toBe(0);
      expect(fetchSpy).toHaveBeenCalledTimes(51);
    } finally {
      fetchSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});
