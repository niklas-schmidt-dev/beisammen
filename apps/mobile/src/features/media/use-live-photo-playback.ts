import { useCallback, useEffect, useState } from 'react';

import { useVideoPlayer, type VideoPlayer } from 'expo-video';

import { createLogger } from '@/lib/logger';

import { useAssetMediaUri, type AssetMediaRef } from './use-asset-media-uri';

const logger = createLogger('media.livePhoto');

/** Structural subset of an asset record needed to detect a Live Photo. */
export interface LivePhotoAssetRef extends AssetMediaRef {
  pairedVideoStorage?: object | null;
  pairedVideoDurationSeconds?: number;
}

/** An image asset that carries a paired companion clip (iOS Live Photo). */
export function isLivePhotoAsset(
  asset: Pick<LivePhotoAssetRef, 'kind' | 'pairedVideoStorage'> | null | undefined,
): boolean {
  return asset?.kind === 'image' && Boolean(asset.pairedVideoStorage);
}

/**
 * Press-and-hold playback for a Live Photo's companion clip, mirroring the
 * iOS Photos interaction: `start()` on long-press plays the clip (with audio)
 * over the still, `stop()` on release returns to the still.
 *
 * A hold never depends on the clip being pre-loaded: `start()` records the
 * intent, resolution (signed URL → download → decrypt) begins on demand,
 * `isLoading` reports the wait, and playback begins the moment the clip is
 * ready while the finger is still down. Surfaces that know their slide is
 * active can pass `prefetch` to hide that wait entirely. The resolved URI is
 * fed into a dedicated player via `replaceAsync`, exactly like the main video
 * path (see use-video-player-source.ts for why).
 */
export function useLivePhotoPlayback(input: {
  asset: LivePhotoAssetRef | null | undefined;
  circleId?: string | null;
  /** Resolve the clip eagerly (e.g. while the slide is active). */
  prefetch?: boolean;
}): {
  isLivePhoto: boolean;
  isPlaying: boolean;
  /** A hold is waiting for the clip to finish downloading or decrypting. */
  isLoading: boolean;
  player: VideoPlayer;
  start: () => void;
  stop: () => void;
} {
  const isLivePhoto = isLivePhotoAsset(input.asset);
  const assetId = input.asset?._id ?? null;
  // The finger is down and playback is wanted as soon as the clip is ready.
  const [isHolding, setIsHolding] = useState(false);
  // The clip ran to its end during this hold; do not restart until release.
  const [hasEnded, setHasEnded] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const videoUri = useAssetMediaUri(
    isLivePhoto && (input.prefetch === true || isHolding) ? input.asset : null,
    'pairedVideo',
    input.circleId,
  );
  const player = useVideoPlayer(null);

  // Swiping to a different asset resets any in-flight hold state.
  useEffect(() => {
    setIsHolding(false);
    setHasEnded(false);
    setIsPlaying(false);
  }, [assetId]);

  useEffect(() => {
    if (!videoUri) {
      setIsReady(false);
      return;
    }

    let isCancelled = false;

    player
      .replaceAsync(videoUri)
      .then(() => {
        if (!isCancelled) {
          setIsReady(true);
        }
      })
      .catch((error: unknown) => {
        if (isCancelled) return;
        // Native players can be released during fast swipes; a real load
        // failure surfaces here instead of silently disabling the hold.
        logger.warn('Live Photo clip failed to load into the player.', {
          assetId,
          error,
        });
      });

    return () => {
      isCancelled = true;
    };
  }, [assetId, player, videoUri]);

  // A clip that runs to its end settles back on the still, like iOS Photos;
  // it replays only after releasing and holding again.
  useEffect(() => {
    const subscription = player.addListener('playToEnd', () => {
      setIsPlaying(false);
      setHasEnded(true);
    });

    return () => subscription.remove();
  }, [player]);

  // Playback begins once the hold and the loaded clip meet, in either order.
  useEffect(() => {
    if (!isHolding || !isReady || hasEnded || isPlaying) {
      return;
    }

    try {
      player.currentTime = 0;
      player.play();
      setIsPlaying(true);
    } catch {
      // Native players can be released during fast swipes.
    }
  }, [hasEnded, isHolding, isPlaying, isReady, player]);

  const start = useCallback(() => {
    if (!isLivePhoto) {
      return;
    }

    setIsHolding(true);
    setHasEnded(false);
  }, [isLivePhoto]);

  const stop = useCallback(() => {
    setIsHolding(false);
    setHasEnded(false);
    setIsPlaying(false);

    try {
      player.pause();
      player.currentTime = 0;
    } catch {
      // Native players can be released during fast swipes.
    }
  }, [player]);

  return {
    isLivePhoto,
    isPlaying,
    isLoading: isHolding && !isReady,
    player,
    start,
    stop,
  };
}
