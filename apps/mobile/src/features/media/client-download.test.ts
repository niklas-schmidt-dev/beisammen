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

import { generateCircleKey, type SodiumApi } from '@beisammen/crypto';

import { sealAssetEncryption } from '@/features/crypto/asset-metadata';
import { encryptFileToFile } from '@/features/crypto/file-crypto';
import {
  fakeFsState,
  listFiles,
  readFile,
  registerDownload,
  resetFakeFileSystem,
  seedFile,
} from '@/test/fake-file-system';

import { downloadAssetToCache } from './client';

const DOWNLOAD_DIRECTORY = 'file:///cache/share-downloads/';

let sodium: SodiumApi;

beforeAll(async () => {
  await _sodium.ready;
  sodium = _sodium as unknown as SodiumApi;
});

beforeEach(() => {
  resetFakeFileSystem();
});

describe('downloadAssetToCache', () => {
  test('downloads plaintext legacy assets verbatim under their file name', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);

    registerDownload('https://cdn.example/photo', bytes);

    const uri = await downloadAssetToCache({
      asset: { _id: 'asset1', kind: 'image', mimeType: 'image/jpeg', fileName: 'Strand Foto.jpg' },
      url: 'https://cdn.example/photo',
    });

    expect(uri.startsWith(DOWNLOAD_DIRECTORY)).toBe(true);
    expect(uri.endsWith('-Strand-Foto.jpg')).toBe(true);
    expect(readFile(uri)).toEqual(bytes);
  });

  test('decrypts encrypted assets and names them after the sealed metadata file name', async () => {
    const plaintext = new Uint8Array(4096).map((_, index) => (index * 13) % 256);
    const circleKey = generateCircleKey(sodium);
    const { fileKey, envelope } = sealAssetEncryption({
      sodium,
      circleKey,
      circleEpoch: 2,
      metadata: {
        v: 1,
        fileName: 'Urlaub Original.mov',
        location: { latitude: 48.1, longitude: 11.5, source: 'embedded' },
      },
    });

    seedFile('file:///plain.bin', plaintext);
    await encryptFileToFile({
      sodium,
      fileKey,
      sourceUri: 'file:///plain.bin',
      targetUri: 'file:///cipher.bin',
    });
    registerDownload('https://cdn.example/cipher', readFile('file:///cipher.bin')!);

    const uri = await downloadAssetToCache({
      asset: { _id: 'asset2', kind: 'video', mimeType: 'video/quicktime', encryption: envelope },
      url: 'https://cdn.example/cipher',
      keysByEpoch: new Map([[2, circleKey]]),
    });

    expect(uri.endsWith('-Urlaub-Original.mov')).toBe(true);
    expect(readFile(uri)).toEqual(plaintext);
    // The ciphertext temp file is cleaned up; only the plaintext remains.
    expect(listFiles(DOWNLOAD_DIRECTORY)).toEqual([uri]);
  });

  test('rejects encrypted assets when the circle keys are missing', async () => {
    const circleKey = generateCircleKey(sodium);
    const { envelope } = sealAssetEncryption({
      sodium,
      circleKey,
      circleEpoch: 1,
      metadata: { v: 1 },
    });

    await expect(
      downloadAssetToCache({
        asset: { _id: 'asset3', kind: 'image', mimeType: 'image/jpeg', encryption: envelope },
        url: 'https://cdn.example/cipher',
      }),
    ).rejects.toThrow('Schlüssel für dieses Medium sind noch nicht verfügbar.');
  });

  test('copies already-decrypted local files instead of downloading again', async () => {
    const plaintext = new Uint8Array([9, 8, 7, 6, 5]);
    const circleKey = generateCircleKey(sodium);
    const { envelope } = sealAssetEncryption({
      sodium,
      circleKey,
      circleEpoch: 1,
      metadata: { v: 1, fileName: 'katze.png' },
    });

    seedFile('file:///cache/decrypted-media/asset4-original.png', plaintext);

    const uri = await downloadAssetToCache({
      asset: { _id: 'asset4', kind: 'image', mimeType: 'image/png', encryption: envelope },
      url: 'file:///cache/decrypted-media/asset4-original.png',
      keysByEpoch: new Map([[1, circleKey]]),
    });

    expect(uri.endsWith('-katze.png')).toBe(true);
    expect(readFile(uri)).toEqual(plaintext);
    expect(fakeFsState.downloadCount).toBe(0);
    expect(fakeFsState.copyCount).toBe(1);
  });
});
