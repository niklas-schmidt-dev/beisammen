import Ionicons from '@expo/vector-icons/Ionicons';
import { useGT } from 'gt-react-native';
import { memo, useCallback, useState } from 'react';
import { Modal, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ZoomableImage, type ZoomableImageSource } from '@/components/media/ZoomableImage';
import { AnimatedPressable } from '@/components/ui';
import { Fonts, FontSize, Radius, Spacing } from '@/constants/theme';
import type { AvatarImage } from '@/features/media/avatar-image-cache';
import { enterScreen, exitFade } from '@/lib/motion';

function toZoomableSource(image: AvatarImage | undefined): ZoomableImageSource | null {
  if (!image) {
    return null;
  }

  return typeof image === 'string' ? { uri: image } : image;
}

/**
 * Fullscreen view of a profile or circle image. Renders the very same source
 * the thumbnail used (same signed URL and cache key), so opening it never
 * triggers a second download and nothing new is written to disk.
 */
export const AvatarLightbox = memo(function AvatarLightbox({
  image,
  name,
  onClose,
  visible,
}: {
  image: AvatarImage | undefined;
  name: string;
  onClose: () => void;
  visible: boolean;
}) {
  const gt = useGT();
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const [chromeVisible, setChromeVisible] = useState(true);

  const toggleChrome = useCallback(() => {
    setChromeVisible((current) => !current);
  }, []);

  const handleZoomChange = useCallback(() => {}, []);

  return (
    <Modal
      visible={visible}
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
      transparent={false}
      onShow={() => setChromeVisible(true)}
    >
      <GestureHandlerRootView style={styles.root}>
        <ZoomableImage
          source={toZoomableSource(image)}
          width={width}
          height={height}
          isActive={visible}
          onToggleChrome={toggleChrome}
          onZoomChange={handleZoomChange}
        />

        {chromeVisible ? (
          <Animated.View
            entering={enterScreen()}
            exiting={exitFade()}
            pointerEvents="box-none"
            style={StyleSheet.absoluteFill}
          >
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
            </View>
            <View
              style={[styles.caption, { bottom: insets.bottom + Spacing.lg }]}
              pointerEvents="none"
            >
              <Text style={styles.captionText} numberOfLines={1}>
                {name}
              </Text>
            </View>
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
  topBar: {
    position: 'absolute',
    left: Spacing.lg,
    right: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(22,22,24,0.55)',
  },
  caption: {
    position: 'absolute',
    left: Spacing.lg,
    right: Spacing.lg,
    alignItems: 'center',
  },
  captionText: {
    color: '#FFFFFF',
    fontFamily: Fonts.mono,
    fontSize: FontSize.sm,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
});
