import { useCallback, useEffect, useRef, useState } from 'react';

import { useVideoPlayer, type VideoPlayer, type VideoPlayerStatus } from 'expo-video';
import { reportAppError } from '@/features/observe/errors';

import { createVideoPerfLogger } from './video-logging';
import { isVideoProxyUrl } from './video-proxy/server';

const logger = createVideoPerfLogger('media.videoPlayback');

/**
 * Stable `VideoPlayer` for one media slide plus its loading lifecycle.
 *
 * The player is created once without a source and fed via `replaceAsync` when
 * the URL resolves: passing the async URL to `useVideoPlayer` directly would
 * release and recreate the native player once the URL arrives, leaving every
 * component still holding the old reference bound to a dead native object.
 *
 * Emits `media.videoPlayback` debug logs for the whole loading timeline
 * (URI resolved, source loaded, status changes, first frame), all relative to
 * the mounting of the owning slide.
 */
export function useVideoPlayerSource(input: {
  assetId: string;
  kind: 'image' | 'video';
  signedUrl: string | null;
  /** Extra player setup, run once at creation. */
  setup?: (player: VideoPlayer) => void;
}): {
  player: VideoPlayer;
  /** The source finished loading into the player; playback can start. */
  isSourceReady: boolean;
  /** The view rendered a decoded frame; posters can fade out. */
  hasFirstFrame: boolean;
  playerStatus: VideoPlayerStatus;
  /** Attach to `VideoView.onFirstFrameRender`. */
  onFirstFrameRender: () => void;
} {
  const { assetId, kind, signedUrl } = input;
  const setupRef = useRef(input.setup);

  setupRef.current = input.setup;

  const player = useVideoPlayer(null, (instance) => {
    // Start playback as soon as frames are decodable instead of waiting for
    // AVPlayer's stall-avoidance heuristic, which on slow connections delays
    // the start by tens of seconds while it buffers far ahead.
    instance.bufferOptions = { waitsToMinimizeStalling: false };
    setupRef.current?.(instance);
  });
  const [isSourceReady, setIsSourceReady] = useState(false);
  const [hasFirstFrame, setHasFirstFrame] = useState(false);
  const [playerStatus, setPlayerStatus] = useState<VideoPlayerStatus>('idle');
  // Playback performance timeline: all marks are ms since the slide mounted.
  const mountedAtRef = useRef(Date.now());
  const sinceMount = () => Date.now() - mountedAtRef.current;

  useEffect(() => {
    if (kind !== 'video' || !signedUrl) {
      return;
    }

    logger.debug('Video URI resolved.', {
      assetId,
      uriKind: signedUrl.startsWith('file:')
        ? 'local-file'
        : isVideoProxyUrl(signedUrl)
          ? 'proxy'
          : 'remote',
      sinceMountMs: sinceMount(),
    });

    let isCancelled = false;
    setIsSourceReady(false);
    setHasFirstFrame(false);
    const replaceStartedAt = Date.now();

    player
      .replaceAsync(signedUrl)
      .then(() => {
        logger.debug('Video source loaded into player.', {
          assetId,
          replaceMs: Date.now() - replaceStartedAt,
          sinceMountMs: sinceMount(),
        });

        if (!isCancelled) {
          setIsSourceReady(true);
        }
      })
      .catch((error: unknown) => {
        // Native players can be released during fast swipes.
        if (!isCancelled) reportAppError('media.video_load', error);
        logger.debug('Video source load failed.', {
          assetId,
          error,
          replaceMs: Date.now() - replaceStartedAt,
          sinceMountMs: sinceMount(),
        });
      });

    return () => {
      isCancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId, kind, player, signedUrl]);

  // Status transitions (loading → readyToPlay / error) with elapsed times.
  useEffect(() => {
    if (kind !== 'video') {
      return;
    }

    const subscription = player.addListener('statusChange', ({ status, error }) => {
      if (status === 'error') reportAppError('media.video_playback', error);
      logger.debug('Video player status changed.', {
        assetId,
        status,
        ...(error ? { error: error.message } : {}),
        sinceMountMs: sinceMount(),
      });
      setPlayerStatus(status);
    });

    return () => subscription.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId, kind, player]);

  const onFirstFrameRender = useCallback(() => {
    logger.debug('Video first frame rendered.', {
      assetId,
      sinceMountMs: Date.now() - mountedAtRef.current,
    });
    setHasFirstFrame(true);
  }, [assetId]);

  return { player, isSourceReady, hasFirstFrame, playerStatus, onFirstFrameRender };
}
