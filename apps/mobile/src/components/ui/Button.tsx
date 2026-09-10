import Ionicons from '@expo/vector-icons/Ionicons';
import { memo } from 'react';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';

import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { AnimatedPressable } from './AnimatedPressable';

interface ButtonProps {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  variant?: 'primary' | 'outline' | 'ghost' | 'danger';
  loading?: boolean;
  disabled?: boolean;
  onPress: () => void;
}

export const Button = memo(function Button({
  label,
  icon,
  variant = 'primary',
  loading = false,
  disabled = false,
  onPress,
}: ButtonProps) {
  const theme = useTheme();
  const isDisabled = disabled || loading;

  const variantStyles = {
    primary: {
      bg: theme.primary,
      text: theme.primaryText,
      border: 'transparent',
    },
    outline: {
      bg: 'transparent',
      text: theme.primary,
      border: theme.border,
    },
    ghost: {
      bg: theme.primaryMuted,
      text: theme.primary,
      border: 'transparent',
    },
    danger: {
      bg: theme.dangerMuted,
      text: theme.danger,
      border: 'transparent',
    },
  }[variant];

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={isDisabled}
      pressedScale={0.97}
      style={[
        styles.button,
        {
          backgroundColor: variantStyles.bg,
          borderColor: variantStyles.border,
          borderWidth: variant === 'outline' ? 1.5 : 0,
        },
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={variantStyles.text} />
      ) : icon ? (
        <Ionicons name={icon} size={17} color={variantStyles.text} />
      ) : null}
      <Text style={[styles.label, { color: variantStyles.text }]}>{label}</Text>
    </AnimatedPressable>
  );
});

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 14,
  },
  label: {
    fontSize: FontSize.base,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
});
