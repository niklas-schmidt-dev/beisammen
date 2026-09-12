import { normalizeBaseUrl, type MediaLocation } from '@beisammen/contracts';
import type { UploadEncryptionEnvelope, UploadQueueItem } from '@beisammen/upload-client';

export interface UploadRecoveryFileDriver {
  readText(path: string): Promise<string | null>;
  writeText(path: string, value: string): Promise<void>;
  delete(path: string): Promise<void>;
  list?(path: string): Promise<string[]>;
}

export interface UploadRecoveryStore {
  loadQueue(input: UploadRecoveryScope): Promise<UploadQueueItem[]>;
  saveQueue(input: UploadRecoveryScope & { items: UploadQueueItem[] }): Promise<void>;
  clearShareBatch(input: UploadRecoveryScope): Promise<void>;
  clearInstance(input: { instanceUrl: string }): Promise<void>;
  clearItemFiles(
    item: Pick<
      UploadQueueItem,
      | 'cacheUri'
      | 'previewCacheUri'
      | 'pairedVideoCacheUri'
      | 'encryptedCacheUri'
      | 'encryptedPreviewCacheUri'
      | 'encryptedPairedVideoCacheUri'
    >,
  ): Promise<void>;
}

interface UploadRecoveryScope {
  instanceUrl: string;
  shareBatchId: string;
}

const RECOVERY_ROOT = 'upload-recovery';

/**
 * Directory name for an instance inside the recovery root. Must not contain
 * percent-escapes: Android's `Uri.getPath()` decodes them, so a directory
 * named `https%3A%2F%2Fhost` turns into `https://host` on disk and every
 * native path round-trip afterwards (image compressor, file info) re-parses
 * that as a URI scheme and fails. Escapes are therefore mapped to `_`.
 */
export function uploadRecoveryInstanceKey(instanceUrl: string): string {
  return encodeURIComponent(normalizeBaseUrl(instanceUrl)).replace(/%/g, '_');
}

/** Pre-fix directory name (percent-encoded); only used to clean it up. */
function legacyInstanceKey(instanceUrl: string): string {
  return encodeURIComponent(normalizeBaseUrl(instanceUrl));
}

function metadataPath(input: UploadRecoveryScope): string {
  return `${RECOVERY_ROOT}/${uploadRecoveryInstanceKey(input.instanceUrl)}/${input.shareBatchId}.json`;
}

