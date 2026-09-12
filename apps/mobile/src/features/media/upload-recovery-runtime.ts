import * as FileSystem from 'expo-file-system/legacy';

import type { UploadQueueItem } from '@beisammen/upload-client';

import {
  createUploadRecoveryStore,
  uploadRecoveryInstanceKey,
  type UploadRecoveryFileDriver,
} from './upload-recovery';

const RECOVERY_ROOT = `${FileSystem.documentDirectory ?? FileSystem.cacheDirectory ?? ''}upload-recovery/`;

function recoveryRootAvailable(): boolean {
  return RECOVERY_ROOT.length > 'upload-recovery/'.length;
}

function resolvePath(path: string): string {
  if (path.startsWith('file://') || path.startsWith('content://')) {
    return path;
  }

  return `${RECOVERY_ROOT}${path.replace(/^upload-recovery\/?/, '')}`;
}

function parentDirectory(path: string): string {
  return path.slice(0, path.lastIndexOf('/') + 1);
}

function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-');
}

const fileDriver: UploadRecoveryFileDriver = {
  async readText(path) {
    if (!recoveryRootAvailable()) {
      return null;
    }

    const resolved = resolvePath(path);
    const info = await FileSystem.getInfoAsync(resolved);

    if (!info.exists) {
      return null;
    }

    return await FileSystem.readAsStringAsync(resolved);
  },

  async writeText(path, value) {
    if (!recoveryRootAvailable()) {
      return;
    }

    const resolved = resolvePath(path);
    await FileSystem.makeDirectoryAsync(parentDirectory(resolved), {
      intermediates: true,
    });
    await FileSystem.writeAsStringAsync(resolved, value);
  },

  async delete(path) {
    if (!recoveryRootAvailable()) {
      return;
    }

    await FileSystem.deleteAsync(resolvePath(path), {
      idempotent: true,
    });
  },

  async list(path) {
    if (!recoveryRootAvailable()) {
      return [];
    }

    const resolved = resolvePath(path);
    const info = await FileSystem.getInfoAsync(resolved);

    if (!info.exists) {
      return [];
    }

    const entries = await FileSystem.readDirectoryAsync(resolved);
    return entries.map((entry) => `${path}/${entry}`);
  },
};

export const uploadRecoveryStore = createUploadRecoveryStore(fileDriver);

export async function cacheUploadRecoveryFile(input: {
  instanceUrl: string;
  shareBatchId: string;
  queueId: string;
  uri: string;
  fileName: string;
}): Promise<string | null> {
  if (!recoveryRootAvailable()) {
    return null;
  }

  const directory = `${RECOVERY_ROOT}${uploadRecoveryInstanceKey(input.instanceUrl)}/${input.shareBatchId}/files/`;
  const targetUri = `${directory}${safeFileName(input.queueId)}-${safeFileName(input.fileName)}`;

  await FileSystem.makeDirectoryAsync(directory, {
    intermediates: true,
  });
  await FileSystem.copyAsync({
    from: input.uri,
    to: targetUri,
  });

  return targetUri;
}

/**
 * Ciphertext target URIs next to the recovery source files: retries must
 * re-upload the byte-identical ciphertext, so it has to survive app restarts
 * just like the plaintext cache files. Only sealed (server-safe) material is
 * ever written there — never raw file or circle keys.
 */
export async function prepareUploadEncryptionTargets(input: {
  instanceUrl: string;
  shareBatchId: string;
  queueId: string;
}): Promise<{
  encryptedUri: string;
  encryptedPreviewUri: string;
  encryptedPairedVideoUri: string;
} | null> {
  if (!recoveryRootAvailable()) {
    return null;
  }

  const directory = `${RECOVERY_ROOT}${uploadRecoveryInstanceKey(input.instanceUrl)}/${input.shareBatchId}/files/`;

  await FileSystem.makeDirectoryAsync(directory, {
    intermediates: true,
  });

  return {
    encryptedUri: `${directory}${safeFileName(input.queueId)}-encrypted.bin`,
    encryptedPreviewUri: `${directory}${safeFileName(input.queueId)}-encrypted-preview.bin`,
    encryptedPairedVideoUri: `${directory}${safeFileName(input.queueId)}-encrypted-paired.bin`,
  };
}

export async function clearUploadRecoveryForInstance(instanceUrl: string): Promise<void> {
  await uploadRecoveryStore.clearInstance({ instanceUrl });
}

export async function clearUploadRecoveryItemFiles(item: UploadQueueItem): Promise<void> {
  await uploadRecoveryStore.clearItemFiles(item);
}
