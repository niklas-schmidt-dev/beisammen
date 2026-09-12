import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';

import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { internalMutation, query } from './_generated/server';
import { imageCacheKey } from './lib/storage/shared';
import { requireCircleMembership, requireViewer } from './lib/viewer';

const MEMORY_MEMBERSHIP_LIMIT = 100;
const MEMORY_PAGE_SIZE_LIMIT = 48;
const MEMORY_ITEMS_PER_CIRCLE_LIMIT = 80;
const MEMORY_BACKFILL_BATCH_LIMIT = 50;
const MEMORY_ASSET_BATCH_LIMIT = 100;
const MEMORY_DISCOVERY_SUMMARY_LIMIT = 120;
const MEMORY_PLACE_COORDINATE_PRECISION = 3;
const MEMORY_MAP_ITEMS_PER_CIRCLE_LIMIT = 250;
const MEMORY_MAP_TOTAL_LIMIT = 750;

type MemoryItem = Doc<'memoryItems'>;
type MemoryMonth = Doc<'memoryMonths'>;
type MemoryPlace = Doc<'memoryPlaces'>;

const memoryFilterValidator = v.optional(
  v.union(
    v.object({
      kind: v.literal('month'),
      key: v.string(),
    }),
    v.object({
      kind: v.literal('place'),
      key: v.string(),
    }),
  ),
);

function normalizePageSize(numItems: number): number {
  if (!Number.isFinite(numItems)) {
    return MEMORY_PAGE_SIZE_LIMIT;
  }

  return Math.min(Math.max(Math.floor(numItems), 1), MEMORY_PAGE_SIZE_LIMIT);
}

