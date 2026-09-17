import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useGT } from 'gt-react-native';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Modal,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { VideoView, useVideoPlayer } from 'expo-video';

import { ZoomableImage } from '@/components/media/ZoomableImage';
import { AnimatedPressable, LivePhotoBadge, MediaLoadingIndicator } from '@/components/ui';
import { Fonts, FontSize, Radius, Spacing } from '@/constants/theme';
import type { ShareAssetRecord } from '@/features/convex/api';
import { useAssetMediaUri } from '@/features/media/use-asset-media-uri';
import {
  isLivePhotoAsset,
  useLivePhotoPlayback,
} from '@/features/media/use-live-photo-playback';
import { useVideoPlayerSource } from '@/features/media/use-video-player-source';
import { MotionDuration, enterScreen, exitFade, motionEasing } from '@/lib/motion';

/** Soft black gradient behind the chrome so icons stay readable on any photo. */
function Scrim({ height }: { height: number }) {
  return (
    <Svg pointerEvents="none" style={[styles.scrim, { height }]}>
      <Defs>
        <LinearGradient id="viewer-scrim" x1="0" x2="0" y1="0" y2="1">
          <Stop offset="0" stopColor="#000000" stopOpacity="0.82" />
          <Stop offset="0.5" stopColor="#000000" stopOpacity="0.42" />
          <Stop offset="1" stopColor="#000000" stopOpacity="0" />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#viewer-scrim)" />
    </Svg>
  );
}

function ViewerSlide({
  asset,
  circleId,
  height,
  isActive,
  onToggleChrome,
  onZoomChange,
  width,
}: {
  asset: ShareAssetRecord;
  circleId?: string | null;
  height: number;
  isActive: boolean;
  onToggleChrome: () => void;
  onZoomChange: (zoomed: boolean) => void;
  width: number;
}) {
  const signedUrl = useAssetMediaUri(asset, 'original', circleId);
  const previewUrl = useAssetMediaUri(asset, 'preview', circleId);
  const { player, isSourceReady, hasFirstFrame, playerStatus, onFirstFrameRender } =
    useVideoPlayerSource({ assetId: asset._id, kind: asset.kind, signedUrl });
  const livePhoto = useLivePhotoPlayback({
    asset,
    circleId,
    prefetch: isActive && asset.kind === 'image',
  });

  useEffect(() => {
    if (asset.kind !== 'video' || !isSourceReady) {
      return;
    }

    try {
      if (isActive) {
        player.play();
      } else {
        player.pause();
      }
    } catch {
      // Native players can be released during fast swipes.
    }
  }, [asset.kind, isActive, isSourceReady, player]);

  if (asset.kind === 'video') {
    return (
      <View style={[{ width, height }, styles.slide]}>
        {signedUrl ? (
          <VideoView
            player={player}
            style={styles.media}
            nativeControls
            contentFit="contain"
            onFirstFrameRender={onFirstFrameRender}
          />
        ) : null}

        {!hasFirstFrame && previewUrl ? (
          <Animated.View exiting={exitFade()} style={styles.posterFill}>
            <Image source={{ uri: previewUrl }} style={styles.media} contentFit="contain" />
          </Animated.View>
        ) : null}

        <MediaLoadingIndicator visible={!hasFirstFrame || playerStatus === 'loading'} />
      </View>
    );
  }

  return (
    <ZoomableImage
      source={signedUrl ? { uri: signedUrl } : null}
      previewSource={previewUrl ? { uri: previewUrl } : null}
      width={width}
      height={height}
      isActive={isActive}
      livePhoto={livePhoto}
      onToggleChrome={onToggleChrome}
      onZoomChange={onZoomChange}
    />
  );
}

/**
 * Immersive fullscreen viewer for a share's media: swipe between assets,
 * pinch or double-tap to zoom into photos, tap to toggle the chrome.
 */
