import * as ImagePicker from 'expo-image-picker';
import { useGT, useMessages } from 'gt-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useAction, useMutation } from 'convex/react';

import {
  assertPreparedUploadAssetMimeTypeSupported,
  enqueue,
  initialUploadQueueState,
  markUploadStatus,
  patchUploadProgress,
  patchUploadQueueItem,
  removeUploadQueueItems,
  uploadQueueItemToPreparedAsset,
  type UploadEncryptionEnvelope,
  type UploadQueueItem,
  type UploadQueueState,
} from '@beisammen/upload-client';

import type { CircleListItem, ShareDraftRecord } from '@/features/convex/api';
import { useSession } from '@/features/auth/session-provider';
import { api } from '@/features/convex/api';
import type { CircleKeysState } from '@/features/crypto/use-circle-keys';
import { recordClientDiagnostic } from '@/features/diagnostics/buffer';
import { createLogger } from '@/lib/logger';

import {
  assetKind,
  fileNameFromPickerAsset,
  formatMediaLocation,
  getFileSize,
  mimeTypeForPickerAsset,
  optimizePickerAsset,
  resolvePickerAssetMetadata,
  resolveUploadPreview,
  uploadPreparedFile,
  type PreparedUploadAsset,
} from './client';
import {
  encryptedCompletionFields,
  genericUploadFileName,
  resolveUploadEncryption,
} from './upload-encryption';
import {
  cacheUploadRecoveryFile,
  clearUploadRecoveryItemFiles,
  prepareUploadEncryptionTargets,
  uploadRecoveryStore,
} from './upload-recovery-runtime';

const logger = createLogger('media.shareUpload');

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * Pipeline step of a single asset. Reported (without any file details) with
 * a failure so Observe shows where uploads break: preparing/compressing,
 * previewing, encrypting, requesting the target, the S3 PUTs or completion.
 */
export type UploadStage =
  | 'prepare'
  | 'size'
  | 'preview'
  | 'encrypt'
  | 'target'
  | 'put'
  | 'put_preview'
  | 'put_paired_video'
  | 'complete';

/**
 * The server refuses to discard uploads that already produced an asset. When a
 * locally failed or recovered queue item hits this, the upload actually
 * succeeded and the queue entry is stale — it is safe to drop locally, since
 * the resulting asset lives in the draft and is deleted there instead.
 */
function isUploadAlreadyCompletedError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('must be deleted via their asset');
}

interface UseShareUploadFlowArgs {
  selectedCircle: CircleListItem | null;
  activeDraft?: ShareDraftRecord | null;
  /** Circle key state for the selected circle; uploads encrypt with it. */
  circleKeys: CircleKeysState;
  onFeedback: (message: string | null) => void;
}

