import {
  createContext,
  useContext,
  useEffect,
  useEffectEvent,
  useState,
  type PropsWithChildren,
} from 'react';

import type { InstanceConfig } from '@beisammen/contracts';

import {
  clearStoredInviteToken,
  loadStoredActiveCircleId,
  loadStoredInstanceConfig,
  loadStoredInviteToken,
  saveStoredActiveCircleId,
  saveStoredInstanceConfig,
  saveStoredInviteToken,
} from '@/features/auth/session-store';
import { defaultInstanceConfig } from '@/features/instances/catalog';
import { isDefaultCloudInstance, setObserveInstance } from '@/features/observe/runtime';
import { recordClientDiagnostic } from '@/features/diagnostics/buffer';
import { clearUploadRecoveryForInstance } from '@/features/media/upload-recovery-runtime';
import { unregisterCurrentPushDevice } from '@/features/notifications/registration-runtime';
import { createLogger } from '@/lib/logger';

const logger = createLogger('instances.provider');

export interface InstanceContextValue {
  instance: InstanceConfig;
  isInstanceReady: boolean;
  instanceError: string | null;
  setInstanceError: (error: string | null) => void;
  activeCircleId: string | null;
  setActiveCircleId: (circleId: string | null) => void;
  pendingInviteToken: string | null;
  setPendingInviteToken: (token: string) => Promise<void>;
  clearPendingInviteToken: () => Promise<void>;
  setActiveInstance: (
    nextInstance: InstanceConfig,
    options?: { pendingInviteToken?: string },
  ) => Promise<void>;
  unregisterPushDevice: (reason: string) => Promise<void>;
}

const InstanceContext = createContext<InstanceContextValue | null>(null);