export const FullscreenMediaViewer = memo(function FullscreenMediaViewer({
  assets,
  circleId,
  initialIndex,
  onClose,
  onIndexChange,
  visible,
}: {
  assets: ShareAssetRecord[];
  circleId?: string | null;
  initialIndex: number;
  onClose: () => void;
  onIndexChange: (index: number) => void;
  visible: boolean;
}) {
  const gt = useGT();
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const listRef = useRef<FlatList<ShareAssetRecord>>(null);
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [isZoomed, setIsZoomed] = useState(false);
  const contentScale = useSharedValue(1);

  // iPadOS-style open: the media settles in from a slight scale-down.
  useEffect(() => {
    if (visible) {
      setActiveIndex(initialIndex);
      setChromeVisible(true);
      setIsZoomed(false);
      contentScale.value = 0.94;
      contentScale.value = withTiming(1, {
        duration: MotionDuration.base,
        easing: motionEasing,
      });
    }
    // Re-running on initialIndex alone must not replay the entrance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentScale, visible]);

  const contentStyle = useAnimatedStyle(() => ({
    flex: 1,
    transform: [{ scale: contentScale.value }],
  }));

  const toggleChrome = useCallback(() => {
    setChromeVisible((current) => !current);
  }, []);

  const handleZoomChange = useCallback((zoomed: boolean) => {
    setIsZoomed(zoomed);
  }, []);

  const handleMomentumEnd = useCallback(
    (offsetX: number) => {
      const nextIndex = Math.max(0, Math.min(Math.round(offsetX / width), assets.length - 1));
      setActiveIndex(nextIndex);
      setIsZoomed(false);
      onIndexChange(nextIndex);
    },
    [assets.length, onIndexChange, width],
  );

  return (
    <Modal
      visible={visible}
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
      transparent={false}
    >
      <GestureHandlerRootView style={styles.root}>
        <Animated.View style={contentStyle}>
          <FlatList
            ref={listRef}
            data={assets}
            keyExtractor={(asset) => asset._id}
            horizontal
            pagingEnabled
            scrollEnabled={!isZoomed}
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={initialIndex}
            getItemLayout={(_, index) => ({
              length: width,
              offset: width * index,
              index,
            })}
            onScrollToIndexFailed={({ index }) => {
              listRef.current?.scrollToOffset({ offset: width * index, animated: false });
            }}
            onMomentumScrollEnd={(event) => {
              handleMomentumEnd(event.nativeEvent.contentOffset.x);
            }}
            renderItem={({ index, item }) => (
              <ViewerSlide
                asset={item}
                circleId={circleId}
                width={width}
                height={height}
                isActive={visible && index === activeIndex}
                onToggleChrome={toggleChrome}
                onZoomChange={handleZoomChange}
              />
            )}
          />
        </Animated.View>

        {chromeVisible ? (
          <Animated.View
            entering={enterScreen()}
            exiting={exitFade()}
            pointerEvents="box-none"
            style={StyleSheet.absoluteFill}
          >
            <Scrim height={insets.top + 96} />
            <View style={[styles.topBar, { top: insets.top + Spacing.sm }]} pointerEvents="box-none">
              <AnimatedPressable
                accessibilityRole="button"
                accessibilityLabel={gt('Schließen')}
                hitSlop={8}
                onPress={onClose}
                pressedScale={0.94}
                style={styles.closeButton}
              >
                <Ionicons name="close" size={22} color="#FFFFFF" />
              </AnimatedPressable>

              {assets.length > 1 ? (
                <Text style={styles.counter} pointerEvents="none">
                  {activeIndex + 1} / {assets.length}
                </Text>
              ) : null}

              <View style={styles.topBarSpacer} />
            </View>

            {isLivePhotoAsset(assets[activeIndex]) ? (
              <LivePhotoBadge
                style={[styles.liveBadge, { top: insets.top + Spacing.sm + 48 }]}
              />
            ) : null}
          </Animated.View>
        ) : null}
      </GestureHandlerRootView>
    </Modal>
  );
});

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#050505',
  },
  slide: {
    overflow: 'hidden',
    backgroundColor: '#050505',
  },
  media: {
    flex: 1,
  },
  posterFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    width: '100%',
  },
  topBar: {
    position: 'absolute',
    left: Spacing.lg,
    right: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(22,22,24,0.55)',
  },
  counter: {
    color: '#FFFFFF',
    fontFamily: Fonts.mono,
    fontSize: FontSize.sm,
    fontWeight: '700',
    letterSpacing: 1,
  },
  topBarSpacer: {
    width: 40,
  },
  liveBadge: {
    position: 'absolute',
    left: Spacing.lg,
  },
});
