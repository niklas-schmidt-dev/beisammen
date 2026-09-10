import type { ConvexReactClient } from 'convex/react';

import { createLogger } from '@/lib/logger';

import { keysApi } from './api';
import { buildRotationPayload } from './circle-keys';
import { getSodium } from './sodium';

const logger = createLogger('crypto.rotation');

/**
 * Best-effort circle key rotation after a member departure: generates a fresh
 * epoch key sealed to every remaining member (self included). Rotation does
 * not require holding the previous epoch key, since the new key is generated
 * from scratch; older epochs stay resolvable for existing assets via their
 * grants. The server marks the circle rotation-pending on every departure and
 * blocks encrypted upload completion until a rotation lands, so a client-side
 * failure here only delays uploads, never post-departure confidentiality.
 * Returns true when a new epoch was committed.
 */
export async function rotateCircleKeyNow(options: {
  convex: ConvexReactClient;
  circleId: string;
}): Promise<boolean> {
  const { convex, circleId } = options;

  try {
    const sodium = await getSodium();
    const myKeys = await convex.query(keysApi.getMyCircleKeys, { circleId });

    if (myKeys.currentEpoch === null) {
      // No circle key yet, so no departed member ever held one either.
      return false;
    }

    const members = await convex.query(keysApi.getCircleMemberPublicKeys, { circleId });
    const rotation = buildRotationPayload(sodium, members);

    await convex.mutation(keysApi.rotateCircleKey, { circleId, grants: rotation.grants });

    if (rotation.skippedUserIds.length > 0) {
      logger.info('Rotated circle key; members without usable keys were skipped.', {
        circleId,
        skippedCount: rotation.skippedUserIds.length,
      });
    }

    return true;
  } catch (error) {
    logger.warn('Circle key rotation failed; the server keeps uploads gated until it succeeds.', {
      circleId,
      error,
    });

    return false;
  }
}
