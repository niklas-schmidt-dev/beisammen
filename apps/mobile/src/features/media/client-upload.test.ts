import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getInfoAsync: vi.fn(),
  getAssetInfoAsync: vi.fn(),
  uploadTask: vi.fn(),
  createUploadTask: vi.fn(),
}));

vi.mock('expo-file-system/legacy', () => ({
  FileSystemUploadType: {
    BINARY_CONTENT: 'BINARY_CONTENT',
  },
  cacheDirectory: 'file:///cache/',
  createUploadTask: mocks.createUploadTask,
  downloadAsync: vi.fn(),
  getInfoAsync: mocks.getInfoAsync,
  makeDirectoryAsync: vi.fn(),
}));

vi.mock('expo-image-picker', () => ({}));
vi.mock('expo-location', () => ({}));
vi.mock('expo-media-library/legacy', () => ({
  getAssetInfoAsync: mocks.getAssetInfoAsync,
}));
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

import { optimizePickerAsset, uploadPreparedFile } from './client';

const target = {
  provider: 's3' as const,
  uploadUrl: 'https://storage.example.com/upload',
  method: 'PUT' as const,
  objectKey: 'objects/photo.jpg',
  expiresAt: Date.now() + 60_000,
  headers: {
    'x-amz-meta-upload': 'upload-1',
  },
};

const asset = {
  uri: 'file:///cache/photo.jpg',
  previewUri: 'file:///cache/photo.jpg',
  fileName: 'photo.jpg',
  mimeType: 'image/jpeg',
  kind: 'image' as const,
};

describe('native upload transport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getInfoAsync.mockResolvedValue({
      exists: true,
      isDirectory: false,
      uri: asset.uri,
      size: 1024,
    });
    mocks.getAssetInfoAsync.mockResolvedValue({});
    mocks.createUploadTask.mockImplementation((_url, _uri, _options, callback) => {
      return {
        uploadAsync: mocks.uploadTask.mockImplementation(async () => {
          callback?.({
            totalBytesSent: 256,
            totalBytesExpectedToSend: 1024,
          });

          return {
            status: 200,
            body: '',
            headers: {},
          };
        }),
      };
    });
  });

  test('uploads local files through the native binary upload task', async () => {
    const onProgress = vi.fn();

    await expect(uploadPreparedFile({ target, asset, onProgress })).resolves.toEqual({
      objectKey: 'objects/photo.jpg',
    });

    expect(mocks.createUploadTask).toHaveBeenCalledWith(
      target.uploadUrl,
      asset.uri,
      {
        headers: {
          ...target.headers,
          'content-type': asset.mimeType,
        },
        httpMethod: 'PUT',
        uploadType: 'BINARY_CONTENT',
      },
      expect.any(Function),
    );
    expect(onProgress).toHaveBeenCalledWith({
      bytesSent: 256,
      totalBytesExpectedToSend: 1024,
    });
  });

  test('normalizes absolute local paths before starting the native upload task', async () => {
    await expect(
      uploadPreparedFile({
        target,
        asset: {
          ...asset,
          uri: '/cache/photo.jpg',
        },
      }),
    ).resolves.toEqual({
      objectKey: 'objects/photo.jpg',
    });

    expect(mocks.getInfoAsync).toHaveBeenCalledWith('file:///cache/photo.jpg');
    expect(mocks.createUploadTask).toHaveBeenCalledWith(
      target.uploadUrl,
      'file:///cache/photo.jpg',
      expect.any(Object),
      expect.any(Function),
    );
  });

  test('normalizes single-slash file URIs from native helpers', async () => {
    await expect(
      uploadPreparedFile({
        target,
        asset: {
          ...asset,
          uri: 'file:/cache/photo.jpg',
        },
      }),
    ).resolves.toEqual({
      objectKey: 'objects/photo.jpg',
    });

    expect(mocks.getInfoAsync).toHaveBeenCalledWith('file:///cache/photo.jpg');
    expect(mocks.createUploadTask).toHaveBeenCalledWith(
      target.uploadUrl,
      'file:///cache/photo.jpg',
      expect.any(Object),
      expect.any(Function),
    );
  });

  test('rejects missing local files before starting the native upload task', async () => {
    mocks.getInfoAsync.mockResolvedValueOnce({
      exists: false,
      isDirectory: false,
      uri: asset.uri,
    });

    await expect(uploadPreparedFile({ target, asset })).rejects.toThrow(
      /Upload-Datei ist nicht mehr lokal verfügbar/,
    );
    expect(mocks.createUploadTask).not.toHaveBeenCalled();
  });

  test('rejects non-file upload sources before starting the native upload task', async () => {
    await expect(
      uploadPreparedFile({
        target,
        asset: {
          ...asset,
          uri: 'ph://photo',
        },
      }),
    ).rejects.toThrow(/Upload-Datei ist keine lokale Datei/);
    expect(mocks.getInfoAsync).not.toHaveBeenCalled();
    expect(mocks.createUploadTask).not.toHaveBeenCalled();
  });

  test('resolves iOS library assets to local file URIs before upload preparation', async () => {
    mocks.getAssetInfoAsync.mockResolvedValueOnce({
      localUri: '/private/var/mobile/Containers/Data/photo.jpg',
    });

    await expect(
      optimizePickerAsset({
        uri: 'ph://photo',
        assetId: 'asset-1',
        type: 'image',
        fileName: 'photo.jpg',
        mimeType: 'image/jpeg',
        fileSize: 512,
        width: 1200,
        height: 800,
      } as never),
    ).resolves.toMatchObject({
      uri: 'file:///private/var/mobile/Containers/Data/photo.jpg',
      previewUri: 'file:///private/var/mobile/Containers/Data/photo.jpg',
      sizeBytes: 512,
    });

    expect(mocks.getAssetInfoAsync).toHaveBeenCalledWith('asset-1', {
      shouldDownloadFromNetwork: true,
    });
  });

  test('rejects non-successful native upload responses', async () => {
    mocks.createUploadTask.mockReturnValue({
      uploadAsync: vi.fn(async () => ({
        status: 403,
        body: 'expired',
        headers: {},
      })),
    });

    await expect(uploadPreparedFile({ target, asset })).rejects.toThrow(
      /S3 upload failed with status 403/,
    );
  });
});
