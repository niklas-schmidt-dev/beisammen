import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { T, useGT, useMessages } from 'gt-react-native';

import { useConvexAuth, usePaginatedQuery, useQuery } from 'convex/react';

import { Fonts, FontSize, Radius, Spacing } from '@/constants/theme';
import { enterSection } from '@/lib/motion';
import type { CircleListItem } from '@/features/convex/api';
import { api } from '@/features/convex/api';
import { useTheme } from '@/hooks/use-theme';

import { AnimatedPressable, Button, Card } from '@/components/ui';
import { CirclesList } from '@/components/settings/CirclesList';
import { SettingsScreenHeader } from '@/components/settings/SettingsScreenHeader';
import { settingsCopy } from '@/components/settings/copy';

export default function CirclesScreen() {
  const router = useRouter();
  const convexAuth = useConvexAuth();
  const theme = useTheme();
  const gt = useGT();
  const m = useMessages();
  const viewerState = useQuery(api.users.viewerState, convexAuth.isAuthenticated ? {} : 'skip');
  const hasViewer = viewerState?.isAuthenticated === true && viewerState.viewer !== null;
  const circlesPage = usePaginatedQuery(
    api.circles.listForViewer,
    hasViewer ? {} : 'skip',
    { initialNumItems: 20 },
  );
  const circles = hasViewer ? circlesPage.results : undefined;

  const handleOpenCircle = useCallback(
    (circle: CircleListItem) => {
      router.push(`/circle/${circle._id}` as never);
    },
    [router],
  );

  const isLoadingMoreCircles = circlesPage.status === 'LoadingMore';

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]} edges={['top']}>
      <Animated.ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View entering={enterSection(0)}>
          <SettingsScreenHeader
            eyebrow={gt('Einstellungen')}
            title={m(settingsCopy.yourCirclesLabel)}
          />
        </Animated.View>

        <Animated.View entering={enterSection(1)} style={styles.section}>
          <CirclesList circles={circles} onOpenCircle={handleOpenCircle} />
          {circles && circlesPage.status !== 'Exhausted' ? (
            <Button
              label={isLoadingMoreCircles ? gt('Lädt...') : gt('Weitere Circles laden')}
              icon="chevron-down-outline"
              variant="outline"
              loading={isLoadingMoreCircles}
              disabled={isLoadingMoreCircles}
              onPress={() => circlesPage.loadMore(20)}
            />
          ) : null}
        </Animated.View>

        <Animated.View entering={enterSection(2)}>
          <AnimatedPressable
            accessibilityRole="button"
            accessibilityLabel={m(settingsCopy.createCircleLabel)}
            onPress={() => router.push('/circle/new' as never)}
          >
            <Card style={styles.createCard}>
              <View style={[styles.createIcon, { backgroundColor: theme.primaryMuted }]}>
                <Ionicons name="add-outline" size={19} color={theme.primary} />
              </View>
              <View style={styles.createCopy}>
                <T>
                  <Text style={[styles.createTitle, { color: theme.text }]}>
                    Neuen Circle erstellen
                  </Text>
                  <Text style={[styles.createMeta, { color: theme.textSecondary }]}>
                    Ein privater Raum für eine neue Gruppe.
                  </Text>
                </T>
              </View>
              <Ionicons name="chevron-forward-outline" size={16} color={theme.textTertiary} />
            </Card>
          </AnimatedPressable>
        </Animated.View>

        <Animated.View entering={enterSection(3)}>
          <AnimatedPressable
            accessibilityRole="button"
            accessibilityLabel={gt('Circle beitreten')}
            onPress={() => router.push('/settings/join' as never)}
          >
            <Card style={styles.createCard}>
              <View style={[styles.createIcon, { backgroundColor: theme.primaryMuted }]}>
                <Ionicons name="mail-open-outline" size={19} color={theme.primary} />
              </View>
              <View style={styles.createCopy}>
                <T>
                  <Text style={[styles.createTitle, { color: theme.text }]}>
                    Mit Einladung beitreten
                  </Text>
                  <Text style={[styles.createMeta, { color: theme.textSecondary }]}>
                    Einladungslink oder Code einfügen.
                  </Text>
                </T>
              </View>
              <Ionicons name="chevron-forward-outline" size={16} color={theme.textTertiary} />
            </Card>
          </AnimatedPressable>
        </Animated.View>
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
  section: {
    gap: Spacing.sm,
  },
  createCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  createIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createCopy: {
    flex: 1,
    gap: 1,
  },
  createTitle: {
    fontFamily: Fonts.display,
    fontSize: FontSize.md,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  createMeta: {
    fontSize: FontSize.xs,
    lineHeight: 16,
  },
});
