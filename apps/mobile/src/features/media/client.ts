import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Location from 'expo-location';
import * as MediaLibrary from 'expo-media-library/legacy';
import * as Sharing from 'expo-sharing';
import { msg } from 'gt-react-native';
import { Alert } from 'react-native';
import {
  Image as CompressorImage,
  createVideoThumbnail,
  getRealPath,
} from 'react-native-compressor';

import type { AssetKind, MediaLocation, UploadTarget } from '@beisammen/contracts';

import type { AssetEncryptionEnvelope } from '@/features/crypto/asset-metadata';

const LOCATION_COORDINATE_PRECISION = 4;
const DOWNLOAD_DIRECTORY = `${FileSystem.cacheDirectory ?? ''}share-downloads/`;

type RawLocation = Pick<MediaLocation, 'latitude' | 'longitude' | 'accuracyMeters' | 'source'>;
type GeocodedLocationFields = Pick<MediaLocation, 'label' | 'city' | 'region' | 'country'>;

export interface PickerAssetMetadata {
  location?: MediaLocation;
  capturedAt?: number;
}

export interface PreparedUploadAsset {
  uri: string;
  previewUri: string;
  fileName: string;
  mimeType: string;
  kind: AssetKind;
  sizeBytes?: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
  location?: MediaLocation;
  capturedAt?: number;
  /** Live Photo companion clip (image assets only). */
  pairedVideoUri?: string;
  pairedVideoMimeType?: string;
  pairedVideoSizeBytes?: number;
  pairedVideoDurationSeconds?: number;
}

export interface PreparedPreviewAsset {
  uri: string;
  mimeType: 'image/jpeg';
  sizeBytes?: number;
  width?: number;
  height?: number;
}

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]+/g, '-');
}

