import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { VideoView } from 'expo-video';

import { MediaLoadingIndicator } from '@/components/ui';
import type { useLivePhotoPlayback } from '@/features/media/use-live-photo-playback';
import { MotionDuration } from '@/lib/motion';

const MAX_ZOOM = 5;
const DOUBLE_TAP_ZOOM = 2.5;

/** Zoom spring tuned like the press spring: decisive, no bounce. */
const ZOOM_SPRING = {
  damping: 26,
  stiffness: 320,
  mass: 0.8,
} as const;

/** Image source as expo-image expects it; `cacheKey` keeps avatars on disk. */
export interface ZoomableImageSource {
  uri: string;
  cacheKey?: string;
}

/**
 * A single pinch-, pan- and double-tap-zoomable image slide. Used by the
 * share media viewer (with Live Photo hold-to-play) and by the avatar
 * lightbox (plain source, no Live Photo).
 */
export function ZoomableImage({
  height,
  isActive,
  livePhoto,
  onToggleChrome,
  onZoomChange,
  previewSource,
  source,
  width,
}: {
  height: number;
  isActive: boolean;
  livePhoto?: ReturnType<typeof useLivePhotoPlayback>;
  onToggleChrome: () => void;
  onZoomChange: (zoomed: boolean) => void;
  previewSource?: ZoomableImageSource | null;
  source: ZoomableImageSource | null;
  width: number;
}) {
  const [isLoaded, setIsLoaded] = useState(false);
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);
  const [isZoomed, setIsZoomed] = useState(false);

  const reportZoom = useCallback(
    (zoomed: boolean) => {
      setIsZoomed(zoomed);
      onZoomChange(zoomed);
    },
    [onZoomChange],
  );

  // Swiping to another page resets any leftover zoom on this slide.
  useEffect(() => {
    if (!isActive) {
      scale.value = 1;
      savedScale.value = 1;
      translateX.value = 0;
      translateY.value = 0;
      savedTranslateX.value = 0;
      savedTranslateY.value = 0;
      setIsZoomed(false);
    }
  }, [isActive, savedScale, savedTranslateX, savedTranslateY, scale, translateX, translateY]);

  const pinch = Gesture.Pinch()
    .onStart(() => {
      savedScale.value = scale.value;
    })
    .onUpdate((event) => {
      scale.value = Math.min(Math.max(savedScale.value * event.scale, 1), MAX_ZOOM);
    })
    .onEnd(() => {
      if (scale.value <= 1.02) {
        scale.value = withTiming(1, { duration: MotionDuration.fast });
        translateX.value = withTiming(0, { duration: MotionDuration.fast });
        translateY.value = withTiming(0, { duration: MotionDuration.fast });
        runOnJS(reportZoom)(false);
      } else {
        runOnJS(reportZoom)(true);
      }
    });

  const pan = Gesture.Pan()
    .enabled(isZoomed)
    .onStart(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    })
    .onUpdate((event) => {
      translateX.value = savedTranslateX.value + event.translationX;
      translateY.value = savedTranslateY.value + event.translationY;
    })
    .onEnd(() => {
      // Settle back inside the visible bounds of the zoomed image.
      const maxX = (width * (scale.value - 1)) / 2;
      const maxY = (height * (scale.value - 1)) / 2;
      translateX.value = withSpring(
        Math.min(Math.max(translateX.value, -maxX), maxX),
        ZOOM_SPRING,
      );
      translateY.value = withSpring(
        Math.min(Math.max(translateY.value, -maxY), maxY),
        ZOOM_SPRING,
      );
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (scale.value > 1) {
        scale.value = withSpring(1, ZOOM_SPRING);
        translateX.value = withSpring(0, ZOOM_SPRING);
        translateY.value = withSpring(0, ZOOM_SPRING);
        runOnJS(reportZoom)(false);
      } else {
        scale.value = withSpring(DOUBLE_TAP_ZOOM, ZOOM_SPRING);
        runOnJS(reportZoom)(true);
      }
    });

  const singleTap = Gesture.Tap()
    .requireExternalGestureToFail(doubleTap)
    .onEnd(() => {
      runOnJS(onToggleChrome)();
    });

  // Press-and-hold plays a Live Photo's companion clip, like iOS Photos. The
  // hold itself triggers loading when needed, so it is never gated on the
  // clip already being resolved.
  const isLivePhoto = livePhoto?.isLivePhoto ?? false;
  const startLivePhoto = livePhoto?.start;
  const stopLivePhoto = livePhoto?.stop;
  const longPress = Gesture.LongPress()
    .minDuration(220)
    .maxDistance(40)
    .enabled(isLivePhoto)
    .onStart(() => {
      if (startLivePhoto) {
        runOnJS(startLivePhoto)();
      }
    })
    .onFinalize(() => {
      if (stopLivePhoto) {
        runOnJS(stopLivePhoto)();
      }
    });

  const composed = Gesture.Simultaneous(
    Gesture.Exclusive(doubleTap, singleTap),
    pinch,
    pan,
    longPress,
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <GestureDetector gesture={composed}>
      <Animated.View style={[{ width, height }, styles.slide]}>
        <Animated.View style={[styles.media, animatedStyle]}>
          {/* The cached preview stands in until the full-resolution original
              decodes, so a zoomable photo is never a blank slide. */}
          {!isLoaded && previewSource ? (
            <Image source={previewSource} style={styles.mediaFill} contentFit="contain" />
          ) : null}
          {source ? (
            <Image
              source={source}
              style={styles.media}
              contentFit="contain"
              onLoad={() => setIsLoaded(true)}
            />
          ) : null}

          {livePhoto?.isPlaying ? (
            <View style={styles.mediaFill} pointerEvents="none">
              <VideoView
                player={livePhoto.player}
                style={styles.media}
                nativeControls={false}
                contentFit="contain"
              />
            </View>
          ) : null}
        </Animated.View>

        {!source && !previewSource ? (
          <View style={styles.fallback}>
            <Ionicons name="image-outline" size={38} color="rgba(255,255,255,0.6)" />
          </View>
        ) : null}

        <MediaLoadingIndicator visible={!isLoaded || (livePhoto?.isLoading ?? false)} />
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  slide: {
    overflow: 'hidden',
    backgroundColor: '#050505',
  },
  media: {
    flex: 1,
  },
  mediaFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  fallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
