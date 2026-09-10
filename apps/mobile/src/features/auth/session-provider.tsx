import { ClerkProvider, useAuth, useClerk, useUser } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import { createContext, useContext, useEffectEvent, useMemo, type PropsWithChildren } from 'react';

import type { AppSession, InstanceConfig } from '@beisammen/contracts';

import { logOutPurchases } from '@/features/billing/purchases';
import { clearExportedRecoveryCodeFile } from '@/features/crypto/recovery-code-export';
import { InstanceProvider, useInstance } from '@/features/instances/instance-provider';
import { clearAvatarImageCache } from '@/features/media/avatar-image-cache';
import { clearShareDownloads } from '@/features/media/client';
import { clearDecryptedMediaCache } from '@/features/media/decrypted-cache';
import { clearUploadRecoveryForInstance } from '@/features/media/upload-recovery-runtime';
import { createLogger } from '@/lib/logger';

/**
 * Removes all locally persisted media plaintext and avatars (decrypted display
 * cache, save/share downloads, and the expo-image avatar cache). Runs whenever
 * the authorized session ends, so files the session was authorized to see do
 * not survive into the next session, a device backup, or another account.
 */
async function clearLocalPlaintextMedia(): Promise<void> {
  await Promise.all([clearDecryptedMediaCache(), clearShareDownloads(), clearAvatarImageCache()]);
}

const logger = createLogger('auth.session');

interface SessionContextValue {
  isReady: boolean;
  session: AppSession | null;
  instance: InstanceConfig;
  instanceError: string | null;
  activeCircleId: string | null;
  pendingInviteToken: string | null;
  setActiveCircleId: (circleId: string | null) => void;
  setActiveInstance: (
    nextInstance: InstanceConfig,
    options?: { pendingInviteToken?: string },
  ) => Promise<void>;
  setPendingInviteToken: (token: string) => Promise<void>;
  clearPendingInviteToken: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshSession: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

function SessionBridge({ children }: PropsWithChildren) {
  const instanceContext = useInstance();
  const { instance } = instanceContext;
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const { user } = useUser();
  const clerk = useClerk();

  const session = useMemo<AppSession | null>(() => {
    if (!isSignedIn || !user) {
      return null;
    }

    const email = user.primaryEmailAddress?.emailAddress;
    const displayName = user.fullName ?? undefined;
    const avatarUrl = user.imageUrl || undefined;

    return {
      instanceUrl: instance.instance.baseUrl,
      provider: 'clerk',
      subject: user.id,
      ...(email ? { email } : {}),
      ...(displayName ? { displayName } : {}),
      ...(avatarUrl ? { avatarUrl } : {}),
      capabilities: instance.auth.capabilities,
    };
  }, [instance, isSignedIn, user]);

  const signOut = useEffectEvent(async () => {
    logger.info('Signing out');
    await instanceContext.unregisterPushDevice('sign_out');
    await clearUploadRecoveryForInstance(instance.instance.baseUrl).catch((error) => {
      logger.warn('Failed to clear upload recovery cache during sign-out', {
        instanceUrl: instance.instance.baseUrl,
        error,
      });
    });
    await clearLocalPlaintextMedia().catch((error) => {
      logger.warn('Failed to clear local plaintext media during sign-out', { error });
    });
    try {
      clearExportedRecoveryCodeFile();
    } catch (error) {
      logger.warn('Failed to clear exported recovery code during sign-out', { error });
    }
    await logOutPurchases();
    await clerk.signOut();
    instanceContext.setActiveCircleId(null);
    instanceContext.setInstanceError(null);
  });

  const refreshSession = useEffectEvent(async () => {
    const token = await getToken({ skipCache: true });

    if (!token) {
      throw new Error('Refresh response did not include an access token.');
    }
  });

  const setActiveInstance = useEffectEvent(async (
    nextInstance: InstanceConfig,
    options?: { pendingInviteToken?: string },
  ) => {
    const isSwitching =
      nextInstance.instance.baseUrl !== instance.instance.baseUrl;

    if (isSwitching && isSignedIn) {
      await clearLocalPlaintextMedia().catch((error) => {
        logger.warn('Failed to clear local plaintext media while switching instance', { error });
      });
      await logOutPurchases();
      await clerk.signOut().catch((error) => {
        logger.warn('Failed to sign out of Clerk while switching instance', { error });
      });
    }

    await instanceContext.setActiveInstance(nextInstance, options);
  });

  const value: SessionContextValue = {
    isReady: instanceContext.isInstanceReady && isLoaded,
    session,
    instance,
    instanceError: instanceContext.instanceError,
    activeCircleId: instanceContext.activeCircleId,
    pendingInviteToken: instanceContext.pendingInviteToken,
    setActiveCircleId: instanceContext.setActiveCircleId,
    async setActiveInstance(nextInstance, options) {
      await setActiveInstance(nextInstance, options);
    },
    setPendingInviteToken: instanceContext.setPendingInviteToken,
    clearPendingInviteToken: instanceContext.clearPendingInviteToken,
    async signOut() {
      await signOut();
    },
    async refreshSession() {
      await refreshSession();
    },
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

function InstanceClerkProvider({ children }: PropsWithChildren) {
  const { instance } = useInstance();
  const publishableKey =
    typeof instance.auth.publicConfig.publishableKey === 'string'
      ? instance.auth.publicConfig.publishableKey
      : '';

  return (
    <ClerkProvider
      key={instance.instance.baseUrl}
      publishableKey={publishableKey}
      tokenCache={tokenCache}
    >
      <SessionBridge>{children}</SessionBridge>
    </ClerkProvider>
  );
}

export function SessionProvider({ children }: PropsWithChildren) {
  return (
    <InstanceProvider>
      <InstanceClerkProvider>{children}</InstanceClerkProvider>
    </InstanceProvider>
  );
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);

  if (!context) {
    throw new Error('useSession must be used within SessionProvider.');
  }

  return context;
}
