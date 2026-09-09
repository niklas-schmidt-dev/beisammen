import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { T, useGT, useMessages } from 'gt-react-native';
import { StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useConvexAuth, useQuery } from 'convex/react';

import { Fonts, FontSize, Spacing } from '@/constants/theme';
import { enterSection } from '@/lib/motion';
import { useSession } from '@/features/auth/session-provider';
import { api } from '@/features/convex/api';
import { useProfileImage } from '@/features/media/use-profile-image-url';
import { useTheme } from '@/hooks/use-theme';

import { AnimatedPressable, Avatar, Card } from '@/components/ui';
import { SettingsNavRow } from '@/components/settings/SettingsNavRow';
import { settingsCopy } from '@/components/settings/copy';

export default function SettingsScreen() {
  const router = useRouter();
  const { session } = useSession();
  const convexAuth = useConvexAuth();
  const theme = useTheme();
  const gt = useGT();
  const m = useMessages();
  const viewerState = useQuery(api.users.viewerState, convexAuth.isAuthenticated ? {} : 'skip');
  const viewer = viewerState?.viewer ?? null;
  const hasViewer = viewerState?.isAuthenticated === true && viewer !== null;
  const billingStatus = useQuery(api.billing.status, hasViewer ? {} : 'skip');

  const customProfileImage = useProfileImage(viewer?.profileImageKey);
  const profileImage = customProfileImage ?? session?.avatarUrl ?? null;
  const accountLabel = session?.email ?? session?.displayName ?? gt('Angemeldet');
  const profileName = viewer?.displayName ?? session?.displayName ?? accountLabel;

  const activePlan =
    billingStatus?.deployment === 'cloud'
      ? billingStatus.plans.find((plan) => billingStatus.activePlanIds.includes(plan.id))
      : undefined;
  const planSubtitle =
    billingStatus === undefined
      ? undefined
      : billingStatus.deployment === 'self-hosted'
        ? gt('Self-hosted · keine Limits')
        : (activePlan?.name ?? gt('Kein aktiver Tarif'));

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]} edges={['top']}>
      <Animated.ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View entering={enterSection(0)}>
          <Text style={[styles.title, { color: theme.text }]}>{m(settingsCopy.settingsTitle)}</Text>
        </Animated.View>

        <Animated.View entering={enterSection(1)}>
          <AnimatedPressable
            accessibilityRole="button"
            accessibilityLabel={gt('Konto öffnen')}
            onPress={() => router.push('/settings/account' as never)}
            pressedScale={0.98}
          >
            <Card style={styles.profileCard}>
              <Avatar name={profileName} image={profileImage} size="lg" />
              <View style={styles.profileCopy}>
                <Text style={[styles.profileName, { color: theme.text }]} numberOfLines={1}>
                  {profileName}
                </Text>
                <Text
                  style={[styles.profileMeta, { color: theme.textSecondary }]}
                  numberOfLines={1}
                >
                  {accountLabel}
                </Text>
              </View>
              <Ionicons name="chevron-forward-outline" size={16} color={theme.textTertiary} />
            </Card>
          </AnimatedPressable>
        </Animated.View>

        <Animated.View entering={enterSection(2)}>
          <Card style={styles.navCard}>
            <SettingsNavRow
              icon="people-outline"
              title={m(settingsCopy.yourCirclesLabel)}
              subtitle={gt('Verwalten, beitreten, neuen Circle erstellen')}
              hasSeparator
              onPress={() => router.push('/settings/circles' as never)}
            />
            <SettingsNavRow
              icon="pie-chart-outline"
              title={gt('Tarif & Nutzung')}
              subtitle={planSubtitle}
              tone="accent"
              hasSeparator
              onPress={() => router.push('/settings/plan' as never)}
            />
            <SettingsNavRow
              icon="notifications-outline"
              title={gt('Benachrichtigungen')}
              subtitle={gt('Push-Mitteilungen auswählen')}
              hasSeparator
              onPress={() => router.push('/settings/notifications' as never)}
            />
            <SettingsNavRow
              icon="key-outline"
              title={gt('Wiederherstellungscode anzeigen')}
              subtitle={gt('Zugriff auf verschlüsselte Fotos sichern')}
              onPress={() => router.push('/settings/recovery-code' as never)}
            />
          </Card>
        </Animated.View>

        {__DEV__ || billingStatus?.deployment === 'self-hosted' ? (
          <Animated.View entering={enterSection(3)}>
            <Card style={styles.navCard}>
              <SettingsNavRow
                icon="hardware-chip-outline"
                title={gt('Speicher & Diagnose')}
                subtitle={gt('Verbindung prüfen, Protokoll ansehen')}
                onPress={() => router.push('/settings/advanced' as never)}
              />
            </Card>
          </Animated.View>
        ) : null}

        <T>
          <Text style={[styles.footer, { color: theme.textTertiary }]}>
            beisammen · Deine Erinnerungen, dein Speicher
          </Text>
        </T>
      </Animated.ScrollView>
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
  title: {
    fontFamily: Fonts.display,
    fontSize: FontSize['2xl'],
    fontWeight: '700',
    letterSpacing: -0.5,
    marginBottom: Spacing.sm,
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  profileCopy: {
    flex: 1,
    gap: 2,
  },
  profileName: {
    fontFamily: Fonts.display,
    fontSize: FontSize.lg,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  profileMeta: {
    fontSize: FontSize.sm,
  },
  navCard: {
    paddingVertical: Spacing.xs,
    gap: 0,
  },
  footer: {
    textAlign: 'center',
    fontSize: FontSize.xs,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginTop: Spacing.sm,
  },
});
