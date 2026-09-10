import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';

import { useConvex, useConvexAuth, useQuery } from 'convex/react';

import { useSession } from '@/features/auth/session-provider';
import { api } from '@/features/convex/api';
import { createLogger } from '@/lib/logger';

import { keysApi, type UserKeyRecord } from './api';
import { loadMasterKey, saveMasterKey } from './master-key-store';
import { getSodium } from './sodium';
import {
  bootstrapUserKeys,
  recoverUserKeys,
  resetUserKeys,
  revealRecoveryCode,
  type UnlockedUserKeys,
} from './user-keys';

const logger = createLogger('crypto.provider');

export type CryptoStatus = 'loading' | 'ready' | 'recovery-required' | 'unavailable';

export interface CryptoContextValue {
  status: CryptoStatus;
  /** Unlocked user keys, in memory only. Present when status is 'ready'. */
  userKeys: UnlockedUserKeys | null;
  /**
   * Set exactly once right after fresh key generation. The UI must show this
   * code and call acknowledgeRecoveryCode() after the user confirmed saving it.
   */
  pendingRecoveryCode: string | null;
  acknowledgeRecoveryCode: () => void;
  /** Redeems a typed recovery code on a new device. Throws on invalid codes. */
  recover: (code: string) => Promise<void>;
  /**
   * Last resort when the recovery code is lost: replaces the key material and
   * shows the fresh recovery code via pendingRecoveryCode. The caller must
   * confirm the consequences with the user first (see resetUserKeys).
   */
  resetKeys: () => Promise<void>;
  /** Re-derives the recovery code on an unlocked device (settings screen). */
  getRecoveryCode: () => Promise<string>;
  /** Re-runs the bootstrap after a transient failure ('unavailable'). */
  retry: () => void;
}

const CryptoContext = createContext<CryptoContextValue | null>(null);

interface CryptoState {
  status: CryptoStatus;
  userKeys: UnlockedUserKeys | null;
  pendingRecoveryCode: string | null;
}

const INITIAL_STATE: CryptoState = {
  status: 'loading',
  userKeys: null,
  pendingRecoveryCode: null,
};