function instancePath(instanceUrl: string): string {
  return `${RECOVERY_ROOT}/${uploadRecoveryInstanceKey(instanceUrl)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function optionalLocation(value: unknown): MediaLocation | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const latitude = optionalNumber(value.latitude);
  const longitude = optionalNumber(value.longitude);
  const source =
    value.source === 'embedded' || value.source === 'device-fallback'
      ? value.source
      : null;

  if (latitude === undefined || longitude === undefined || !source) {
    return undefined;
  }

  return {
    latitude,
    longitude,
    source,
    ...(optionalNumber(value.accuracyMeters) !== undefined
      ? { accuracyMeters: optionalNumber(value.accuracyMeters) }
      : {}),
    ...(optionalString(value.label) ? { label: optionalString(value.label) } : {}),
    ...(optionalString(value.city) ? { city: optionalString(value.city) } : {}),
    ...(optionalString(value.region) ? { region: optionalString(value.region) } : {}),
    ...(optionalString(value.country) ? { country: optionalString(value.country) } : {}),
  };
}

// Only the sealed envelope is ever persisted: wrappedFileKey and encMetadata
// are ciphertext, so recovery storage never holds raw key material.
function optionalEncryption(value: unknown): UploadEncryptionEnvelope | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const circleEpoch = optionalNumber(value.circleEpoch);
  const wrappedFileKey = optionalString(value.wrappedFileKey);

  if (value.v !== 1 || circleEpoch === undefined || wrappedFileKey === undefined) {
    return undefined;
  }

  return {
    v: 1,
    circleEpoch,
    wrappedFileKey,
    ...(optionalString(value.encMetadata)
      ? { encMetadata: optionalString(value.encMetadata) }
      : {}),
  };
}

function isRecoverableItem(item: UploadQueueItem): boolean {
  return item.recoverable === true && Boolean(item.cacheUri) && item.status !== 'uploaded';
}

function serializeItem(item: UploadQueueItem): UploadQueueItem | null {
  if (!isRecoverableItem(item)) {
    return null;
  }

  const { sourceAsset: _sourceAsset, ...serialized } = item;
  return serialized;
}

function parseItem(value: unknown): UploadQueueItem | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = optionalString(value.id);
  const circleId = optionalString(value.circleId);
  const shareBatchId = optionalString(value.shareBatchId);
  const kind = value.kind === 'image' || value.kind === 'video' ? value.kind : null;
  const fileName = optionalString(value.fileName);
  const mimeType = optionalString(value.mimeType);
  const fileUri = optionalString(value.fileUri);
  const createdAt = optionalNumber(value.createdAt);
  const updatedAt = optionalNumber(value.updatedAt);
  const sizeBytes = optionalNumber(value.sizeBytes);
  const previewSizeBytes = optionalNumber(value.previewSizeBytes);
  const width = optionalNumber(value.width);
  const height = optionalNumber(value.height);
  const durationSeconds = optionalNumber(value.durationSeconds);
  const capturedAt = optionalNumber(value.capturedAt);
  const location = optionalLocation(value.location);
  const status =
    value.status === 'draft' ||
    value.status === 'processing' ||
    value.status === 'uploading' ||
    value.status === 'uploaded' ||
    value.status === 'failed'
      ? value.status
      : null;

  if (!id || !circleId || !shareBatchId || !kind || !fileName || !mimeType || !fileUri || !status) {
    return null;
  }

  const item: UploadQueueItem = {
    id,
    circleId,
    shareBatchId,
    kind,
    fileName,
    mimeType,
    fileUri,
    status,
    attempts: optionalNumber(value.attempts) ?? 0,
    ...(optionalString(value.uploadId) ? { uploadId: optionalString(value.uploadId) } : {}),
    ...(value.prepared === true ? { prepared: true } : {}),
    ...(optionalString(value.cacheUri) ? { cacheUri: optionalString(value.cacheUri) } : {}),
    ...(optionalString(value.previewCacheUri)
      ? { previewCacheUri: optionalString(value.previewCacheUri) }
      : {}),
    ...(optionalString(value.encryptedCacheUri)
      ? { encryptedCacheUri: optionalString(value.encryptedCacheUri) }
      : {}),
    ...(optionalString(value.encryptedPreviewCacheUri)
      ? { encryptedPreviewCacheUri: optionalString(value.encryptedPreviewCacheUri) }
      : {}),
    ...(optionalString(value.encryptedPairedVideoCacheUri)
      ? { encryptedPairedVideoCacheUri: optionalString(value.encryptedPairedVideoCacheUri) }
      : {}),
    ...(optionalString(value.pairedVideoUri)
      ? { pairedVideoUri: optionalString(value.pairedVideoUri) }
      : {}),
    ...(optionalString(value.pairedVideoCacheUri)
      ? { pairedVideoCacheUri: optionalString(value.pairedVideoCacheUri) }
      : {}),
    ...(optionalString(value.pairedVideoMimeType)
      ? { pairedVideoMimeType: optionalString(value.pairedVideoMimeType) }
      : {}),
    ...(optionalNumber(value.pairedVideoSizeBytes) !== undefined
      ? { pairedVideoSizeBytes: optionalNumber(value.pairedVideoSizeBytes) }
      : {}),
    ...(optionalNumber(value.pairedVideoDurationSeconds) !== undefined
      ? { pairedVideoDurationSeconds: optionalNumber(value.pairedVideoDurationSeconds) }
      : {}),
    ...(optionalEncryption(value.encryption)
      ? { encryption: optionalEncryption(value.encryption) }
      : {}),
    ...(optionalString(value.recoveryKey) ? { recoveryKey: optionalString(value.recoveryKey) } : {}),
    ...(value.recoverable === true ? { recoverable: true } : { recoverable: false }),
    ...(createdAt !== undefined ? { createdAt } : {}),
    ...(updatedAt !== undefined ? { updatedAt } : {}),
    ...(optionalString(value.previewUri) ? { previewUri: optionalString(value.previewUri) } : {}),
    ...(sizeBytes !== undefined ? { sizeBytes } : {}),
    ...(previewSizeBytes !== undefined ? { previewSizeBytes } : {}),
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    ...(durationSeconds !== undefined ? { durationSeconds } : {}),
    ...(capturedAt !== undefined ? { capturedAt } : {}),
    ...(location ? { location } : {}),
    ...(optionalString(value.locationLabel) ? { locationLabel: optionalString(value.locationLabel) } : {}),
    ...(optionalString(value.errorMessage) ? { errorMessage: optionalString(value.errorMessage) } : {}),
  };

  if (!isRecoverableItem(item)) {
    return null;
  }

  return item;
}

function uniqueUris(
  item: Pick<
    UploadQueueItem,
    | 'cacheUri'
    | 'previewCacheUri'
    | 'pairedVideoCacheUri'
    | 'encryptedCacheUri'
    | 'encryptedPreviewCacheUri'
    | 'encryptedPairedVideoCacheUri'
  >,
): string[] {
  return Array.from(
    new Set(
      [
        item.cacheUri,
        item.previewCacheUri,
        item.pairedVideoCacheUri,
        item.encryptedCacheUri,
        item.encryptedPreviewCacheUri,
        item.encryptedPairedVideoCacheUri,
      ].filter((uri): uri is string => Boolean(uri)),
    ),
  );
}

export function createUploadRecoveryStore(driver: UploadRecoveryFileDriver): UploadRecoveryStore {
  return {
    async loadQueue(input) {
      const raw = await driver.readText(metadataPath(input));

      if (!raw) {
        return [];
      }

      let payload: unknown;

      try {
        payload = JSON.parse(raw);
      } catch {
        return [];
      }

      if (!isRecord(payload) || !Array.isArray(payload.items)) {
        return [];
      }

      return payload.items
        .map((item) => parseItem(item))
        .filter((item): item is UploadQueueItem => item !== null);
    },

    async saveQueue(input) {
      const items = input.items
        .map((item) => serializeItem(item))
        .filter((item): item is UploadQueueItem => item !== null);
      const path = metadataPath(input);

      if (items.length === 0) {
        await driver.delete(path);
        return;
      }

      await driver.writeText(path, JSON.stringify({ items }, null, 2));
    },

    async clearShareBatch(input) {
      const items = await this.loadQueue(input);

      for (const item of items) {
        await this.clearItemFiles(item);
      }

      await driver.delete(metadataPath(input));
    },

    async clearInstance(input) {
      const path = instancePath(input.instanceUrl);

      if (driver.list) {
        const entries = await driver.list(path);

        for (const entry of entries) {
          if (!entry.endsWith('.json')) {
            continue;
          }

          const raw = await driver.readText(entry);

          if (!raw) {
            continue;
          }

          let payload: unknown;

          try {
            payload = JSON.parse(raw);
          } catch {
            continue;
          }

          if (!isRecord(payload) || !Array.isArray(payload.items)) {
            continue;
          }

          for (const item of payload.items) {
            const parsed = parseItem(item);

            if (parsed) {
              await this.clearItemFiles(parsed);
            }
          }
        }
      }

      await driver.delete(path);
      // Percent-encoded directory from before the key change. Its items are
      // no longer hydrated (Android could never process them anyway), so the
      // leftover files are removed instead of lingering forever.
      await driver.delete(`${RECOVERY_ROOT}/${legacyInstanceKey(input.instanceUrl)}`);
    },

    async clearItemFiles(item) {
      for (const uri of uniqueUris(item)) {
        await driver.delete(uri);
      }
    },
  };
}
