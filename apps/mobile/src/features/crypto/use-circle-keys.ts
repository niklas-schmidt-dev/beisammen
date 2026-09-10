import { useEffect, useRef, useState } from 'react';

import { useConvex, useQuery } from 'convex/react';

import { createLogger } from '@/lib/logger';

import { keysApi } from './api';
import { buildMissingGrantPayloadsByEpoch, ensureCircleKey } from './circle-keys';
import { useCrypto } from './provider';
import { rotateCircleKeyNow } from './rotation';
import { getSodium } from './sodium';

const logger = createLogger('crypto.circleKeys');

export type CircleKeysState =
  | { status: 'loading' }
  /** The circle has a key, but no member has sealed it to this user yet. */
  | { status: 'waiting-for-grant' }
  | {
      status: 'ready';
      epoch: number;
      circleKey: Uint8Array;
      keysByEpoch: Map<number, Uint8Array>;
    };

/**
 * Resolves the viewer's key for a circle (initializing the very first epoch
 * when needed) and opportunistically seals the current key to members that
 * lack a grant. Foundation for the media-encryption pipeline; see docs/e2ee.md.
 */
export function useCircleKeys(circleId: string | null | undefined): CircleKeysState {
  const convex = useConvex();
  const crypto = useCrypto();
  const [state, setState] = useState<CircleKeysState>({ status: 'loading' });
  // One grant top-up per (mount, circle): failures are expected races with
  // other members and must not retry in a loop.
  const grantAttemptedFor = useRef<string | null>(null);
  // Same guard for the post-departure rotation: at most one attempt per
  // (mount, circle); a success clears rotationPending server-side, so the
  // subscription settles instead of looping.
  const rotationAttemptedFor = useRef<string | null>(null);

  const userKeys = crypto.status === 'ready' ? crypto.userKeys : null;
  // Reactive subscription so a granted key or a rotation re-resolves without
  // polling; ensureCircleKey re-reads the authoritative state imperatively.
  const myCircleKeys = useQuery(
    keysApi.getMyCircleKeys,
    circleId && userKeys ? { circleId } : 'skip',
  );
  const subscriptionKey = myCircleKeys
    ? `${myCircleKeys.currentEpoch ?? 'none'}:${myCircleKeys.grants.length}:${
        myCircleKeys.rotationPending ? 'rotate' : 'stable'
      }`
    : null;

  useEffect(() => {
    if (!circleId || !userKeys || myCircleKeys === undefined) {
      setState({ status: 'loading' });
      return;
    }

    let cancelled = false;

    // A departed member may still hold the current key; the server gates
    // encrypted uploads until a manage-role member commits a fresh epoch.
    // Trigger that rotation from whichever eligible client comes online first.
    if (
      myCircleKeys.rotationPending &&
      myCircleKeys.canRotate &&
      rotationAttemptedFor.current !== circleId
    ) {
      rotationAttemptedFor.current = circleId;
      void rotateCircleKeyNow({ convex, circleId });
    }

    void (async () => {
      try {
        const sodium = await getSodium();
        const result = await ensureCircleKey({
          sodium,
          userKeys,
          getMyCircleKeys: () => convex.query(keysApi.getMyCircleKeys, { circleId }),
          initializeCircleKey: (sealedCircleKey) =>
            convex.mutation(keysApi.initializeCircleKey, { circleId, sealedCircleKey }),
          rejectKeyGrant: (epoch) =>
            convex.mutation(keysApi.rejectMyKeyGrant, { circleId, epoch }),
        });

        if (cancelled) {
          return;
        }

        if (result.status === 'waiting-for-grant') {
          setState({ status: 'waiting-for-grant' });
          return;
        }

        setState({
          status: 'ready',
          epoch: result.epoch,
          circleKey: result.circleKey,
          keysByEpoch: result.keysByEpoch,
        });

        // Opportunistic top-up: seal every held epoch key (current and older)
        // to members without a grant, so new joiners and key-reset users can
        // also read media from before the latest rotation.
        const attemptKey = circleId;

        if (grantAttemptedFor.current === attemptKey) {
          return;
        }

        grantAttemptedFor.current = attemptKey;

        try {
          const heldEpochs = [...result.keysByEpoch.keys()].sort((a, b) => b - a);
          const missing = await convex.query(keysApi.listMissingKeyGrants, {
            circleId,
            epochs: heldEpochs,
          });

          if (missing.currentEpoch !== result.epoch) {
            return;
          }

          const payloads = buildMissingGrantPayloadsByEpoch(
            sodium,
            result.keysByEpoch,
            missing.missingByEpoch,
          );

          for (const payload of payloads) {
            await convex.mutation(keysApi.grantCircleKeys, {
              circleId,
              epoch: payload.epoch,
              grants: payload.grants,
            });
          }
        } catch {
          // Another member may have granted concurrently or membership changed
          // mid-flight; the next client holding the key will top up.
        }
      } catch (error) {
        if (!cancelled) {
          logger.warn('Failed to resolve circle key.', {
            circleId,
            error,
          });
          setState({ status: 'loading' });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [circleId, convex, subscriptionKey, userKeys]);

  return state;
}
