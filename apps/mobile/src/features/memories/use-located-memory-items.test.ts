import _sodium from 'libsodium-wrappers';
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('expo-file-system', async () =>
  (await import('@/test/fake-file-system')).createModernFileSystemMock(),
);
vi.mock('expo-file-system/legacy', async () =>
  (await import('@/test/fake-file-system')).createLegacyFileSystemMock(),
);
vi.mock('@/features/crypto/sodium', async () => {
  const sodium = (await import('libsodium-wrappers')).default;

  return {
    getSodium: async () => {
      await sodium.ready;
      return sodium as unknown as import('@beisammen/crypto').SodiumApi;
    },
  };
});
vi.mock('expo-image-picker', () => ({}));
vi.mock('expo-location', () => ({}));
vi.mock('expo-media-library/legacy', () => ({}));
vi.mock('expo-sharing', () => ({}));
vi.mock('react-native', () => ({
  Alert: {
    alert: vi.fn(),
  },
}));
vi.mock('react-native-compressor', () => ({
  Image: {
    compress: vi.fn(),
  },
  createVideoThumbnail: vi.fn(),
  getRealPath: vi.fn(),
}));
// The hook itself needs a renderer; these mocks keep the module importable in
// Node so the exported aggregation core can be exercised directly.
vi.mock('convex/react', () => ({ useConvex: vi.fn() }));
vi.mock('@/features/crypto/provider', () => ({
  useCrypto: vi.fn(() => ({ status: 'loading', userKeys: null })),
}));
vi.mock('@/features/crypto/use-circle-keys', () => ({
  useCircleKeys: vi.fn(() => ({ status: 'loading' })),
}));

import type { MediaLocation } from '@beisammen/contracts';
import { generateCircleKey, type SodiumApi } from '@beisammen/crypto';

import type { AssetMetadataRecord } from '@/features/convex/api';
import { sealAssetEncryption } from '@/features/crypto/asset-metadata';
import { resetDecryptedAssetMetadataForTesting } from '@/features/media/use-decrypted-asset-location';

import {
  collectLocatedItemsForCircle,
  LOCATED_ASSETS_PER_CIRCLE_LIMIT,
  LOCATED_ITEMS_TOTAL_LIMIT,
  mergeLocatedItems,
  type LocatedMemoryItem,
} from './use-located-memory-items';

let sodium: SodiumApi;

beforeAll(async () => {
  await _sodium.ready;
  sodium = _sodium as unknown as SodiumApi;
});

beforeEach(() => {
  resetDecryptedAssetMetadataForTesting();
});

const CIRCLE = { _id: 'circle1', name: 'Familie' };

function legacyAsset(
  id: string,
  location: MediaLocation | undefined,
  overrides: Partial<AssetMetadataRecord> = {},
): AssetMetadataRecord {
  return {
    _id: id,
    shareBatchId: 'share1',
    kind: 'image',
    createdAt: 1_000,
    ...(location ? { location } : {}),
    ...overrides,
  };
}

function sealedAsset(
  id: string,
  circleKey: Uint8Array,
  metadata: { fileName?: string; location?: MediaLocation },
  overrides: Partial<AssetMetadataRecord> = {},
): AssetMetadataRecord {
  const { envelope } = sealAssetEncryption({
    sodium,
    circleKey,
    circleEpoch: 1,
    metadata: { v: 1, ...metadata },
  });

  return {
    _id: id,
    shareBatchId: 'share1',
    kind: 'image',
    createdAt: 1_000,
    encryption: envelope,
    ...overrides,
  };
}

