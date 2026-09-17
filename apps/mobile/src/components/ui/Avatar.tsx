import { Image } from 'expo-image';
import { useGT } from 'gt-react-native';
import { memo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Fonts, FontSize, Radius } from '@/constants/theme';
import { AvatarLightbox } from '@/components/media/AvatarLightbox';
import type { AvatarImage } from '@/features/media/avatar-image-cache';
import { useTheme } from '@/hooks/use-theme';

interface AvatarProps {
  name: string;
  /** Plain stable URL (e.g. Clerk avatar) or a cache-keyed resolved source. */
  image?: AvatarImage;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Tapping opens the image fullscreen. Ignored while there is no image. */
  expandable?: boolean;
}

const sizeMap = {
  sm: { box: 32, radius: 10, fontSize: FontSize.sm },
  md: { box: 44, radius: 14, fontSize: FontSize.base },
  lg: { box: 52, radius: Radius.lg, fontSize: FontSize.md },
  xl: { box: 76, radius: Radius.xl, fontSize: FontSize.xl },
} as const;

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export const Avatar = memo(function Avatar({
  name,
  image,
  size = 'md',
  expandable = false,
}: AvatarProps) {
  const theme = useTheme();
  const gt = useGT();
  const dim = sizeMap[size];
  const source = typeof image === 'string' ? { uri: image } : image;
  const [isExpanded, setIsExpanded] = useState(false);
  const canExpand = expandable && Boolean(source);

  const frame = (
    <View
      style={[
        styles.container,
        {
          width: dim.box,
          height: dim.box,
          borderRadius: dim.radius,
          backgroundColor: theme.primaryMuted,
          borderColor: theme.borderLight,
          borderWidth: 1,
        },
      ]}
    >
      {source ? (
        <Image source={source} style={styles.image} contentFit="cover" />
      ) : (
        <Text
          style={[
            styles.initials,
            { color: theme.primary, fontSize: dim.fontSize },
          ]}
        >
          {getInitials(name)}
        </Text>
      )}
    </View>
  );

  if (!canExpand) {
    return frame;
  }

  return (
    <>
      <Pressable
        accessibilityRole="imagebutton"
        accessibilityLabel={name}
        accessibilityHint={gt('Öffnet das Bild in voller Größe')}
        hitSlop={4}
        onPress={() => setIsExpanded(true)}
        style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
      >
        {frame}
      </Pressable>
      <AvatarLightbox
        image={image}
        name={name}
        visible={isExpanded}
        onClose={() => setIsExpanded(false)}
      />
    </>
  );
});

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  initials: {
    fontFamily: Fonts.display,
    fontWeight: '700',
  },
});