export function useShareUploadFlow({
  activeDraft,
  selectedCircle,
  circleKeys,
  onFeedback,
}: UseShareUploadFlowArgs) {
  const gt = useGT();
  const m = useMessages();
  const getOrCreateDraft = useMutation(api.shares.getOrCreateDraft);
  const createTarget = useAction(api.uploads.createTarget);
  const retryUpload = useAction(api.uploads.retry);
  const completeUpload = useAction(api.uploads.complete);
  const discardUpload = useAction(api.uploads.discard);
  const { instance } = useSession();
  const instanceUrl = instance.instance.baseUrl;

  const [uploadQueue, setUploadQueue] =
    useState<UploadQueueState<ImagePicker.ImagePickerAsset>>(initialUploadQueueState);
  const [isUploading, setIsUploading] = useState(false);
  const hydratedDraftKeysRef = useRef<Set<string>>(new Set());
  const persistedShareBatchIdsRef = useRef<Set<string>>(new Set());

  const selectedQueueItems = useMemo(
    () =>
      selectedCircle
        ? uploadQueue.items.filter((item) => item.circleId === selectedCircle._id)
        : [],
    [selectedCircle, uploadQueue.items],
  );

  const hasUnresolvedUploads = selectedQueueItems.length > 0;

  useEffect(() => {
    hydratedDraftKeysRef.current.clear();
    persistedShareBatchIdsRef.current.clear();
    setUploadQueue(initialUploadQueueState);
  }, [instanceUrl]);

  useEffect(() => {
    if (!selectedCircle || !activeDraft?._id) {
      return;
    }

    const draftKey = `${instanceUrl}:${activeDraft._id}`;

    if (hydratedDraftKeysRef.current.has(draftKey)) {
      return;
    }

    hydratedDraftKeysRef.current.add(draftKey);
    let isCancelled = false;

    void uploadRecoveryStore
      .loadQueue({
        instanceUrl,
        shareBatchId: activeDraft._id,
      })
      .then((items) => {
        if (isCancelled || items.length === 0) {
          return;
        }

        setUploadQueue((state) => {
          const existingIds = new Set(state.items.map((item) => item.id));
          const restoredItems = items.filter(
            (item): item is UploadQueueItem<ImagePicker.ImagePickerAsset> =>
              item.circleId === selectedCircle._id &&
              item.shareBatchId === activeDraft._id &&
              !existingIds.has(item.id),
          );

          if (restoredItems.length === 0) {
            return state;
          }

          return {
            items: [...state.items, ...restoredItems],
          };
        });
      })
      .catch((error) => {
        logger.warn('Upload recovery hydration failed', {
          instanceUrl,
          shareBatchId: activeDraft._id,
          error,
        });
      });

    return () => {
      isCancelled = true;
    };
  }, [activeDraft?._id, instanceUrl, selectedCircle]);

  useEffect(() => {
    const grouped = new Map<string, UploadQueueItem<ImagePicker.ImagePickerAsset>[]>();

    for (const item of uploadQueue.items) {
      if (!item.recoverable || !item.cacheUri || item.status === 'uploaded') {
        continue;
      }

      const items = grouped.get(item.shareBatchId) ?? [];
      items.push(item);
      grouped.set(item.shareBatchId, items);
    }

    for (const [shareBatchId, items] of grouped) {
      void uploadRecoveryStore
        .saveQueue({
          instanceUrl,
          shareBatchId,
          items,
        })
        .catch((error) => {
          logger.warn('Upload recovery persistence failed', {
            instanceUrl,
            shareBatchId,
            error,
          });
        });
    }

    for (const shareBatchId of persistedShareBatchIdsRef.current) {
      if (grouped.has(shareBatchId)) {
        continue;
      }

      void uploadRecoveryStore
        .saveQueue({
          instanceUrl,
          shareBatchId,
          items: [],
        })
        .catch((error) => {
          logger.warn('Upload recovery metadata cleanup failed', {
            instanceUrl,
            shareBatchId,
            error,
          });
        });
    }

    persistedShareBatchIdsRef.current = new Set(grouped.keys());
  }, [instanceUrl, uploadQueue.items]);

  const uploadPreparedAsset = useCallback(
    async (input: {
      queueId: string;
      circleId: string;
      shareBatchId: string;
      preparedAsset: PreparedUploadAsset;
      uploadId?: string;
      cacheUri?: string;
      previewCacheUri?: string;
      pairedVideoCacheUri?: string;
      encryptedCacheUri?: string;
      encryptedPreviewCacheUri?: string;
      encryptedPairedVideoCacheUri?: string;
      encryption?: UploadEncryptionEnvelope;
      onStage?: (stage: UploadStage) => void;
    }) => {
      const stage = (next: UploadStage) => input.onStage?.(next);

      stage('size');
      assertPreparedUploadAssetMimeTypeSupported(input.preparedAsset);

      // The exact byte sizes are declared to the server and signed into the
      // presigned PUTs, so both must be known before requesting the target.
      const sizeBytes =
        input.preparedAsset.sizeBytes ?? (await getFileSize(input.preparedAsset.uri));

      if (sizeBytes === undefined || sizeBytes <= 0) {
        throw new Error(gt('Die Dateigröße konnte nicht ermittelt werden.'));
      }

      // Generate (or on retry: reuse) the compressed preview before the
      // target request. Retries must upload the identical preview file, since
      // the server re-signs the PUT for the originally declared size.
      stage('preview');
      const previewAsset = await resolveUploadPreview({
        previewCacheUri: input.previewCacheUri,
        sourceUri: input.preparedAsset.previewUri,
        kind: input.preparedAsset.kind,
      });

      if (previewAsset.sizeBytes === undefined || previewAsset.sizeBytes <= 0) {
        throw new Error(gt('Die Vorschau konnte nicht erstellt werden.'));
      }

      const previewCacheUri = previewAsset.uri;

      // Encrypt before the target request: the declared (and signed) sizes
      // are ciphertext sizes. The ciphertext lives next to the recovery
      // files so retries re-upload it byte-identically.
      stage('encrypt');
      const encryptionTargets = await prepareUploadEncryptionTargets({
        instanceUrl,
        shareBatchId: input.shareBatchId,
        queueId: input.queueId,
      });

      if (!encryptionTargets) {
        throw new Error(gt('Für die Verschlüsselung ist kein lokaler Speicher verfügbar.'));
      }

      const encrypted = await resolveUploadEncryption({
        circleKey:
          circleKeys.status === 'ready'
            ? { epoch: circleKeys.epoch, circleKey: circleKeys.circleKey }
            : null,
        metadata: {
          fileName: input.preparedAsset.fileName,
          ...(input.preparedAsset.location ? { location: input.preparedAsset.location } : {}),
        },
        sourceUri: input.preparedAsset.uri,
        previewUri: previewAsset.uri,
        ...(input.preparedAsset.pairedVideoUri
          ? {
              pairedVideoSourceUri: input.preparedAsset.pairedVideoUri,
              encryptedPairedVideoTargetUri: encryptionTargets.encryptedPairedVideoUri,
            }
          : {}),
        encryptedTargetUri: encryptionTargets.encryptedUri,
        encryptedPreviewTargetUri: encryptionTargets.encryptedPreviewUri,
        persisted: {
          ...(input.encryptedCacheUri ? { encryptedCacheUri: input.encryptedCacheUri } : {}),
          ...(input.encryptedPreviewCacheUri
            ? { encryptedPreviewCacheUri: input.encryptedPreviewCacheUri }
            : {}),
          ...(input.encryptedPairedVideoCacheUri
            ? { encryptedPairedVideoCacheUri: input.encryptedPairedVideoCacheUri }
            : {}),
          ...(input.encryption ? { encryption: input.encryption } : {}),
        },
      });
      const hasPairedVideo =
        encrypted.encryptedPairedVideoUri !== undefined &&
        encrypted.encryptedPairedVideoSizeBytes !== undefined;

      setUploadQueue((state) =>
        patchUploadQueueItem(state, input.queueId, {
          sizeBytes: encrypted.encryptedSizeBytes,
          previewUri: previewAsset.uri,
          previewCacheUri: previewAsset.uri,
          previewSizeBytes: encrypted.encryptedPreviewSizeBytes,
          encryptedCacheUri: encrypted.encryptedUri,
          encryptedPreviewCacheUri: encrypted.encryptedPreviewUri,
          ...(hasPairedVideo
            ? {
                pairedVideoSizeBytes: encrypted.encryptedPairedVideoSizeBytes,
                encryptedPairedVideoCacheUri: encrypted.encryptedPairedVideoUri,
              }
            : {}),
          encryption: encrypted.envelope,
        }),
      );

      stage('target');
      const prepared = input.uploadId
        ? await retryUpload({ uploadId: input.uploadId })
        : await createTarget({
            circleId: input.circleId,
            shareBatchId: input.shareBatchId,
            kind: input.preparedAsset.kind,
            mimeType: input.preparedAsset.mimeType,
            // Generic name: object keys and the plaintext fileName column must
            // not leak the original name; it lives in the encrypted metadata.
            fileName: genericUploadFileName(
              input.preparedAsset.fileName,
              input.preparedAsset.kind,
            ),
            sizeBytes: encrypted.encryptedSizeBytes,
            previewSizeBytes: encrypted.encryptedPreviewSizeBytes,
            ...(hasPairedVideo
              ? {
                  pairedVideoSizeBytes: encrypted.encryptedPairedVideoSizeBytes,
                  pairedVideoMimeType:
                    input.preparedAsset.pairedVideoMimeType ?? 'video/mp4',
                }
              : {}),
          });

      setUploadQueue((state) =>
        patchUploadQueueItem(state, input.queueId, {
          uploadId: prepared.uploadId,
        }),
      );
      setUploadQueue((state) => markUploadStatus(state, input.queueId, 'uploading'));

      stage('put');
      const uploaded = await uploadPreparedFile({
        target: prepared.target,
        asset: {
          ...input.preparedAsset,
          uri: encrypted.encryptedUri,
          sizeBytes: encrypted.encryptedSizeBytes,
        },
        onProgress: (progress) => {
          setUploadQueue((state) => patchUploadProgress(state, input.queueId, progress));
        },
      });
      let previewUploaded: {
        previewObjectKey?: string;
      } = {};

      if (prepared.previewTarget) {
        stage('put_preview');
        const uploadedPreview = await uploadPreparedFile({
          target: prepared.previewTarget,
          asset: {
            ...input.preparedAsset,
            uri: encrypted.encryptedPreviewUri,
            mimeType: previewAsset.mimeType,
            sizeBytes: encrypted.encryptedPreviewSizeBytes,
            width: previewAsset.width ?? input.preparedAsset.width,
            height: previewAsset.height ?? input.preparedAsset.height,
          },
        });

        previewUploaded = {
          previewObjectKey: uploadedPreview.objectKey,
        };
      }

      let pairedVideoUploaded: {
        pairedVideoObjectKey?: string;
      } = {};

      if (prepared.pairedVideoTarget && encrypted.encryptedPairedVideoUri !== undefined) {
        stage('put_paired_video');
        const uploadedPairedVideo = await uploadPreparedFile({
          target: prepared.pairedVideoTarget,
          asset: {
            ...input.preparedAsset,
            uri: encrypted.encryptedPairedVideoUri,
            mimeType: input.preparedAsset.pairedVideoMimeType ?? 'video/mp4',
            sizeBytes: encrypted.encryptedPairedVideoSizeBytes,
          },
        });

        pairedVideoUploaded = {
          pairedVideoObjectKey: uploadedPairedVideo.objectKey,
        };
      }

      // No plaintext location: the server rejects it next to `encryption`.
      // Name and location live in the envelope's encMetadata instead.
      stage('complete');
      await completeUpload({
        uploadId: prepared.uploadId,
        objectKey: uploaded.objectKey,
        ...previewUploaded,
        ...pairedVideoUploaded,
        ...encryptedCompletionFields({
          fileName: input.preparedAsset.fileName,
          kind: input.preparedAsset.kind,
          encrypted,
          asset: {
            width: input.preparedAsset.width,
            height: input.preparedAsset.height,
            durationSeconds: input.preparedAsset.durationSeconds,
            ...(pairedVideoUploaded.pairedVideoObjectKey
              ? {
                  pairedVideoDurationSeconds:
                    input.preparedAsset.pairedVideoDurationSeconds,
                }
              : {}),
            capturedAt: input.preparedAsset.capturedAt,
          },
        }),
      });

      try {
        await uploadRecoveryStore.clearItemFiles({
          cacheUri: input.cacheUri,
          previewCacheUri,
          pairedVideoCacheUri: input.pairedVideoCacheUri,
          encryptedCacheUri: encrypted.encryptedUri,
          encryptedPreviewCacheUri: encrypted.encryptedPreviewUri,
          encryptedPairedVideoCacheUri: encrypted.encryptedPairedVideoUri,
        });
      } catch (error) {
        // The upload is already committed at this point. Some picker-provided
        // temporary files are not writable on newer iOS versions, so cleanup
        // must never turn a completed upload into a failed queue item.
        logger.warn('Upload recovery file cleanup failed after upload', {
          queueId: input.queueId,
          uploadId: prepared.uploadId,
          error,
        });
      }
    },
    [circleKeys, completeUpload, createTarget, gt, instanceUrl, retryUpload],
  );

  const handlePickMedia = useCallback(async () => {
    if (!selectedCircle) {
      onFeedback(gt('Bitte wähle zuerst einen Circle aus.'));
      return;
    }

    let result: ImagePicker.ImagePickerResult;

    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        onFeedback(gt('Ohne Mediathek-Zugriff können keine Fotos oder Videos ausgewählt werden.'));
        return;
      }

      result = await ImagePicker.launchImageLibraryAsync({
        // 'livePhotos' delivers the paired video of iOS Live Photos alongside
        // the still; Android and web ignore the entry.
        mediaTypes: ['images', 'videos', 'livePhotos'],
        allowsMultipleSelection: true,
        exif: true,
        quality: 1,
        selectionLimit: 0,
        // iOS: assets offloaded to iCloud ("Optimize iPhone Storage") must be
        // fetched before they can be read. Without this, one such Live Photo
        // or video rejects the whole selection with PHPhotosErrorDomain 3164.
        // Needs patches/expo-image-picker (upstream #48794) for Live Photos.
        shouldDownloadFromNetwork: true,
      });
    } catch (error) {
      // A picker that fails to launch (missing activity, OS-level error) must
      // surface as feedback; the caller discards the promise, so an unhandled
      // rejection would leave the button looking dead.
      // The native picker rejects for the whole selection (e.g. an iCloud
      // asset it could not download, PHPhotosErrorDomain 3164). The error
      // code and domain reach Observe; the message stays on the device.
      logger.error('Media picker failed to open', {
        circleId: selectedCircle._id,
        stage: 'picker',
        error,
      });
      recordClientDiagnostic('upload', 'Media picker failed to open', {
        circleId: selectedCircle._id,
        stage: 'picker',
        error,
      });
      onFeedback(errorMessage(error, gt('Die Mediathek konnte nicht geöffnet werden.')));
      return;
    }

    if (result.canceled || !result.assets.length) return;

    onFeedback(null);
    setIsUploading(true);
    // Which step of the batch failed; reported alongside the error so a
    // selection of many assets can be diagnosed without the file names.
    let stage: 'draft' | 'metadata' | 'items' = 'draft';

    try {
      const draft = await getOrCreateDraft({ circleId: selectedCircle._id });
      stage = 'metadata';
      const resolvedMetadata = await resolvePickerAssetMetadata(result.assets, m);
      stage = 'items';

      let successCount = 0;

      for (const [index, asset] of result.assets.entries()) {
        const assetMetadata = resolvedMetadata[index] ?? {};
        const resolvedLocation = assetMetadata.location;
        const capturedAt = assetMetadata.capturedAt;
        const fileName = fileNameFromPickerAsset(asset);
        const mimeType = mimeTypeForPickerAsset(asset);
        const kind = assetKind(asset);
        const queueId = `${draft.shareBatchId}:${asset.assetId ?? asset.uri}:${index}:${Date.now()}`;
        let cacheUri: string | null = null;

        try {
          cacheUri = await cacheUploadRecoveryFile({
            instanceUrl,
            shareBatchId: draft.shareBatchId,
            queueId,
            uri: asset.uri,
            fileName,
          });
        } catch (error) {
          logger.warn('Upload recovery file cache failed', {
            queueId,
            circleId: selectedCircle._id,
            shareBatchId: draft.shareBatchId,
            fileName,
            error,
          });
        }

        // Live Photo companion clip: cached next to the still so retries can
        // re-encrypt it after the picker's temporary file is gone.
        const pairedVideoAsset = asset.pairedVideoAsset;
        let pairedVideoCacheUri: string | null = null;

        if (pairedVideoAsset?.uri) {
          try {
            pairedVideoCacheUri = await cacheUploadRecoveryFile({
              instanceUrl,
              shareBatchId: draft.shareBatchId,
              queueId,
              uri: pairedVideoAsset.uri,
              fileName: `paired-${fileNameFromPickerAsset(pairedVideoAsset)}`,
            });
          } catch (error) {
            logger.warn('Upload recovery paired video cache failed', {
              queueId,
              circleId: selectedCircle._id,
              shareBatchId: draft.shareBatchId,
              fileName,
              error,
            });
          }
        }

        const uploadUri = cacheUri ?? asset.uri;
        const uploadAsset: ImagePicker.ImagePickerAsset = {
          ...asset,
          ...(cacheUri ? { uri: cacheUri } : {}),
          ...(pairedVideoAsset && pairedVideoCacheUri
            ? { pairedVideoAsset: { ...pairedVideoAsset, uri: pairedVideoCacheUri } }
            : {}),
        };
        const durationSeconds =
          asset.duration !== null && asset.duration !== undefined
            ? asset.duration / 1000
            : undefined;

        setUploadQueue((state) =>
          enqueue(state, {
            id: queueId,
            circleId: selectedCircle._id,
            shareBatchId: draft.shareBatchId,
            sourceAsset: asset,
            kind,
            fileName,
            mimeType,
            fileUri: uploadUri,
            previewUri: uploadUri,
            ...(cacheUri ? { cacheUri } : {}),
            ...(pairedVideoAsset?.uri
              ? { pairedVideoUri: pairedVideoCacheUri ?? pairedVideoAsset.uri }
              : {}),
            ...(pairedVideoCacheUri ? { pairedVideoCacheUri } : {}),
            ...(pairedVideoAsset?.mimeType
              ? { pairedVideoMimeType: pairedVideoAsset.mimeType }
              : {}),
            ...(pairedVideoAsset?.duration !== null && pairedVideoAsset?.duration !== undefined
              ? { pairedVideoDurationSeconds: pairedVideoAsset.duration / 1000 }
              : {}),
            recoverable: Boolean(cacheUri),
            prepared: Boolean(cacheUri),
            sizeBytes: asset.fileSize ?? undefined,
            width: asset.width,
            height: asset.height,
            durationSeconds,
            location: resolvedLocation,
            capturedAt,
            locationLabel: formatMediaLocation(resolvedLocation) ?? undefined,
            status: 'processing',
            attempts: 0,
          }),
        );

        let itemStage: UploadStage = 'prepare';

        try {
          const preparedAsset = await optimizePickerAsset(uploadAsset, resolvedLocation, capturedAt);

          assertPreparedUploadAssetMimeTypeSupported(preparedAsset);

          setUploadQueue((state) =>
            patchUploadQueueItem(state, queueId, {
              fileUri: preparedAsset.uri,
              previewUri: preparedAsset.previewUri,
              kind: preparedAsset.kind,
              fileName: preparedAsset.fileName,
              mimeType: preparedAsset.mimeType,
              sizeBytes: preparedAsset.sizeBytes,
              width: preparedAsset.width,
              height: preparedAsset.height,
              durationSeconds: preparedAsset.durationSeconds,
              pairedVideoUri: preparedAsset.pairedVideoUri,
              pairedVideoMimeType: preparedAsset.pairedVideoMimeType,
              pairedVideoDurationSeconds: preparedAsset.pairedVideoDurationSeconds,
              location: preparedAsset.location,
              capturedAt: preparedAsset.capturedAt,
              locationLabel: formatMediaLocation(preparedAsset.location) ?? undefined,
              prepared: true,
            }),
          );

          await uploadPreparedAsset({
            queueId,
            circleId: selectedCircle._id,
            shareBatchId: draft.shareBatchId,
            preparedAsset,
            ...(cacheUri ? { cacheUri } : {}),
            ...(pairedVideoCacheUri ? { pairedVideoCacheUri } : {}),
            onStage: (next) => {
              itemStage = next;
            },
          });

          successCount += 1;
          setUploadQueue((state) => removeUploadQueueItems(state, (item) => item.id === queueId));
        } catch (error) {
          const message = errorMessage(error, gt('Upload fehlgeschlagen.'));
          logger.warn('Upload item failed', {
            queueId,
            circleId: selectedCircle._id,
            shareBatchId: draft.shareBatchId,
            fileName,
            stage: itemStage,
            kind,
            index,
            count: result.assets.length,
            errorMessage: message,
            error,
          });
          recordClientDiagnostic('upload', 'Upload item failed', {
            queueId,
            circleId: selectedCircle._id,
            shareBatchId: draft.shareBatchId,
            fileName,
            stage: itemStage,
            kind,
            index,
            count: result.assets.length,
            errorMessage: message,
            error,
          });
          setUploadQueue((state) => markUploadStatus(state, queueId, 'failed', message));
        }
      }

      if (successCount > 0) {
        onFeedback(
          successCount === result.assets.length
            ? gt('Medien wurden zum Entwurf hinzugefügt.')
            : gt('{successCount} von {total} Medien wurden zum Entwurf hinzugefügt.', {
                successCount,
                total: result.assets.length,
              }),
        );
      } else {
        onFeedback(gt('Kein Asset konnte hochgeladen werden.'));
      }
    } catch (error) {
      logger.error('Media selection upload failed', {
        circleId: selectedCircle._id,
        stage,
        count: result.assets.length,
        error,
      });
      recordClientDiagnostic('upload', 'Media selection upload failed', {
        circleId: selectedCircle._id,
        stage,
        count: result.assets.length,
        error,
      });
      onFeedback(errorMessage(error, gt('Medien konnten nicht hinzugefügt werden.')));
    } finally {
      setIsUploading(false);
    }
  }, [
    getOrCreateDraft,
    gt,
    instanceUrl,
    m,
    onFeedback,
    selectedCircle,
    uploadPreparedAsset,
  ]);

  const handleRetryFailedUpload = useCallback(
    async (itemId: string) => {
      const queueItem = uploadQueue.items.find((item) => item.id === itemId);

      if (!queueItem) {
        return;
      }

      onFeedback(null);
      setIsUploading(true);
      setUploadQueue((state) => markUploadStatus(state, itemId, 'processing'));
      let stage: UploadStage = 'prepare';

      try {
        let preparedAsset: PreparedUploadAsset;

        if (queueItem.prepared || !queueItem.sourceAsset) {
          preparedAsset = uploadQueueItemToPreparedAsset(queueItem);
        } else {
          preparedAsset = await optimizePickerAsset(
            queueItem.sourceAsset,
            queueItem.location,
            queueItem.capturedAt,
          );
          assertPreparedUploadAssetMimeTypeSupported(preparedAsset);

          setUploadQueue((state) =>
            patchUploadQueueItem(state, itemId, {
              fileUri: preparedAsset.uri,
              previewUri: preparedAsset.previewUri,
              kind: preparedAsset.kind,
              fileName: preparedAsset.fileName,
              mimeType: preparedAsset.mimeType,
              sizeBytes: preparedAsset.sizeBytes,
              width: preparedAsset.width,
              height: preparedAsset.height,
              durationSeconds: preparedAsset.durationSeconds,
              pairedVideoUri: preparedAsset.pairedVideoUri,
              pairedVideoMimeType: preparedAsset.pairedVideoMimeType,
              pairedVideoDurationSeconds: preparedAsset.pairedVideoDurationSeconds,
              location: preparedAsset.location,
              capturedAt: preparedAsset.capturedAt,
              locationLabel: formatMediaLocation(preparedAsset.location) ?? undefined,
              prepared: true,
            }),
          );
        }

        await uploadPreparedAsset({
          queueId: itemId,
          circleId: queueItem.circleId,
          shareBatchId: queueItem.shareBatchId,
          preparedAsset,
          uploadId: queueItem.uploadId,
          cacheUri: queueItem.cacheUri,
          previewCacheUri: queueItem.previewCacheUri,
          pairedVideoCacheUri: queueItem.pairedVideoCacheUri,
          encryptedCacheUri: queueItem.encryptedCacheUri,
          encryptedPreviewCacheUri: queueItem.encryptedPreviewCacheUri,
          encryptedPairedVideoCacheUri: queueItem.encryptedPairedVideoCacheUri,
          encryption: queueItem.encryption,
          onStage: (next) => {
            stage = next;
          },
        });

        setUploadQueue((state) => removeUploadQueueItems(state, (item) => item.id === itemId));
        onFeedback(gt('Upload wurde abgeschlossen.'));
      } catch (error) {
        const message = errorMessage(error, gt('Upload fehlgeschlagen.'));
        logger.warn('Upload retry failed', {
          itemId,
          circleId: queueItem.circleId,
          shareBatchId: queueItem.shareBatchId,
          fileName: queueItem.fileName,
          stage,
          kind: queueItem.kind,
          attempt: queueItem.attempts,
          error,
        });
        recordClientDiagnostic('upload', 'Upload retry failed', {
          itemId,
          circleId: queueItem.circleId,
          shareBatchId: queueItem.shareBatchId,
          fileName: queueItem.fileName,
          stage,
          kind: queueItem.kind,
          attempt: queueItem.attempts,
          error,
        });
        setUploadQueue((state) => markUploadStatus(state, itemId, 'failed', message));
        onFeedback(message);
      } finally {
        setIsUploading(false);
      }
    },
    [gt, onFeedback, uploadPreparedAsset, uploadQueue.items],
  );

  const handleRemoveFailedUpload = useCallback(
    async (itemId: string) => {
      const queueItem = uploadQueue.items.find((item) => item.id === itemId);

      if (!queueItem) {
        return;
      }

      if (queueItem.uploadId) {
        try {
          const result = await discardUpload({
            uploadId: queueItem.uploadId,
          });

          if (result.outcome && result.outcome !== 'discarded') {
            logger.info('Cleared stale upload queue item', {
              itemId,
              uploadId: queueItem.uploadId,
              outcome: result.outcome,
            });
          }
        } catch (error) {
          if (!isUploadAlreadyCompletedError(error)) {
            logger.warn('Discard failed upload failed', {
              itemId,
              uploadId: queueItem.uploadId,
              error,
            });
            onFeedback(
              errorMessage(error, gt('Fehlgeschlagener Upload konnte nicht entfernt werden.')),
            );
            return;
          }

          logger.info('Dropping stale queue item for completed upload', {
            itemId,
            uploadId: queueItem.uploadId,
          });
        }
      }

      try {
        await clearUploadRecoveryItemFiles(queueItem);
      } catch (error) {
        // Queue removal must remain possible after the server confirms that the
        // upload already completed, even when iOS owns an undeletable picker
        // temporary file.
        logger.warn('Upload recovery file cleanup failed while removing queue item', {
          itemId,
          uploadId: queueItem.uploadId,
          error,
        });
      }
      setUploadQueue((state) => removeUploadQueueItems(state, (item) => item.id === itemId));
    },
    [discardUpload, gt, onFeedback, uploadQueue.items],
  );

  const handleDiscardUpload = useCallback(
    async (uploadId: string) => {
      const matchingItems = uploadQueue.items.filter((item) => item.uploadId === uploadId);

      try {
        await discardUpload({
          uploadId,
        });
      } catch (error) {
        if (!isUploadAlreadyCompletedError(error)) {
          throw error;
        }

        logger.info('Dropping stale queue item for completed upload', { uploadId });
      }

      const cleanupResults = await Promise.allSettled(
        matchingItems.map((item) => clearUploadRecoveryItemFiles(item)),
      );

      for (const [index, result] of cleanupResults.entries()) {
        if (result.status !== 'rejected') {
          continue;
        }

        logger.warn('Upload recovery file cleanup failed while discarding upload', {
          uploadId,
          itemId: matchingItems[index]?.id,
          error: result.reason,
        });
      }
      setUploadQueue((state) =>
        removeUploadQueueItems(state, (item) => item.uploadId === uploadId),
      );
    },
    [discardUpload, uploadQueue.items],
  );

  const removeItemsForShareBatch = useCallback((shareBatchId: string) => {
    void uploadRecoveryStore
      .clearShareBatch({
        instanceUrl,
        shareBatchId,
      })
      .catch((error) => {
        logger.warn('Upload recovery share cleanup failed', {
          instanceUrl,
          shareBatchId,
          error,
        });
      });
    setUploadQueue((state) =>
      removeUploadQueueItems(state, (item) => item.shareBatchId === shareBatchId),
    );
  }, [instanceUrl]);

  return {
    uploadQueue,
    selectedQueueItems,
    hasUnresolvedUploads,
    isUploading,
    handlePickMedia,
    handleRetryFailedUpload,
    handleRemoveFailedUpload,
    handleDiscardUpload,
    removeItemsForShareBatch,
  };
}