export function InstanceProvider({ children }: PropsWithChildren) {
  const [instance, setInstanceState] = useState(defaultInstanceConfig);
  const [isInstanceReady, setIsInstanceReady] = useState(false);
  const [instanceError, setInstanceError] = useState<string | null>(null);
  const [activeCircleId, setActiveCircleId] = useState<string | null>(null);
  const [pendingInviteToken, setPendingInviteTokenState] = useState<string | null>(null);

  useEffect(() => {
    let isCancelled = false;

    async function loadActiveInstance() {
      try {
        const storedInstance = await loadStoredInstanceConfig();

        if (!isCancelled) {
          void setObserveInstance(isDefaultCloudInstance(storedInstance ?? defaultInstanceConfig, defaultInstanceConfig));
        }

        if (!isCancelled && storedInstance) {
          setInstanceState(storedInstance);
        }
      } catch (error) {
        logger.warn('Failed to load stored instance config', { error });
      } finally {
        if (!isCancelled) {
          setIsInstanceReady(true);
        }
      }
    }

    void loadActiveInstance();

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isInstanceReady) {
      return;
    }

    const instanceUrl = instance.instance.baseUrl;
    let isCancelled = false;

    async function restoreInviteToken() {
      try {
        const storedInvite = await loadStoredInviteToken(instanceUrl);

        if (!isCancelled && storedInvite) {
          setPendingInviteTokenState(storedInvite);
        }
      } catch (error) {
        logger.warn('Failed to load stored invite token', { instanceUrl, error });
      }
    }

    async function restoreActiveCircle() {
      try {
        const storedCircleId = await loadStoredActiveCircleId(instanceUrl);

        if (!isCancelled && storedCircleId) {
          setActiveCircleId(storedCircleId);
        }
      } catch (error) {
        logger.warn('Failed to load stored active circle', { instanceUrl, error });
      }
    }

    void restoreInviteToken();
    void restoreActiveCircle();

    return () => {
      isCancelled = true;
    };
  }, [instance.instance.baseUrl, isInstanceReady]);

  const unregisterPushDevice = useEffectEvent(async (reason: string) => {
    try {
      await unregisterCurrentPushDevice();
    } catch (error) {
      logger.warn('Failed to unregister push device', {
        reason,
        instanceUrl: instance.instance.baseUrl,
        error,
      });
      recordClientDiagnostic('notification_registration', 'Failed to unregister push device', {
        reason,
        instanceUrl: instance.instance.baseUrl,
        error,
      });
    }
  });

  const setPendingInviteToken = useEffectEvent(async (token: string) => {
    const normalized = token.trim();

    if (!normalized) {
      return;
    }

    setPendingInviteTokenState(normalized);
    await saveStoredInviteToken(instance.instance.baseUrl, normalized);
  });

  const clearPendingInviteToken = useEffectEvent(async () => {
    setPendingInviteTokenState(null);
    await clearStoredInviteToken(instance.instance.baseUrl);
  });

  const setActiveInstance = useEffectEvent(async (
    nextInstance: InstanceConfig,
    options?: { pendingInviteToken?: string },
  ) => {
    const nextInstanceUrl = nextInstance.instance.baseUrl;
    const normalizedInviteToken = options?.pendingInviteToken?.trim() ?? '';

    // Disable before persisting/switching instances, including pending cleanup.
    if (!isDefaultCloudInstance(nextInstance, defaultInstanceConfig)) {
      void setObserveInstance(false);
    }

    await saveStoredInstanceConfig(nextInstance);

    if (normalizedInviteToken) {
      await saveStoredInviteToken(nextInstanceUrl, normalizedInviteToken);
    } else if (nextInstanceUrl !== instance.instance.baseUrl) {
      await clearStoredInviteToken(nextInstanceUrl);
    }

    if (nextInstanceUrl === instance.instance.baseUrl) {
      setInstanceState(nextInstance);

      if (normalizedInviteToken) {
        setPendingInviteTokenState(normalizedInviteToken);
      }

      return;
    }

    logger.info('Switching active instance', {
      previousInstanceUrl: instance.instance.baseUrl,
      nextInstanceUrl,
      nextInstanceName: nextInstance.instance.name,
    });

    await unregisterPushDevice('instance_switch');
    await clearUploadRecoveryForInstance(instance.instance.baseUrl).catch((error) => {
      logger.warn('Failed to clear upload recovery cache while switching instance', {
        instanceUrl: instance.instance.baseUrl,
        error,
      });
      recordClientDiagnostic('instance_switch', 'Failed to clear upload recovery cache while switching instance', {
        instanceUrl: instance.instance.baseUrl,
        error,
      });
    });

    setInstanceError(null);
    setActiveCircleId(null);
    setPendingInviteTokenState(normalizedInviteToken || null);
    setInstanceState(nextInstance);
  });

  const persistActiveCircleId = useEffectEvent((circleId: string | null) => {
    setActiveCircleId(circleId);
    void saveStoredActiveCircleId(instance.instance.baseUrl, circleId).catch((error) => {
      logger.warn('Failed to persist active circle', {
        instanceUrl: instance.instance.baseUrl,
        error,
      });
    });
  });

  const value: InstanceContextValue = {
    instance,
    isInstanceReady,
    instanceError,
    setInstanceError,
    activeCircleId,
    setActiveCircleId: persistActiveCircleId,
    pendingInviteToken,
    async setPendingInviteToken(token: string) {
      await setPendingInviteToken(token);
    },
    async clearPendingInviteToken() {
      await clearPendingInviteToken();
    },
    async setActiveInstance(nextInstance, options) {
      await setActiveInstance(nextInstance, options);
    },
    async unregisterPushDevice(reason: string) {
      await unregisterPushDevice(reason);
    },
  };

  return <InstanceContext.Provider value={value}>{children}</InstanceContext.Provider>;
}

export function useInstance(): InstanceContextValue {
  const context = useContext(InstanceContext);

  if (!context) {
    throw new Error('useInstance must be used within InstanceProvider.');
  }

  return context;
}