describe('collectLocatedItemsForCircle', () => {
  test('legacy plaintext locations become located items with their label', () => {
    const items = collectLocatedItemsForCircle({
      sodium,
      circle: CIRCLE,
      assets: [
        legacyAsset('asset1', {
          latitude: 48.1372,
          longitude: 11.5756,
          label: 'Marienplatz',
          source: 'embedded',
        }),
        legacyAsset('asset2', undefined),
      ],
      keysByEpoch: null,
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      _id: 'asset1',
      assetId: 'asset1',
      circleId: 'circle1',
      circleName: 'Familie',
      latitude: 48.1372,
      longitude: 11.5756,
      placeLabel: 'Marienplatz',
    });
    expect(items[0]!.asset.encryption).toBeUndefined();
  });

  test('encrypted assets contribute their decrypted location, envelope, and file name', () => {
    const circleKey = generateCircleKey(sodium);
    const asset = sealedAsset('asset1', circleKey, {
      fileName: 'strand.jpg',
      location: {
        latitude: 54.18,
        longitude: 7.88,
        city: 'Helgoland',
        country: 'Deutschland',
        source: 'embedded',
      },
    });

    const items = collectLocatedItemsForCircle({
      sodium,
      circle: CIRCLE,
      assets: [asset],
      keysByEpoch: new Map([[1, circleKey]]),
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      _id: 'asset1',
      latitude: 54.18,
      longitude: 7.88,
      placeLabel: 'Helgoland, Deutschland',
    });
    expect(items[0]!.asset.fileName).toBe('strand.jpg');
    expect(items[0]!.asset.encryption).toBe(asset.encryption);
  });

  test('encrypted assets without the epoch key are skipped and decrypt once keys arrive', () => {
    const circleKey = generateCircleKey(sodium);
    const encrypted = sealedAsset('asset1', circleKey, {
      location: { latitude: 1, longitude: 2, source: 'embedded' },
    });
    const legacy = legacyAsset('asset2', {
      latitude: 3,
      longitude: 4,
      label: 'Zuhause',
      source: 'embedded',
    });

    const withoutKeys = collectLocatedItemsForCircle({
      sodium,
      circle: CIRCLE,
      assets: [encrypted, legacy],
      keysByEpoch: null,
    });

    expect(withoutKeys.map((item) => item._id)).toEqual(['asset2']);

    // The failed circle must not poison the session cache: the same asset
    // decrypts as soon as the epoch key is available.
    const withKeys = collectLocatedItemsForCircle({
      sodium,
      circle: CIRCLE,
      assets: [encrypted, legacy],
      keysByEpoch: new Map([[1, circleKey]]),
    });

    expect(withKeys.map((item) => item._id)).toEqual(['asset1', 'asset2']);
  });

  test('encrypted assets whose metadata has no location are skipped', () => {
    const circleKey = generateCircleKey(sodium);

    const items = collectLocatedItemsForCircle({
      sodium,
      circle: CIRCLE,
      assets: [sealedAsset('asset1', circleKey, { fileName: 'ohne-ort.jpg' })],
      keysByEpoch: new Map([[1, circleKey]]),
    });

    expect(items).toHaveLength(0);
  });

  test('timelineAt prefers capturedAt over createdAt', () => {
    const items = collectLocatedItemsForCircle({
      sodium,
      circle: CIRCLE,
      assets: [
        legacyAsset(
          'asset1',
          { latitude: 1, longitude: 2, label: 'A', source: 'embedded' },
          { capturedAt: 500, createdAt: 1_000 },
        ),
        legacyAsset('asset2', { latitude: 1, longitude: 2, label: 'B', source: 'embedded' }),
      ],
      keysByEpoch: null,
    });

    expect(items[0]).toMatchObject({ timelineAt: 500, capturedAt: 500 });
    expect(items[1]).toMatchObject({ timelineAt: 1_000, capturedAt: null });
  });

  test('labels fall back to coordinates when no place fields exist', () => {
    const items = collectLocatedItemsForCircle({
      sodium,
      circle: CIRCLE,
      assets: [legacyAsset('asset1', { latitude: 48.1, longitude: 11.6, source: 'embedded' })],
      keysByEpoch: null,
    });

    expect(items[0]!.placeLabel).toBe('48.1000, 11.6000');
  });

  test('scans at most the mirrored per-circle cap', () => {
    const assets = Array.from({ length: LOCATED_ASSETS_PER_CIRCLE_LIMIT + 20 }, (_, index) =>
      legacyAsset(`asset${index}`, {
        latitude: 1,
        longitude: 2,
        label: 'Ort',
        source: 'embedded',
      }),
    );

    const items = collectLocatedItemsForCircle({
      sodium,
      circle: CIRCLE,
      assets,
      keysByEpoch: null,
    });

    expect(items).toHaveLength(LOCATED_ASSETS_PER_CIRCLE_LIMIT);
  });
});

describe('mergeLocatedItems', () => {
  function locatedItem(id: string, timelineAt: number): LocatedMemoryItem {
    return {
      _id: id,
      assetId: id,
      circleId: 'circle1',
      circleName: 'Familie',
      kind: 'image',
      timelineAt,
      capturedAt: timelineAt,
      latitude: 1,
      longitude: 2,
      placeLabel: null,
      location: { latitude: 1, longitude: 2, source: 'embedded' },
      asset: {},
    };
  }

  test('sorts newest-first across circles', () => {
    const merged = mergeLocatedItems([
      [locatedItem('a', 100), locatedItem('b', 300)],
      [locatedItem('c', 200)],
    ]);

    expect(merged.map((item) => item._id)).toEqual(['b', 'c', 'a']);
  });

  test('caps the merged list at the mirrored total limit', () => {
    const groups = [
      Array.from({ length: LOCATED_ITEMS_TOTAL_LIMIT }, (_, index) =>
        locatedItem(`a${index}`, index),
      ),
      [locatedItem('newest', LOCATED_ITEMS_TOTAL_LIMIT + 1)],
    ];

    const merged = mergeLocatedItems(groups);

    expect(merged).toHaveLength(LOCATED_ITEMS_TOTAL_LIMIT);
    expect(merged[0]!._id).toBe('newest');
  });
});
