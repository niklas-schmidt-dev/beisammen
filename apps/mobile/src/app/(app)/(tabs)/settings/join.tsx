import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { T, useGT } from 'gt-react-native';
import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput } from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Card, FeedbackToast } from '@/components/ui';
import { SettingsScreenHeader } from '@/components/settings/SettingsScreenHeader';
import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useSession } from '@/features/auth/session-provider';
import { parseInviteToken } from '@/features/invites/parse-invite-token';
import { useMarkInteractive } from '@/features/observe/interactive';
import { useTheme } from '@/hooks/use-theme';
import { enterSection } from '@/lib/motion';

/**
 * Manual entry point for invite links and codes — for people who already
 * have a circle (so onboarding's join step no longer shows) and for links
 * that arrive as plain text instead of a tappable link. Hands the token to
 * the regular /invite screen, which owns preview + accept.
 */
export default function JoinCircleScreen() {
  const router = useRouter();
  const theme = useTheme();
  const gt = useGT();
  const { setPendingInviteToken } = useSession();
  const [input, setInput] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useMarkInteractive(true);

  const token = useMemo(() => parseInviteToken(input), [input]);
  const showInvalidHint = input.trim().length > 0 && !token;

  const handlePasteFromClipboard = useCallback(async () => {
    try {
      const text = await Clipboard.getStringAsync();
      if (!text.trim()) {
        setFeedback(gt('Die Zwischenablage ist leer.'));
        return;
      }
      setInput(text);
    } catch {
      setFeedback(gt('Zwischenablage konnte nicht gelesen werden.'));
    }
  }, [gt]);

  const handleContinue = useCallback(async () => {
    if (!token) {
      return;
    }

    setIsSubmitting(true);
    try {
      await setPendingInviteToken(token);
      router.push('/invite' as never);
    } finally {
      setIsSubmitting(false);
    }
  }, [router, setPendingInviteToken, token]);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]} edges={['top']}>
      <Animated.ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Animated.View entering={enterSection(0)}>
          <SettingsScreenHeader eyebrow={gt('Deine Circles')} title={gt('Circle beitreten')} />
        </Animated.View>

        <Animated.View entering={enterSection(1)}>
          <Card>
            <T>
              <Text style={[styles.cardTitle, { color: theme.text }]}>Einladung einfügen</Text>
              <Text style={[styles.body, { color: theme.textSecondary }]}>
                Füge den Einladungslink oder Code ein, den du bekommen hast. Die ganze Nachricht
                geht auch – wir fischen den Link heraus.
              </Text>
            </T>
            <TextInput
              value={input}
              onChangeText={setInput}
              accessibilityLabel={gt('Einladungslink oder Code')}
              autoCapitalize="none"
              autoCorrect={false}
              multiline
              placeholder={gt('Einladungslink oder Code')}
              placeholderTextColor={theme.textTertiary}
              editable={!isSubmitting}
              style={[
                styles.input,
                {
                  backgroundColor: theme.background,
                  borderColor: theme.border,
                  color: theme.text,
                },
              ]}
            />
            {showInvalidHint ? (
              <T>
                <Text style={[styles.hint, { color: theme.danger }]}>
                  Das sieht nicht wie ein Einladungslink oder Code aus.
                </Text>
              </T>
            ) : null}
            <Button
              label={gt('Aus Zwischenablage einfügen')}
              icon="clipboard-outline"
              variant="outline"
              disabled={isSubmitting}
              onPress={() => {
                void handlePasteFromClipboard();
              }}
            />
            <Button
              label={gt('Weiter')}
              icon="arrow-forward-outline"
              loading={isSubmitting}
              disabled={!token}
              onPress={() => {
                void handleContinue();
              }}
            />
          </Card>
        </Animated.View>
      </Animated.ScrollView>
      <FeedbackToast message={feedback} onDismiss={() => setFeedback(null)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  scroll: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing['3xl'],
    gap: Spacing.lg,
  },
  cardTitle: {
    fontSize: FontSize.xl,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  body: {
    fontSize: FontSize.sm,
    lineHeight: 20,
  },
  input: {
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    fontSize: FontSize.base,
    minHeight: 88,
    textAlignVertical: 'top',
  },
  hint: {
    fontSize: FontSize.sm,
    lineHeight: 19,
  },
});