function parseCursorOffset(cursor: string | null): number {
  if (!cursor) {
    return 0;
  }

  const parsed = Number(cursor);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function compareMemoryItems(left: MemoryItem, right: MemoryItem): number {
  const timelineDelta = right.timelineAt - left.timelineAt;

  if (timelineDelta !== 0) {
    return timelineDelta;
  }

  return right._creationTime - left._creationTime;
}

export function memoryMonthKey(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');

  return `${year}-${month}`;
}

export function memoryPlaceKey(location: NonNullable<Doc<'assets'>['location']>): string {
  return [
    location.latitude.toFixed(MEMORY_PLACE_COORDINATE_PRECISION),
    location.longitude.toFixed(MEMORY_PLACE_COORDINATE_PRECISION),
  ].join(':');
}

function memoryPlaceLabel(location: NonNullable<Doc<'assets'>['location']>): string {
  const label = location.label?.trim();

  if (label) {
    return label;
  }

  const parts = [location.city, location.region, location.country]
    .filter(Boolean)
    .join(', ')
    .trim();

  if (parts) {
    return parts;
  }

  return `${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}`;
}

function discoveryFields(input: {
  asset: Doc<'assets'>;
  timelineAt: number;
  caption?: string;
}) {
  const monthKey = memoryMonthKey(input.timelineAt);
  const location = input.asset.location;

  return {
    monthKey,
    ...(input.caption?.trim() ? { caption: input.caption.trim() } : {}),
    ...(location
      ? {
          placeKey: memoryPlaceKey(location),
          placeLabel: memoryPlaceLabel(location),
          placeLatitude: location.latitude,
          placeLongitude: location.longitude,
        }
      : {}),
  };
}

async function listViewerCircleIds(
  ctx: QueryCtx,
  viewerId: Id<'users'>,
): Promise<Id<'circles'>[]> {
  const memberships = await ctx.db
    .query('circleMembers')
    .withIndex('by_user_and_joined_at', (q) => q.eq('userId', viewerId))
    .order('desc')
    .take(MEMORY_MEMBERSHIP_LIMIT);

  return memberships.map((membership) => membership.circleId);
}

async function mapMemoryItem(ctx: QueryCtx, item: MemoryItem) {
  const [circle, author, shareBatch, asset] = await Promise.all([
    ctx.db.get(item.circleId),
    ctx.db.get(item.authorId),
    ctx.db.get(item.shareBatchId),
    ctx.db.get(item.assetId),
  ]);

  if (!asset || !shareBatch || shareBatch.status !== 'published') {
    return null;
  }

  return {
    _id: item._id,
    _creationTime: item._creationTime,
    circleId: item.circleId,
    circleName: circle?.name ?? 'Circle',
    shareBatchId: item.shareBatchId,
    assetId: item.assetId,
    authorId: item.authorId,
    authorName: author?.displayName ?? author?.email ?? 'Unbekannt',
    authorAvatarUrl: author?.avatarUrl,
    authorHasProfileImage: Boolean(author?.profileImageStorage),
    authorProfileImageKey: imageCacheKey(author?.profileImageStorage),
    kind: item.kind,
    caption: shareBatch.caption ?? '',
    timelineAt: item.timelineAt,
    capturedAt: item.capturedAt ?? null,
    publishedAt: item.publishedAt,
    monthKey: item.monthKey ?? memoryMonthKey(item.timelineAt),
    placeKey: item.placeKey ?? null,
    placeLabel: item.placeLabel ?? null,
    location: asset.location ?? null,
    asset: {
      _id: asset._id,
      _creationTime: asset._creationTime,
      kind: asset.kind,
      fileName: asset.fileName,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
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
    },
  };
}

async function upsertMonthSummary(ctx: MutationCtx, item: MemoryItem) {
  const monthKey = item.monthKey ?? memoryMonthKey(item.timelineAt);
  const existing = await ctx.db
    .query('memoryMonths')
    .withIndex('by_circle_and_month_key', (q) =>
      q.eq('circleId', item.circleId).eq('monthKey', monthKey),
    )
    .first();
  const now = Date.now();

  if (!existing) {
    await ctx.db.insert('memoryMonths', {
      circleId: item.circleId,
      monthKey,
      itemCount: 1,
      latestTimelineAt: item.timelineAt,
      coverAssetId: item.assetId,
      coverMemoryItemId: item._id,
      updatedAt: now,
    });
    return;
  }

  await ctx.db.patch(existing._id, {
    itemCount: existing.itemCount + 1,
    ...(item.timelineAt >= existing.latestTimelineAt
      ? {
          latestTimelineAt: item.timelineAt,
          coverAssetId: item.assetId,
          coverMemoryItemId: item._id,
        }
      : {}),
    updatedAt: now,
  });
}

async function upsertPlaceSummary(ctx: MutationCtx, item: MemoryItem) {
  if (
    !item.placeKey ||
    !item.placeLabel ||
    item.placeLatitude === undefined ||
    item.placeLongitude === undefined
  ) {
    return;
  }

  const existing = await ctx.db
    .query('memoryPlaces')
    .withIndex('by_circle_and_place_key', (q) =>
      q.eq('circleId', item.circleId).eq('placeKey', item.placeKey!),
    )
    .first();
  const now = Date.now();

  if (!existing) {
    await ctx.db.insert('memoryPlaces', {
      circleId: item.circleId,
      placeKey: item.placeKey,
      label: item.placeLabel,
      latitude: item.placeLatitude,
      longitude: item.placeLongitude,
      itemCount: 1,
      latestTimelineAt: item.timelineAt,
      coverAssetId: item.assetId,
      coverMemoryItemId: item._id,
      updatedAt: now,
    });
    return;
  }

  await ctx.db.patch(existing._id, {
    itemCount: existing.itemCount + 1,
    ...(item.timelineAt >= existing.latestTimelineAt
      ? {
          label: item.placeLabel,
          latitude: item.placeLatitude,
          longitude: item.placeLongitude,
          latestTimelineAt: item.timelineAt,
          coverAssetId: item.assetId,
          coverMemoryItemId: item._id,
        }
      : {}),
    updatedAt: now,
  });
}

async function findReplacementMonthCover(
  ctx: MutationCtx,
  item: MemoryItem,
  monthKey: string,
) {
  const candidates = await ctx.db
    .query('memoryItems')
    .withIndex('by_circle_and_month_key_and_timeline_at', (q) =>
      q.eq('circleId', item.circleId).eq('monthKey', monthKey),
    )
    .order('desc')
    .take(3);

  return candidates.find((candidate) => candidate._id !== item._id) ?? null;
}

async function findReplacementPlaceCover(
  ctx: MutationCtx,
  item: MemoryItem,
  placeKey: string,
) {
  const candidates = await ctx.db
    .query('memoryItems')
    .withIndex('by_circle_and_place_key_and_timeline_at', (q) =>
      q.eq('circleId', item.circleId).eq('placeKey', placeKey),
    )
    .order('desc')
    .take(3);

  return candidates.find((candidate) => candidate._id !== item._id) ?? null;
}

async function decrementMonthSummary(ctx: MutationCtx, item: MemoryItem) {
  const monthKey = item.monthKey ?? memoryMonthKey(item.timelineAt);
  const existing = await ctx.db
    .query('memoryMonths')
    .withIndex('by_circle_and_month_key', (q) =>
      q.eq('circleId', item.circleId).eq('monthKey', monthKey),
    )
    .first();

  if (!existing) {
    return;
  }

  if (existing.itemCount <= 1) {
    await ctx.db.delete(existing._id);
    return;
  }

  const needsCoverRepair =
    existing.coverMemoryItemId === item._id ||
    existing.coverAssetId === item.assetId ||
    item.timelineAt >= existing.latestTimelineAt;
  const replacement = needsCoverRepair
    ? await findReplacementMonthCover(ctx, item, monthKey)
    : null;

  await ctx.db.patch(existing._id, {
    itemCount: existing.itemCount - 1,
    ...(replacement
      ? {
          latestTimelineAt: replacement.timelineAt,
          coverAssetId: replacement.assetId,
          coverMemoryItemId: replacement._id,
        }
      : {}),
    updatedAt: Date.now(),
  });
}

async function decrementPlaceSummary(ctx: MutationCtx, item: MemoryItem) {
  if (!item.placeKey) {
    return;
  }

  const existing = await ctx.db
    .query('memoryPlaces')
    .withIndex('by_circle_and_place_key', (q) =>
      q.eq('circleId', item.circleId).eq('placeKey', item.placeKey!),
    )
    .first();

  if (!existing) {
    return;
  }

  if (existing.itemCount <= 1) {
    await ctx.db.delete(existing._id);
    return;
  }

  const needsCoverRepair =
    existing.coverMemoryItemId === item._id ||
    existing.coverAssetId === item.assetId ||
    item.timelineAt >= existing.latestTimelineAt;
  const replacement = needsCoverRepair
    ? await findReplacementPlaceCover(ctx, item, item.placeKey)
    : null;

  await ctx.db.patch(existing._id, {
    itemCount: existing.itemCount - 1,
    ...(replacement
      ? {
          latestTimelineAt: replacement.timelineAt,
          coverAssetId: replacement.assetId,
          coverMemoryItemId: replacement._id,
        }
      : {}),
    updatedAt: Date.now(),
  });
}

export async function removeMemoryItemFromDiscoverySummaries(
  ctx: MutationCtx,
  item: MemoryItem,
) {
  await decrementMonthSummary(ctx, item);
  await decrementPlaceSummary(ctx, item);
}

export async function createMemoryItemsForPublishedShare(
  ctx: MutationCtx,
  input: {
    shareBatch: Doc<'shareBatches'>;
    publishedAt: number;
    caption?: string;
  },
) {
  const assets = await ctx.db
    .query('assets')
    .withIndex('by_share_batch', (q) => q.eq('shareBatchId', input.shareBatch._id))
    .take(MEMORY_ASSET_BATCH_LIMIT);
  let inserted = 0;

  for (const asset of assets) {
    const existing = await ctx.db
      .query('memoryItems')
      .withIndex('by_asset', (q) => q.eq('assetId', asset._id))
      .first();

    if (existing) {
      continue;
    }

    const fields = discoveryFields({
      asset,
      timelineAt: asset.capturedAt ?? input.publishedAt,
      caption: input.caption ?? input.shareBatch.caption,
    });
    const memoryItemId = await ctx.db.insert('memoryItems', {
      circleId: input.shareBatch.circleId,
      shareBatchId: input.shareBatch._id,
      assetId: asset._id,
      authorId: input.shareBatch.authorId,
      kind: asset.kind,
      ...(asset.capturedAt !== undefined ? { capturedAt: asset.capturedAt } : {}),
      timelineAt: asset.capturedAt ?? input.publishedAt,
      publishedAt: input.publishedAt,
      ...fields,
      createdAt: Date.now(),
    });
    const memoryItem = await ctx.db.get(memoryItemId);

    if (memoryItem) {
      await upsertMonthSummary(ctx, memoryItem);
      await upsertPlaceSummary(ctx, memoryItem);
    }
    inserted += 1;
  }

  return { inserted };
}

/**
 * Keeps the denormalized caption on a share's memory items in step with the
 * share itself after the author edits it post-publish.
 */
export async function syncMemoryItemCaptionsForShare(
  ctx: MutationCtx,
  input: {
    shareBatchId: Id<'shareBatches'>;
    caption: string | undefined;
  },
) {
  const items = await ctx.db
    .query('memoryItems')
    .withIndex('by_share_batch', (q) => q.eq('shareBatchId', input.shareBatchId))
    .take(MEMORY_ASSET_BATCH_LIMIT);
  const caption = input.caption?.trim() || undefined;

  for (const item of items) {
    if (item.caption === caption) {
      continue;
    }

    await ctx.db.patch(item._id, { caption });
  }

  return { updated: items.length };
}

export const backfillBatch = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize = Math.min(
      Math.max(Math.floor(args.batchSize ?? MEMORY_BACKFILL_BATCH_LIMIT), 1),
      MEMORY_BACKFILL_BATCH_LIMIT,
    );
    const result = await ctx.db
      .query('shareBatches')
      .withIndex('by_status_and_published_at', (q) => q.eq('status', 'published'))
      .order('asc')
      .paginate({
        numItems: batchSize,
        cursor: args.cursor ?? null,
      });
    let inserted = 0;

    for (const shareBatch of result.page) {
      const publishedAt = shareBatch.publishedAt ?? shareBatch.createdAt;
      const insertResult = await createMemoryItemsForPublishedShare(ctx, {
        shareBatch,
        publishedAt,
      });
      inserted += insertResult.inserted;
    }

    return {
      scanned: result.page.length,
      inserted,
      hasMore: !result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

export const backfillDiscoveryBatch = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const batchSize = Math.min(
      Math.max(Math.floor(args.batchSize ?? MEMORY_BACKFILL_BATCH_LIMIT), 1),
      MEMORY_BACKFILL_BATCH_LIMIT,
    );
    const result = await ctx.db
      .query('memoryItems')
      .withIndex('by_timeline_at')
      .order('asc')
      .paginate({
        numItems: batchSize,
        cursor: args.cursor ?? null,
      });
    const dryRun = args.dryRun ?? false;
    let patched = 0;
    let summaryWrites = 0;

    for (const item of result.page) {
      const [asset, shareBatch] = await Promise.all([
        ctx.db.get(item.assetId),
        ctx.db.get(item.shareBatchId),
      ]);

      if (!asset || !shareBatch || shareBatch.status !== 'published') {
        continue;
      }

      const fields = discoveryFields({
        asset,
        timelineAt: item.timelineAt,
        caption: shareBatch.caption,
      });
      const needsPatch =
        item.monthKey !== fields.monthKey ||
        item.placeKey !== fields.placeKey ||
        item.placeLabel !== fields.placeLabel ||
        item.placeLatitude !== fields.placeLatitude ||
        item.placeLongitude !== fields.placeLongitude ||
        item.caption !== fields.caption;

      if (!needsPatch) {
        continue;
      }

      patched += 1;
      summaryWrites += fields.placeKey ? 2 : 1;

      if (dryRun) {
        continue;
      }

      await ctx.db.patch(item._id, fields);
      const patchedItem = await ctx.db.get(item._id);

      if (patchedItem) {
        await upsertMonthSummary(ctx, patchedItem);
        await upsertPlaceSummary(ctx, patchedItem);
      }
    }

    return {
      scanned: result.page.length,
      patched,
      summaryWrites,
      hasMore: !result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

function mergeMonths(rows: MemoryMonth[]) {
  const byKey = new Map<string, {
    key: string;
    itemCount: number;
    latestTimelineAt: number;
    coverAssetId: Id<'assets'>;
  }>();

  for (const row of rows) {
    const existing = byKey.get(row.monthKey);

    if (!existing) {
      byKey.set(row.monthKey, {
        key: row.monthKey,
        itemCount: row.itemCount,
        latestTimelineAt: row.latestTimelineAt,
        coverAssetId: row.coverAssetId,
      });
      continue;
    }

    existing.itemCount += row.itemCount;

    if (row.latestTimelineAt > existing.latestTimelineAt) {
      existing.latestTimelineAt = row.latestTimelineAt;
      existing.coverAssetId = row.coverAssetId;
    }
  }

  return Array.from(byKey.values())
    .sort((left, right) => right.latestTimelineAt - left.latestTimelineAt)
    .slice(0, MEMORY_DISCOVERY_SUMMARY_LIMIT);
}

function mergePlaces(rows: MemoryPlace[]) {
  const byKey = new Map<string, {
    key: string;
    label: string;
    latitude: number;
    longitude: number;
    itemCount: number;
    latestTimelineAt: number;
    coverAssetId: Id<'assets'>;
  }>();

  for (const row of rows) {
    const existing = byKey.get(row.placeKey);

    if (!existing) {
      byKey.set(row.placeKey, {
        key: row.placeKey,
        label: row.label,
        latitude: row.latitude,
        longitude: row.longitude,
        itemCount: row.itemCount,
        latestTimelineAt: row.latestTimelineAt,
        coverAssetId: row.coverAssetId,
      });
      continue;
    }

    existing.itemCount += row.itemCount;

    if (row.latestTimelineAt > existing.latestTimelineAt) {
      existing.label = row.label;
      existing.latitude = row.latitude;
      existing.longitude = row.longitude;
      existing.latestTimelineAt = row.latestTimelineAt;
      existing.coverAssetId = row.coverAssetId;
    }
  }

  return Array.from(byKey.values())
    .sort((left, right) => right.latestTimelineAt - left.latestTimelineAt)
    .slice(0, MEMORY_DISCOVERY_SUMMARY_LIMIT);
}

export const discoveryForViewer = query({
  args: {
    circleId: v.optional(v.id('circles')),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const circleIds = args.circleId
      ? [args.circleId]
      : await listViewerCircleIds(ctx, viewer._id);

    if (args.circleId) {
      await requireCircleMembership(ctx, viewer._id, args.circleId);
    }

    if (circleIds.length === 0) {
      return {
        months: [],
        places: [],
      };
    }

    const [monthRows, placeRows] = await Promise.all([
      Promise.all(
        circleIds.map((circleId) =>
          ctx.db
            .query('memoryMonths')
            .withIndex('by_circle_and_latest_timeline_at', (q) => q.eq('circleId', circleId))
            .order('desc')
            .take(MEMORY_DISCOVERY_SUMMARY_LIMIT),
        ),
      ),
      Promise.all(
        circleIds.map((circleId) =>
          ctx.db
            .query('memoryPlaces')
            .withIndex('by_circle_and_latest_timeline_at', (q) => q.eq('circleId', circleId))
            .order('desc')
            .take(MEMORY_DISCOVERY_SUMMARY_LIMIT),
        ),
      ),
    ]);

    return {
      months: mergeMonths(monthRows.flat()),
      places: mergePlaces(placeRows.flat()),
    };
  },
});

async function listCircleMemoryCandidates(
  ctx: QueryCtx,
  input: {
    circleId: Id<'circles'>;
    filter?: { kind: 'month' | 'place'; key: string };
    limit: number;
  },
) {
  if (input.filter?.kind === 'month') {
    return await ctx.db
      .query('memoryItems')
      .withIndex('by_circle_and_month_key_and_timeline_at', (q) =>
        q.eq('circleId', input.circleId).eq('monthKey', input.filter!.key),
      )
      .order('desc')
      .take(input.limit);
  }

  if (input.filter?.kind === 'place') {
    return await ctx.db
      .query('memoryItems')
      .withIndex('by_circle_and_place_key_and_timeline_at', (q) =>
        q.eq('circleId', input.circleId).eq('placeKey', input.filter!.key),
      )
      .order('desc')
      .take(input.limit);
  }

  return await ctx.db
    .query('memoryItems')
    .withIndex('by_circle_and_timeline_at', (q) => q.eq('circleId', input.circleId))
    .order('desc')
    .take(input.limit);
}

export const listForViewer = query({
  args: {
    circleId: v.optional(v.id('circles')),
    filter: memoryFilterValidator,
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const pageSize = normalizePageSize(args.paginationOpts.numItems);

    if (args.circleId) {
      await requireCircleMembership(ctx, viewer._id, args.circleId);
      const queryBuilder =
        args.filter?.kind === 'month'
          ? ctx.db
              .query('memoryItems')
              .withIndex('by_circle_and_month_key_and_timeline_at', (q) =>
                q.eq('circleId', args.circleId!).eq('monthKey', args.filter!.key),
              )
          : args.filter?.kind === 'place'
            ? ctx.db
                .query('memoryItems')
                .withIndex('by_circle_and_place_key_and_timeline_at', (q) =>
                  q.eq('circleId', args.circleId!).eq('placeKey', args.filter!.key),
                )
            : ctx.db
                .query('memoryItems')
                .withIndex('by_circle_and_timeline_at', (q) => q.eq('circleId', args.circleId!));
      const result = await queryBuilder.order('desc').paginate({
        numItems: pageSize,
        cursor: args.paginationOpts.cursor,
      });
      const mapped = await Promise.all(result.page.map((item) => mapMemoryItem(ctx, item)));

      return {
        ...result,
        page: mapped.filter((item): item is NonNullable<typeof item> => item !== null),
      };
    }

    const circleIds = await listViewerCircleIds(ctx, viewer._id);

    if (circleIds.length === 0) {
      return {
        page: [],
        isDone: true,
        continueCursor: args.paginationOpts.cursor ?? '',
      };
    }

    const cursorOffset = parseCursorOffset(args.paginationOpts.cursor);
    const candidates = (
      await Promise.all(
        circleIds.map((circleId) =>
          listCircleMemoryCandidates(ctx, {
            circleId,
            filter: args.filter,
            limit: MEMORY_ITEMS_PER_CIRCLE_LIMIT,
          }),
        ),
      )
    )
      .flat()
      .sort(compareMemoryItems);
    const pageItems = candidates.slice(cursorOffset, cursorOffset + pageSize);
    const mapped = await Promise.all(pageItems.map((item) => mapMemoryItem(ctx, item)));
    const page = mapped.filter((item): item is NonNullable<typeof item> => item !== null);
    const nextOffset = cursorOffset + pageItems.length;

    return {
      page,
      isDone: nextOffset >= candidates.length,
      continueCursor: String(nextOffset),
    };
  },
});

/**
 * Every recent memory item that carries coordinates, for the full-screen map.
 * Lightweight on purpose: no asset/share lookups — coordinates and labels are
 * denormalized onto the memory item at publish time.
 */
export const locatedForViewer = query({
  args: {
    circleId: v.optional(v.id('circles')),
  },
  returns: v.array(
    v.object({
      _id: v.id('memoryItems'),
      circleId: v.id('circles'),
      circleName: v.string(),
      assetId: v.id('assets'),
      kind: v.union(v.literal('image'), v.literal('video')),
      timelineAt: v.number(),
      capturedAt: v.union(v.number(), v.null()),
      latitude: v.number(),
      longitude: v.number(),
      placeLabel: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    let circleIds: Id<'circles'>[];

    if (args.circleId) {
      await requireCircleMembership(ctx, viewer._id, args.circleId);
      circleIds = [args.circleId];
    } else {
      circleIds = await listViewerCircleIds(ctx, viewer._id);
    }

    const located: Array<{
      _id: Id<'memoryItems'>;
      circleId: Id<'circles'>;
      circleName: string;
      assetId: Id<'assets'>;
      kind: 'image' | 'video';
      timelineAt: number;
      capturedAt: number | null;
      latitude: number;
      longitude: number;
      placeLabel: string | null;
    }> = [];

    for (const circleId of circleIds) {
      const circle = await ctx.db.get(circleId);

      if (!circle) {
        continue;
      }

      const items = await ctx.db
        .query('memoryItems')
        .withIndex('by_circle_and_timeline_at', (q) => q.eq('circleId', circleId))
        .order('desc')
        .take(MEMORY_MAP_ITEMS_PER_CIRCLE_LIMIT);

      for (const item of items) {
        if (item.placeLatitude === undefined || item.placeLongitude === undefined) {
          continue;
        }

        located.push({
          _id: item._id,
          circleId: item.circleId,
          circleName: circle.name,
          assetId: item.assetId,
          kind: item.kind,
          timelineAt: item.timelineAt,
          capturedAt: item.capturedAt ?? null,
          latitude: item.placeLatitude,
          longitude: item.placeLongitude,
          placeLabel: item.placeLabel ?? null,
        });
      }
    }

    located.sort((left, right) => right.timelineAt - left.timelineAt);

    return located.slice(0, MEMORY_MAP_TOTAL_LIMIT);
  },
});