export function CryptoProvider({ children }: PropsWithChildren) {
  const { session } = useSession();
  const convex = useConvex();
  const convexAuth = useConvexAuth();
  const viewerState = useQuery(api.users.viewerState, convexAuth.isAuthenticated ? {} : 'skip');
  const hasViewer = viewerState?.isAuthenticated === true && viewerState.viewer !== null;
  const serverKeys = useQuery(keysApi.getMyKeys, hasViewer ? {} : 'skip');

  // One bootstrap per authenticated identity (instance + subject); switching
  // instance or account resets the whole state machine.
  const identityKey = session ? `${session.instanceUrl}#${session.subject}` : null;
  const [state, setState] = useState<CryptoState>(INITIAL_STATE);
  const [attempt, setAttempt] = useState(0);
  const bootstrappedFor = useRef<string | null>(null);
  const serverKeysRef = useRef<UserKeyRecord | null>(null);

  if (serverKeys !== undefined) {
    serverKeysRef.current = serverKeys;
  }

  useEffect(() => {
    if (!identityKey) {
      bootstrappedFor.current = null;
      serverKeysRef.current = null;
      setState(INITIAL_STATE);
      return;
    }

    // The bootstrap needs the getMyKeys answer (null or record) for a viewer
    // that exists; until then we stay in 'loading'.
    if (!hasViewer || serverKeys === undefined) {
      return;
    }

    const runKey = `${identityKey}#${attempt}`;

    if (bootstrappedFor.current === runKey) {
      return;
    }

    bootstrappedFor.current = runKey;

    const [instanceUrl, subject] = [session!.instanceUrl, session!.subject];
    let cancelled = false;

    void (async () => {
      try {
        const sodium = await getSodium();
        const storedMasterKey = await loadMasterKey(instanceUrl, subject);
        const result = await bootstrapUserKeys({
          sodium,
          serverKeys,
          storedMasterKey,
          registerKeys: (registration) => convex.mutation(keysApi.registerKeys, registration),
          saveMasterKey: (masterKey) => saveMasterKey(instanceUrl, subject, masterKey),
        });

        if (cancelled) {
          return;
        }

        if (result.status === 'generated') {
          setState({
            status: 'ready',
            userKeys: result.keys,
            pendingRecoveryCode: result.recoveryCode,
          });
        } else if (result.status === 'unlocked') {
          setState({ status: 'ready', userKeys: result.keys, pendingRecoveryCode: null });
        } else {
          setState({ status: 'recovery-required', userKeys: null, pendingRecoveryCode: null });
        }
      } catch (error) {
        logger.error('User key bootstrap failed.', {
          error,
        });

        if (!cancelled) {
          setState({ status: 'unavailable', userKeys: null, pendingRecoveryCode: null });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, convex, hasViewer, identityKey, serverKeys === undefined]);

  const acknowledgeRecoveryCode = useCallback(() => {
    setState((current) => ({ ...current, pendingRecoveryCode: null }));
  }, []);

  const retry = useCallback(() => {
    setState((current) =>
      current.status === 'unavailable' ? { ...current, status: 'loading' } : current,
    );
    setAttempt((current) => current + 1);
  }, []);

  const recover = useCallback(
    async (code: string) => {
      if (!session) {
        throw new Error('Not signed in.');
      }

      const record = serverKeysRef.current;

      if (!record) {
        throw new Error('No registered keys to recover.');
      }

      const [instanceUrl, subject] = [session.instanceUrl, session.subject];
      const sodium = await getSodium();
      const userKeys = await recoverUserKeys({
        sodium,
        serverKeys: record,
        recoveryCode: code,
        saveMasterKey: (masterKey) => saveMasterKey(instanceUrl, subject, masterKey),
      });

      setState({ status: 'ready', userKeys, pendingRecoveryCode: null });
    },
    [session],
  );

  const resetKeys = useCallback(async () => {
    if (!session) {
      throw new Error('Not signed in.');
    }

    const [instanceUrl, subject] = [session.instanceUrl, session.subject];
    const sodium = await getSodium();
    const result = await resetUserKeys({
      sodium,
      resetKeys: (registration) => convex.mutation(keysApi.resetKeys, registration),
      saveMasterKey: (masterKey) => saveMasterKey(instanceUrl, subject, masterKey),
    });

    // Reflect the replacement immediately so getRecoveryCode works before the
    // reactive getMyKeys query catches up.
    const now = Date.now();

    serverKeysRef.current = { ...result.registration, createdAt: now, updatedAt: now };

    // The fresh recovery code must be acknowledged like after first setup;
    // CryptoGate picks it up from pendingRecoveryCode.
    setState({
      status: 'ready',
      userKeys: result.keys,
      pendingRecoveryCode: result.recoveryCode,
    });
  }, [convex, session]);

  const getRecoveryCode = useCallback(async () => {
    const record = serverKeysRef.current;

    if (!record || !state.userKeys) {
      throw new Error('Keys are not unlocked.');
    }

    const sodium = await getSodium();

    return revealRecoveryCode(sodium, record, state.userKeys.masterKey);
  }, [state.userKeys]);

  const value = useMemo<CryptoContextValue>(
    () => ({
      status: state.status,
      userKeys: state.userKeys,
      pendingRecoveryCode: state.pendingRecoveryCode,
      acknowledgeRecoveryCode,
      recover,
      resetKeys,
      getRecoveryCode,
      retry,
    }),
    [acknowledgeRecoveryCode, getRecoveryCode, recover, resetKeys, retry, state],
  );

  return <CryptoContext.Provider value={value}>{children}</CryptoContext.Provider>;
}

export function useCrypto(): CryptoContextValue {
  const context = useContext(CryptoContext);

  if (!context) {
    throw new Error('useCrypto must be used within CryptoProvider.');
  }

  return context;
}
