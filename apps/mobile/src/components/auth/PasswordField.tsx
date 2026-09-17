import Ionicons from '@expo/vector-icons/Ionicons';
import { useGT } from 'gt-react-native';
import { memo, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import { PASSWORD_MIN_LENGTH } from '@beisammen/contracts';

import { Fonts, FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

interface PasswordFieldProps {
  value: string;
  onChangeText: (value: string) => void;
  /** `new` shows the minimum-length progress and uses new-password autofill. */
  intent: 'current' | 'new';
  editable?: boolean;
  onSubmitEditing?: () => void;
  style?: StyleProp<TextStyle>;
}

/**
 * Password input with a show/hide toggle. For new passwords it also shows how
 * many characters are still missing, so the Clerk minimum is visible before
 * the form is submitted instead of surfacing as a server error afterwards.
 */
export const PasswordField = memo(function PasswordField({
  value,
  onChangeText,
  intent,
  editable = true,
  onSubmitEditing,
  style,
}: PasswordFieldProps) {
  const theme = useTheme();
  const gt = useGT();
  const [isVisible, setIsVisible] = useState(false);

  const missing = Math.max(0, PASSWORD_MIN_LENGTH - value.length);
  const showProgress = intent === 'new' && value.length > 0;
  const isLongEnough = missing === 0;

  return (
    <View style={styles.container}>
      <View style={styles.inputRow}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          accessibilityLabel={gt('Passwort')}
          autoCapitalize="none"
          autoComplete={intent === 'current' ? 'current-password' : 'new-password'}
          autoCorrect={false}
          secureTextEntry={!isVisible}
          textContentType={intent === 'current' ? 'password' : 'newPassword'}
          placeholder={gt('Passwort')}
          placeholderTextColor={theme.textTertiary}
          editable={editable}
          onSubmitEditing={onSubmitEditing}
          style={[style, styles.input]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isVisible ? gt('Passwort verbergen') : gt('Passwort anzeigen')}
          hitSlop={8}
          onPress={() => setIsVisible((current) => !current)}
          style={({ pressed }) => [styles.toggle, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Ionicons
            name={isVisible ? 'eye-off-outline' : 'eye-outline'}
            size={20}
            color={theme.textSecondary}
          />
        </Pressable>
      </View>
      {showProgress ? (
        <View style={styles.progressRow}>
          <Text
            style={[
              styles.progressText,
              { color: isLongEnough ? theme.primary : theme.textTertiary },
            ]}
          >
            {isLongEnough
              ? gt('Mindestlänge erreicht')
              : gt('Noch {count} Zeichen bis zur Mindestlänge', { count: missing })}
          </Text>
          <Text
            style={[
              styles.progressCounter,
              { color: isLongEnough ? theme.primary : theme.textTertiary },
            ]}
          >
            {Math.min(value.length, PASSWORD_MIN_LENGTH)}/{PASSWORD_MIN_LENGTH}
          </Text>
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    gap: 6,
  },
  inputRow: {
    position: 'relative',
    justifyContent: 'center',
  },
  input: {
    // Room for the eye toggle inside the field.
    paddingRight: 48,
  },
  toggle: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.md,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.xs,
  },
  progressText: {
    flex: 1,
    fontSize: FontSize.xs,
    fontWeight: '600',
  },
  progressCounter: {
    fontFamily: Fonts.mono,
    fontSize: FontSize.xs,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});