function normalizeFileUri(uri: string): string {
  if (uri.startsWith('file:')) {
    // Native helpers (e.g. react-native-compressor on Android) return
    // `file:/path` with a single slash; expo-file-system and our own
    // `file://` checks expect the canonical triple slash.
    return uri.replace(/^file:\/*/, 'file:///');
  }

  if (uri.startsWith('content://') || uri.startsWith('http')) {
    return uri;
  }

  if (uri.startsWith('/')) {
    return `file://${uri}`;
  }

  return uri;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const next = Number(value);

    if (Number.isFinite(next)) {
      return next;
    }
  }

  if (isRecord(value)) {
    const numerator = toNumber(value.numerator);
    const denominator = toNumber(value.denominator);

    if (numerator !== undefined && denominator && Number.isFinite(denominator)) {
      return numerator / denominator;
    }
  }

  return undefined;
}

function normalizeCapturedTimestamp(value: number): number | undefined {
  if (!Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  return value < 1_000_000_000_000 ? value * 1000 : value;
}

function parseExifDateString(value: string): number | undefined {
  const trimmed = value.trim();

  if (!trimmed) {
    return undefined;
  }

  const exifMatch = trimmed.match(
    /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(.*)$/,
  );
  const normalized = exifMatch
    ? `${exifMatch[1]}-${exifMatch[2]}-${exifMatch[3]}T${exifMatch[4]}:${exifMatch[5]}:${exifMatch[6]}${exifMatch[7] ?? ''}`
    : trimmed;
  const parsed = Date.parse(normalized);

  return Number.isFinite(parsed) ? parsed : undefined;
}

export function readCapturedAtFromExif(exif: unknown): number | undefined {
  if (!isRecord(exif)) {
    return undefined;
  }

  const candidates = [
    exif.DateTimeOriginal,
    exif.DateTimeDigitized,
    exif.CreateDate,
    exif.DateTime,
    exif.ModifyDate,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'number') {
      const timestamp = normalizeCapturedTimestamp(candidate);

      if (timestamp !== undefined) {
        return timestamp;
      }
    }

    if (typeof candidate === 'string') {
      const timestamp = parseExifDateString(candidate);

      if (timestamp !== undefined) {
        return timestamp;
      }
    }
  }

  return undefined;
}

function readCoordinatePart(value: unknown): number | undefined {
  if (Array.isArray(value) && value.length > 0) {
    const parts = value
      .map((entry) => toNumber(entry))
      .filter((entry): entry is number => entry !== undefined);

    if (parts.length === 0) {
      return undefined;
    }

    if (parts.length === 1) {
      return parts[0];
    }

    if (parts.length === 2) {
      return parts[0] + parts[1] / 60;
    }

    return parts[0] + parts[1] / 60 + parts[2] / 3600;
  }

  return toNumber(value);
}

function applyCoordinateRef(
  value: number | undefined,
  ref: unknown,
  negativeRef: string,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof ref === 'string' && ref.toUpperCase() === negativeRef) {
    return value > 0 ? -value : value;
  }

  return value;
}

function coordinateKey(latitude: number, longitude: number): string {
  return `${latitude.toFixed(LOCATION_COORDINATE_PRECISION)}:${longitude.toFixed(LOCATION_COORDINATE_PRECISION)}`;
}

function buildLocationLabel(fields: GeocodedLocationFields): string | undefined {
  const combos = [
    [fields.city, fields.region],
    [fields.city, fields.country],
    [fields.region, fields.country],
    [fields.country],
  ];

  for (const parts of combos) {
    const label = parts.filter(Boolean).join(', ').trim();

    if (label) {
      return label;
    }
  }

  return undefined;
}

const LOCATION_FALLBACK_COPY = {
  title: msg('Ort ergänzen?'),
  message: msg(
    'Einige Medien enthalten keine GPS-Daten. Möchtest du einmalig deinen aktuellen Standort nutzen, um diese Medien mit einem Ort zu ergänzen?',
  ),
  decline: msg('Nicht jetzt'),
  confirm: msg('Ort ergänzen'),
};

// Translates a msg()-registered string; components pass the useMessages()
// function so alerts raised outside the React tree are still localized.
export type TranslateMessage = (message: string) => string;

const identityTranslate: TranslateMessage = (message) => message;

async function confirmDeviceLocationFallback(translate: TranslateMessage): Promise<boolean> {
  return await new Promise((resolve) => {
    let didResolve = false;

    const finish = (value: boolean) => {
      if (!didResolve) {
        didResolve = true;
        resolve(value);
      }
    };

    Alert.alert(
      translate(LOCATION_FALLBACK_COPY.title),
      translate(LOCATION_FALLBACK_COPY.message),
      [
        {
          text: translate(LOCATION_FALLBACK_COPY.decline),
          style: 'cancel',
          onPress: () => finish(false),
        },
        {
          text: translate(LOCATION_FALLBACK_COPY.confirm),
          onPress: () => finish(true),
        },
      ],
      {
        cancelable: true,
        onDismiss: () => finish(false),
      },
    );
  });
}

async function reverseGeocodeLocation(
  location: RawLocation,
  cache: Map<string, GeocodedLocationFields | null>,
): Promise<MediaLocation> {
  const key = coordinateKey(location.latitude, location.longitude);

  if (!cache.has(key)) {
    try {
      const [result] = await Location.reverseGeocodeAsync({
        latitude: location.latitude,
        longitude: location.longitude,
      });

      if (!result) {
        cache.set(key, null);
      } else {
        const fields: GeocodedLocationFields = {
          city: result.city ?? undefined,
          region: result.region ?? result.subregion ?? undefined,
          country: result.country ?? undefined,
        };

        fields.label = buildLocationLabel(fields);
        cache.set(key, fields);
      }
    } catch {
      cache.set(key, null);
    }
  }

  const cached = cache.get(key) ?? null;

  return {
    ...location,
    ...(cached ?? {}),
  };
}

async function readMediaLibraryMetadata(assetId: string): Promise<{
  location?: RawLocation;
  capturedAt?: number;
}> {
  try {
    const info = await MediaLibrary.getAssetInfoAsync(assetId, {
      shouldDownloadFromNetwork: false,
    });
    const latitude = toNumber(info.location?.latitude);
    const longitude = toNumber(info.location?.longitude);
    const capturedAt = normalizeCapturedTimestamp(info.creationTime);
    const metadata: {
      location?: RawLocation;
      capturedAt?: number;
    } = {};

    if (latitude !== undefined && longitude !== undefined) {
      metadata.location = {
        latitude,
        longitude,
        source: 'embedded',
      };
    }

    if (capturedAt !== undefined) {
      metadata.capturedAt = capturedAt;
    }

    return metadata;
  } catch {
    return {};
  }
}

function readImagePickerExifLocation(
  exif: ImagePicker.ImagePickerAsset['exif'],
): RawLocation | undefined {
  if (!isRecord(exif)) {
    return undefined;
  }

  const latitude = applyCoordinateRef(
    readCoordinatePart(exif.GPSLatitude),
    exif.GPSLatitudeRef,
    'S',
  );
  const longitude = applyCoordinateRef(
    readCoordinatePart(exif.GPSLongitude),
    exif.GPSLongitudeRef,
    'W',
  );

  if (latitude === undefined || longitude === undefined) {
    return undefined;
  }

  return {
    latitude,
    longitude,
    source: 'embedded',
  };
}

async function readEmbeddedLocation(
  asset: ImagePicker.ImagePickerAsset,
): Promise<RawLocation | undefined> {
  if (asset.assetId) {
    const mediaLibraryLocation = (await readMediaLibraryMetadata(asset.assetId)).location;

    if (mediaLibraryLocation) {
      return mediaLibraryLocation;
    }
  }

  if (asset.type === 'image') {
    return readImagePickerExifLocation(asset.exif);
  }

  return undefined;
}

async function readEmbeddedMetadata(
  asset: ImagePicker.ImagePickerAsset,
): Promise<{
  location?: RawLocation;
  capturedAt?: number;
}> {
  const mediaLibraryMetadata = asset.assetId
    ? await readMediaLibraryMetadata(asset.assetId)
    : {};
  const exifLocation =
    !mediaLibraryMetadata.location && asset.type === 'image'
      ? readImagePickerExifLocation(asset.exif)
      : undefined;
  const exifCapturedAt =
    mediaLibraryMetadata.capturedAt === undefined && asset.type === 'image'
      ? readCapturedAtFromExif(asset.exif)
      : undefined;

  return {
    ...(mediaLibraryMetadata.location
      ? { location: mediaLibraryMetadata.location }
      : exifLocation
        ? { location: exifLocation }
        : {}),
    ...(mediaLibraryMetadata.capturedAt !== undefined
      ? { capturedAt: mediaLibraryMetadata.capturedAt }
      : exifCapturedAt !== undefined
        ? { capturedAt: exifCapturedAt }
        : {}),
  };
}

async function readDeviceFallbackLocation(
  cache: Map<string, GeocodedLocationFields | null>,
  translate: TranslateMessage,
): Promise<MediaLocation | undefined> {
  const shouldUseFallback = await confirmDeviceLocationFallback(translate);

  if (!shouldUseFallback) {
    return undefined;
  }

  const permission = await Location.requestForegroundPermissionsAsync();

  if (!permission.granted) {
    return undefined;
  }

  const lastKnown = await Location.getLastKnownPositionAsync({
    maxAge: 5 * 60 * 1000,
    requiredAccuracy: 500,
  }).catch(() => null);
  const current =
    lastKnown ??
    (await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    }).catch(() => null));

  if (!current) {
    return undefined;
  }

  return await reverseGeocodeLocation(
    {
      latitude: current.coords.latitude,
      longitude: current.coords.longitude,
      accuracyMeters: current.coords.accuracy ?? undefined,
      source: 'device-fallback',
    },
    cache,
  );
}

export async function resolvePickerAssetLocations(
  assets: ImagePicker.ImagePickerAsset[],
  translate: TranslateMessage = identityTranslate,
): Promise<Array<MediaLocation | undefined>> {
  const metadata = await resolvePickerAssetMetadata(assets, translate);

  return metadata.map((item) => item.location);
}

export async function resolvePickerAssetMetadata(
  assets: ImagePicker.ImagePickerAsset[],
  translate: TranslateMessage = identityTranslate,
): Promise<PickerAssetMetadata[]> {
  const geocodeCache = new Map<string, GeocodedLocationFields | null>();
  const embeddedMetadata = await Promise.all(assets.map((asset) => readEmbeddedMetadata(asset)));
  const resolvedLocations = await Promise.all(
    embeddedMetadata.map(async (metadata) =>
      metadata.location ? await reverseGeocodeLocation(metadata.location, geocodeCache) : undefined,
    ),
  );
  const buildMetadata = (location: MediaLocation | undefined, index: number): PickerAssetMetadata => ({
    ...(location ? { location } : {}),
    ...(embeddedMetadata[index]?.capturedAt !== undefined
      ? { capturedAt: embeddedMetadata[index]!.capturedAt }
      : {}),
  });
  const needsFallback = resolvedLocations.some((location) => !location);

  if (!needsFallback) {
    return resolvedLocations.map(buildMetadata);
  }

  const fallbackLocation = await readDeviceFallbackLocation(geocodeCache, translate);

  if (!fallbackLocation) {
    return resolvedLocations.map(buildMetadata);
  }

  return resolvedLocations.map((location, index) =>
    buildMetadata(location ?? fallbackLocation, index),
  );
}

export function formatMediaLocation(location?: MediaLocation): string | null {
  if (!location) {
    return null;
  }

  if (location.label?.trim()) {
    return location.label.trim();
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

export function fileNameFromPickerAsset(asset: ImagePicker.ImagePickerAsset): string {
  if (asset.fileName?.trim()) {
    return sanitizeFileName(asset.fileName.trim());
  }

  const fallback = asset.type === 'video' ? 'video.mp4' : 'image.jpg';
  const tail = asset.uri.split('/').pop();
  return sanitizeFileName(tail && tail.length > 0 ? tail : fallback);
}

export function mimeTypeForPickerAsset(asset: ImagePicker.ImagePickerAsset): string {
  if (asset.mimeType?.trim()) {
    return asset.mimeType.trim();
  }

  return asset.type === 'video' ? 'video/mp4' : 'image/jpeg';
}

export function assetKind(asset: ImagePicker.ImagePickerAsset): AssetKind {
  return asset.type === 'video' ? 'video' : 'image';
}

export async function getFileSize(uri: string): Promise<number | undefined> {
  const info = await FileSystem.getInfoAsync(normalizeFileUri(uri));

  if (!info.exists) {
    return undefined;
  }

  return info.size;
}

async function resolvePickerUploadUri(asset: ImagePicker.ImagePickerAsset): Promise<string> {
  const normalizedUri = normalizeFileUri(asset.uri);

  if (normalizedUri.startsWith('file://') || !asset.assetId) {
    return normalizedUri;
  }

  try {
    const info = await MediaLibrary.getAssetInfoAsync(asset.assetId, {
      shouldDownloadFromNetwork: true,
    });
    const localUri = typeof info.localUri === 'string' ? info.localUri.trim() : '';

    if (localUri) {
      return normalizeFileUri(localUri);
    }
  } catch {
    // The upload preflight will surface a clearer error when no local file can be resolved.
  }

  return normalizedUri;
}

/**
 * Live Photo companion clip metadata from the picker asset. Only present when
 * the picker ran with the 'livePhotos' media type (iOS); Android and plain
 * photos return no paired asset.
 */
async function resolvePairedVideo(
  asset: ImagePicker.ImagePickerAsset,
): Promise<Pick<
  PreparedUploadAsset,
  | 'pairedVideoUri'
  | 'pairedVideoMimeType'
  | 'pairedVideoSizeBytes'
  | 'pairedVideoDurationSeconds'
> | null> {
  const paired = asset.pairedVideoAsset;

  if (!paired?.uri) {
    return null;
  }

  const uri = normalizeFileUri(paired.uri);
  const sizeBytes = paired.fileSize ?? (await getFileSize(uri));

  if (sizeBytes === undefined || sizeBytes <= 0) {
    return null;
  }

  return {
    pairedVideoUri: uri,
    pairedVideoMimeType:
      paired.mimeType?.trim() ||
      (/\.mov$/i.test(uri) ? 'video/quicktime' : 'video/mp4'),
    pairedVideoSizeBytes: sizeBytes,
    ...(paired.duration !== null && paired.duration !== undefined
      ? { pairedVideoDurationSeconds: paired.duration / 1000 }
      : {}),
  };
}

async function processImageAsset(
  asset: ImagePicker.ImagePickerAsset,
  location?: MediaLocation,
  capturedAt?: number,
): Promise<PreparedUploadAsset> {
  const uri = await resolvePickerUploadUri(asset);
  const pairedVideo = await resolvePairedVideo(asset);

  return {
    uri,
    previewUri: uri,
    fileName: fileNameFromPickerAsset(asset),
    mimeType: mimeTypeForPickerAsset(asset),
    kind: 'image',
    sizeBytes: asset.fileSize ?? (await getFileSize(uri)),
    width: asset.width,
    height: asset.height,
    location,
    capturedAt,
    ...(pairedVideo ?? {}),
  };
}

async function processVideoAsset(
  asset: ImagePicker.ImagePickerAsset,
  location?: MediaLocation,
  capturedAt?: number,
): Promise<PreparedUploadAsset> {
  const uri = await resolvePickerUploadUri(asset);
  const originalDurationSeconds =
    asset.duration !== null && asset.duration !== undefined ? asset.duration / 1000 : undefined;

  return {
    uri,
    previewUri: uri,
    fileName: fileNameFromPickerAsset(asset),
    mimeType: mimeTypeForPickerAsset(asset),
    kind: 'video',
    sizeBytes: asset.fileSize ?? (await getFileSize(uri)),
    width: asset.width,
    height: asset.height,
    durationSeconds: originalDurationSeconds,
    location,
    capturedAt,
  };
}

export async function optimizePickerAsset(
  asset: ImagePicker.ImagePickerAsset,
  location?: MediaLocation,
  capturedAt?: number,
): Promise<PreparedUploadAsset> {
  if (assetKind(asset) === 'image') {
    return await processImageAsset(asset, location, capturedAt);
  }

  return await processVideoAsset(asset, location, capturedAt);
}

const AVATAR_MAX_DIMENSION = 1024;
const AVATAR_JPEG_QUALITY = 0.8;

/**
 * Prepares a picked image as an avatar upload (profile or circle image):
 * always recompressed to a bounded JPEG so originals never leave the device.
 */
export async function optimizeAvatarImageAsset(
  asset: ImagePicker.ImagePickerAsset,
): Promise<PreparedUploadAsset> {
  if (assetKind(asset) !== 'image') {
    throw new Error('Nur Bilder können als Profilbild verwendet werden.');
  }

  const sourceUri = await resolvePickerUploadUri(asset);
  const compressedUri = normalizeFileUri(
    await CompressorImage.compress(sourceUri, {
      maxWidth: AVATAR_MAX_DIMENSION,
      maxHeight: AVATAR_MAX_DIMENSION,
      quality: AVATAR_JPEG_QUALITY,
    }),
  );

  const scale =
    asset.width > 0 && asset.height > 0
      ? Math.min(1, AVATAR_MAX_DIMENSION / Math.max(asset.width, asset.height))
      : 1;

  return {
    uri: compressedUri,
    previewUri: compressedUri,
    fileName: `${sanitizeFileName(fileNameFromPickerAsset(asset)).replace(/\.[^.]+$/, '')}.jpg`,
    mimeType: 'image/jpeg',
    kind: 'image',
    sizeBytes: await getFileSize(compressedUri),
    width: asset.width > 0 ? Math.round(asset.width * scale) : undefined,
    height: asset.height > 0 ? Math.round(asset.height * scale) : undefined,
  };
}

export async function uploadPreparedFile(input: {
  target: UploadTarget;
  asset: PreparedUploadAsset;
  onProgress?: (progress: {
    bytesSent: number;
    totalBytesExpectedToSend?: number;
  }) => void;
}): Promise<{ objectKey: string }> {
  const uploadUri = normalizeFileUri(input.asset.uri);

  if (!uploadUri.startsWith('file://')) {
    throw new Error('Upload-Datei ist keine lokale Datei.');
  }

  const info = await FileSystem.getInfoAsync(uploadUri);

  if (!info.exists || info.isDirectory) {
    throw new Error('Upload-Datei ist nicht mehr lokal verfügbar.');
  }

  const uploadTask = FileSystem.createUploadTask(input.target.uploadUrl, uploadUri, {
    httpMethod: 'PUT',
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: { ...(input.target.headers ?? {}), 'content-type': input.asset.mimeType },
  }, (progress) => {
    input.onProgress?.({
      bytesSent: progress.totalBytesSent,
      totalBytesExpectedToSend: progress.totalBytesExpectedToSend,
    });
  });
  const uploadResponse = await uploadTask.uploadAsync();

  if (!uploadResponse || uploadResponse.status < 200 || uploadResponse.status >= 300) {
    throw new Error(`S3 upload failed with status ${uploadResponse?.status ?? 'unknown'}.`);
  }

  return { objectKey: input.target.objectKey };
}

/**
 * Structural subset of an asset record the download helpers need; satisfied
 * by `ShareAssetRecord` and buildable from `MemoryItemRecord`.
 */
export interface DownloadableAssetInfo {
  _id: string;
  kind: AssetKind;
  mimeType: string;
  fileName?: string;
  encryption?: AssetEncryptionEnvelope | null;
}

function fallbackExtensionForAsset(asset: Pick<DownloadableAssetInfo, 'kind' | 'mimeType'>): string {
  if (asset.kind === 'video') {
    return 'mp4';
  }

  if (asset.mimeType.includes('png')) {
    return 'png';
  }

  return 'jpg';
}

function downloadTargetUri(baseName: string): string {
  return `${DOWNLOAD_DIRECTORY}${Date.now()}-${baseName}`;
}

/**
 * Deletes all save/share download files. They are plaintext (decrypted)
 * media, so they must not outlive the session; called on sign-out and
 * account switch.
 */
export async function clearShareDownloads(): Promise<void> {
  if (!DOWNLOAD_DIRECTORY) {
    return;
  }

  await FileSystem.deleteAsync(DOWNLOAD_DIRECTORY, { idempotent: true }).catch(() => undefined);
}

/**
 * Materializes an asset as a plaintext local file for save/share. Encrypted
 * assets are decrypted on the way (the signed URL points at BSE1 ciphertext)
 * and named after the original file name sealed into their metadata; the
 * caller must supply the circle keys for them.
 */
export async function downloadAssetToCache(input: {
  asset: DownloadableAssetInfo;
  url: string;
  keysByEpoch?: Map<number, Uint8Array>;
}): Promise<string> {
  if (!DOWNLOAD_DIRECTORY) {
    throw new Error('Cache directory unavailable.');
  }

  await FileSystem.makeDirectoryAsync(DOWNLOAD_DIRECTORY, {
    intermediates: true,
  });

  const envelope = input.asset.encryption;

  if (!envelope) {
    const baseName = input.asset.fileName?.trim()
      ? sanitizeFileName(input.asset.fileName.trim())
      : `${input.asset._id}.${fallbackExtensionForAsset(input.asset)}`;
    const result = await FileSystem.downloadAsync(input.url, downloadTargetUri(baseName));

    return result.uri;
  }

  if (!input.keysByEpoch) {
    throw new Error('Schlüssel für dieses Medium sind noch nicht verfügbar.');
  }

  // Lazy imports keep libsodium out of the module graph for plaintext-only
  // flows (and out of tests that only exercise the upload path).
  const [{ getSodium }, { decryptFileToFile }, { openAssetMetadata, unwrapAssetFileKey }] =
    await Promise.all([
      import('@/features/crypto/sodium'),
      import('@/features/crypto/file-crypto'),
      import('@/features/crypto/asset-metadata'),
    ]);
  const sodium = await getSodium();
  const fileKey = unwrapAssetFileKey({
    sodium,
    envelope,
    keysByEpoch: input.keysByEpoch,
  });
  let fileName = input.asset.fileName;

  if (envelope.encMetadata) {
    try {
      fileName = openAssetMetadata({
        sodium,
        fileKey,
        encMetadata: envelope.encMetadata,
      }).fileName ?? fileName;
    } catch {
      // Corrupt metadata must not block the media download itself.
    }
  }

  const baseName = fileName?.trim()
    ? sanitizeFileName(fileName.trim())
    : `${input.asset._id}.${fallbackExtensionForAsset(input.asset)}`;
  const targetUri = downloadTargetUri(baseName);

  if (input.url.startsWith('file://')) {
    // Already-decrypted plaintext from the display cache; just give it its
    // proper download name instead of downloading and decrypting again.
    await FileSystem.copyAsync({ from: input.url, to: targetUri });

    return targetUri;
  }

  const ciphertextUri = `${DOWNLOAD_DIRECTORY}${Date.now()}-${input.asset._id}.enc`;

  try {
    await FileSystem.downloadAsync(input.url, ciphertextUri);
    await decryptFileToFile({
      sodium,
      fileKey,
      sourceUri: ciphertextUri,
      targetUri,
    });
  } finally {
    await FileSystem.deleteAsync(ciphertextUri, { idempotent: true }).catch(() => undefined);
  }

  return targetUri;
}

export async function saveAssetToDeviceLibrary(localUri: string): Promise<void> {
  const permission = await MediaLibrary.requestPermissionsAsync(true);

  if (!permission.granted) {
    throw new Error('Speicherzugriff für die Mediathek wurde nicht erlaubt.');
  }

  await MediaLibrary.saveToLibraryAsync(localUri);
}

export async function shareLocalFile(localUri: string): Promise<void> {
  const isAvailable = await Sharing.isAvailableAsync();

  if (!isAvailable) {
    throw new Error('Teilen ist auf diesem Gerät nicht verfügbar.');
  }

  await Sharing.shareAsync(localUri);
}

export function formatBytes(sizeBytes?: number): string | null {
  if (!sizeBytes || sizeBytes <= 0) {
    return null;
  }

  if (sizeBytes < 1024 * 1024) {
    return `${Math.round(sizeBytes / 1024)} KB`;
  }

  const gigabyte = 1024 ** 3;

  if (sizeBytes < gigabyte) {
    return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  const inGigabytes = sizeBytes / gigabyte;

  return `${inGigabytes >= 10 ? Math.round(inGigabytes) : inGigabytes.toFixed(1)} GB`;
}

/**
 * Resolves the preview asset BEFORE the upload target is requested: the exact
 * preview byte size is declared to the server and signed into the presigned
 * preview PUT. Retries must reuse the cached preview file from the first
 * attempt, because recompressing could produce a different byte size than the
 * one the server signed.
 */
export async function resolveUploadPreview(input: {
  previewCacheUri?: string;
  sourceUri: string;
  kind: AssetKind;
}): Promise<PreparedPreviewAsset> {
  if (input.previewCacheUri) {
    const uri = normalizeFileUri(input.previewCacheUri);
    const sizeBytes = await getFileSize(uri);

    if (sizeBytes !== undefined) {
      return {
        uri,
        mimeType: 'image/jpeg',
        sizeBytes,
      };
    }
  }

  return await createCompressedPreview({
    uri: input.sourceUri,
    kind: input.kind,
  });
}

export async function createCompressedPreview(input: {
  uri: string;
  kind: AssetKind;
}): Promise<PreparedPreviewAsset> {
  if (input.kind === 'image') {
    const uri = await CompressorImage.compress(input.uri, {
      maxHeight: 600,
      maxWidth: 600,
      quality: 0.7,
    });

    return {
      uri: normalizeFileUri(uri),
      mimeType: 'image/jpeg',
      sizeBytes: await getFileSize(normalizeFileUri(uri)),
    };
  }

  const realPath = await getRealPath(input.uri, 'video').catch(() => input.uri);
  const thumbnail = await createVideoThumbnail(realPath);

  return {
    uri: normalizeFileUri(thumbnail.path),
    mimeType: 'image/jpeg',
    sizeBytes: thumbnail.size,
    width: thumbnail.width,
    height: thumbnail.height,
  };
}
