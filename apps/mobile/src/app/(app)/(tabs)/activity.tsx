import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { T, useGT } from 'gt-react-native';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useConvexAuth, useMutation, usePaginatedQuery, useQuery } from 'convex/react';

import { Avatar, Button, EmptyState, FeedbackToast, LoadingBox } from '@/components/ui';
import { Fonts, FontSize, Radius, Spacing } from '@/constants/theme';
import { enterListItem, enterSection } from '@/lib/motion';
import type { ActivityInboxItemRecord } from '@/features/convex/api';
import { api } from '@/features/convex/api';
import { buildActivityHref } from '@/features/notifications/navigation';
import { useUserProfileImage } from '@/features/media/use-user-profile-image-url';
import { useTheme } from '@/hooks/use-theme';

function activityIcon(type: ActivityInboxItemRecord['type']): keyof typeof Ionicons.glyphMap {
  switch (type) {
    case 'share.published':
      return 'images-outline';
    case 'comment.created':
      return 'chatbubble-ellipses-outline';
    case 'reaction.set':
      return 'heart-outline';
    case 'member.joined':
      return 'person-add-outline';
    default:
      return 'notifications-outline';
  }
}

const ActivityInboxRow = memo(function ActivityInboxRow({
  item,
  onOpen,
}: {
  item: ActivityInboxItemRecord;
  onOpen: (item: ActivityInboxItemRecord) => void;
}) {
  const gt = useGT();
  const theme = useTheme();
  const isUnread = item.status === 'unread';
  const customProfileImage = useUserProfileImage(item.actorId, item.actorProfileImageKey);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={gt('{displayText} Beitrag öffnen', { displayText: item.displayText })}
      onPress={() => onOpen(item)}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: isUnread ? theme.primaryMuted : theme.surface,
          borderColor: isUnread ? theme.primaryMuted : theme.borderLight,
          opacity: pressed ? 0.72 : 1,
        },
      ]}
    >
      <Avatar
        name={item.actorName}
        image={customProfileImage ?? item.actorAvatarUrl ?? null}
        size="sm"
      />
      <View style={styles.rowCopy}>
        <View style={styles.rowTitleLine}>
          {isUnread ? <View style={[styles.unreadDot, { backgroundColor: theme.primary }]} /> : null}
          <Text style={[styles.rowTitle, { color: theme.text }]} numberOfLines={2}>
            {item.displayText}
          </Text>
        </View>
        <Text style={[styles.rowMeta, { color: theme.textTertiary }]} numberOfLines={1}>
          {item.circleName} · {item.createdAtLabel}
        </Text>
      </View>
      <View
        style={[
          styles.iconBubble,
          { backgroundColor: isUnread ? theme.surface : theme.surfacePressed },
        ]}
      >
        <Ionicons
          name={activityIcon(item.type)}
          size={16}
          color={isUnread ? theme.primary : theme.textSecondary}
        />
      </View>
    </Pressable>
  );
});

export default function ActivityScreen() {
  const gt = useGT();
  const router = useRouter();
  const convexAuth = useConvexAuth();
  const theme = useTheme();
  const viewerState = useQuery(api.users.viewerState, convexAuth.isAuthenticated ? {} : 'skip');
  const hasViewer = viewerState?.isAuthenticated === true && viewerState.viewer !== null;
  const inboxPage = usePaginatedQuery(
    api.activity.listInboxForViewer,
    hasViewer ? {} : 'skip',
    { initialNumItems: 20 },
  );
  const markRead = useMutation(api.activity.markRead);
  const markManyRead = useMutation(api.activity.markManyRead);
  const [feedback, setFeedback] = useState<string | null>(null);

  const inboxItems = hasViewer ? inboxPage.results : [];
  const unreadVisibleIds = useMemo(
    () => inboxItems.filter((item) => item.status === 'unread').map((item) => item._id),
    [inboxItems],
  );
  const unreadVisibleKey = unreadVisibleIds.join('|');
  const isLoadingFirstPage = hasViewer && inboxPage.status === 'LoadingFirstPage';
  const isLoadingMore = inboxPage.status === 'LoadingMore';

  useEffect(() => {
    if (!unreadVisibleKey) {
      return;
    }

    void markManyRead({ inboxItemIds: unreadVisibleIds }).catch((error) => {
      setFeedback(error instanceof Error ? error.message : gt('Aktivität konnte nicht gelesen markiert werden.'));
    });
  }, [gt, markManyRead, unreadVisibleIds, unreadVisibleKey]);

  const handleOpenActivity = useCallback(
    async (item: ActivityInboxItemRecord) => {
      setFeedback(null);

      try {
        await markRead({ inboxItemId: item._id });
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : gt('Aktivität konnte nicht geöffnet werden.'));
        return;
      }

      router.push(buildActivityHref(item) as never);
    },
    [gt, markRead, router],
  );

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Animated.View entering={enterSection(0)} style={styles.header}>
          <T>
            <Text style={[styles.title, { color: theme.text }]}>Aktivität</Text>
            <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
              Neue Kommentare, Reaktionen und Beiträge aus deinen Circles.
            </Text>
          </T>
        </Animated.View>

        {!hasViewer || isLoadingFirstPage ? (
          <View style={styles.loadingState}>
            {isLoadingFirstPage ? (
              <ActivityIndicator size="large" color={theme.primary} />
            ) : (
              <LoadingBox />
            )}
          </View>
        ) : inboxItems.length === 0 ? (
          <EmptyState
            icon="notifications-outline"
            title={gt('Keine Aktivität')}
            message={gt('Sobald andere in deinen Circles teilen, kommentieren oder reagieren, erscheint es hier.')}
          />
        ) : (
          <View style={styles.list}>
            {inboxItems.map((item, idx) => (
              <Animated.View key={item._id} entering={enterListItem(idx)}>
                <ActivityInboxRow item={item} onOpen={handleOpenActivity} />
              </Animated.View>
            ))}
          </View>
        )}

        {hasViewer && inboxItems.length > 0 && inboxPage.status !== 'Exhausted' ? (
          <Button
            label={isLoadingMore ? gt('Lädt...') : gt('Mehr Aktivität')}
            icon="chevron-down-outline"
            variant="outline"
            loading={isLoadingMore}
            disabled={isLoadingMore}
            onPress={() => inboxPage.loadMore(20)}
          />
        ) : null}
      </ScrollView>

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
  header: {
    gap: Spacing.xs,
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: FontSize['2xl'],
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: FontSize.base,
    lineHeight: 22,
  },
  loadingState: {
    paddingVertical: Spacing['4xl'],
  },
  list: {
    gap: Spacing.sm,
  },
  row: {
    minHeight: 78,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderWidth: 1,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
  },
  rowCopy: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  rowTitleLine: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.xs,
  },
  unreadDot: {
    width: 7,
    height: 7,
    borderRadius: Radius.full,
    marginTop: 6,
  },
  rowTitle: {
    flex: 1,
    fontSize: FontSize.base,
    fontWeight: '700',
    lineHeight: 20,
  },
  rowMeta: {
    fontSize: FontSize.xs,
    fontWeight: '600',
  },
  iconBubble: {
    width: 34,
    height: 34,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
