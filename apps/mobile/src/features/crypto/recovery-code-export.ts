import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

// The file name is what users later search for in the Files app, so it must
// stay recognizable and stable across exports.
const RECOVERY_FILE_NAME = 'Beisammen-Wiederherstellungscode.txt';

function recoveryCodeFile(): File {
  return new File(Paths.cache, RECOVERY_FILE_NAME);
}

/**
 * Removes a previously exported recovery-code file from the cache directory.
 * Called before a new export and on sign-out so the plaintext code does not
 * linger longer than necessary.
 */
export function clearExportedRecoveryCodeFile(): void {
  const file = recoveryCodeFile();

  if (file.exists) {
    file.delete();
  }
}

/**
 * Writes the recovery code to a cache file and opens the system share sheet.
 *
 * The file is intentionally NOT deleted right after `shareAsync` resolves: on
 * Android the promise settles as soon as the chooser hands off to the target
 * app, while apps like Samsung Notes read the content URI lazily afterwards.
 * Deleting immediately made them report a "damaged or invalid" file. The file
 * is cleaned up on the next export and on sign-out instead.
 */
export async function exportRecoveryCodeFile(code: string, body: string): Promise<void> {
  const isAvailable = await Sharing.isAvailableAsync();

  if (!isAvailable) {
    throw new Error('Sharing unavailable');
  }

  clearExportedRecoveryCodeFile();

  const file = recoveryCodeFile();
  file.create();
  file.write(`${body}\n\n${code}\n`);

  await Sharing.shareAsync(file.uri, {
    mimeType: 'text/plain',
    UTI: 'public.plain-text',
  });
}
