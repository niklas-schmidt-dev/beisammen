import { type ErrorContext, type ErrorOperation, reportAppError, sanitizeContext } from './errors';

// Exact matches only. Logger context and message strings are never forwarded.
// Expected authentication/validation failures and ordinary warnings stay local.
const OPERATIONS = new Map<string, ErrorOperation>([
  ['media.shareUpload:Media picker failed to open', 'media.picker'],
  ['media.shareUpload:Upload item failed', 'media.upload'],
  ['media.shareUpload:Media selection upload failed', 'media.upload'],
  ['media.shareUpload:Upload retry failed', 'media.upload_retry'],
  ['media.shareUpload:Upload recovery hydration failed', 'media.recovery_read'],
  ['media.shareUpload:Upload recovery persistence failed', 'media.recovery_write'],
  ['media.shareUpload:Upload recovery file cache failed', 'media.recovery_write'],
  ['media.shareUpload:Upload recovery paired video cache failed', 'media.recovery_write'],
  ['media.shareUpload:Upload recovery metadata cleanup failed', 'media.recovery_cleanup'],
  ['media.shareUpload:Upload recovery share cleanup failed', 'media.recovery_cleanup'],
  ['media.assetUri:Asset media URI resolution failed.', 'media.resolve'],
  ['media.livePhoto:Live Photo clip failed to load into the player.', 'media.live_photo'],
  ['crypto.provider:User key bootstrap failed.', 'crypto.bootstrap'],
  ['crypto.masterKeyStore:Failed to load master key from keychain.', 'crypto.keychain'],
  ['crypto.circleKeys:Failed to resolve circle key.', 'crypto.circle_key'],
  ['crypto.rotation:Circle key rotation failed; the server keeps uploads gated until it succeeds.', 'crypto.rotation'],
  ['billing.purchases:Failed to identify RevenueCat customer', 'billing.identify'],
  ['billing.sync:Purchase sync failed', 'billing.sync'],
  ['auth.session:Failed to sign out of Clerk while switching instance', 'auth.sign_out'],
  ['auth.session:Failed to clear local plaintext media during sign-out', 'auth.cleanup'],
  ['auth.session:Failed to clear local plaintext media while switching instance', 'auth.cleanup'],
  ['auth.session:Failed to clear upload recovery cache during sign-out', 'auth.cleanup'],
  ['notifications:Push notification registration failed', 'notifications.register'],
  ['home:Draft update failed', 'share.update'],
  ['home:Share delete failed', 'share.delete'],
  ['home:Draft asset delete failed', 'share.delete'],
  ['home:Draft publish failed', 'share.publish'],
]);

/**
 * Only the `error` value and the fixed machine-token keys of the log context
 * (`stage`, `kind`, counters) reach Observe; file names, ids and messages stay local.
 */
export function reportLoggedError(
  namespace: string,
  message: string,
  context: Record<string, unknown> | undefined,
): void {
  const operation = OPERATIONS.get(`${namespace}:${message}`);
  if (operation) reportAppError(operation, context?.error, sanitizeContext(context as ErrorContext));
}
