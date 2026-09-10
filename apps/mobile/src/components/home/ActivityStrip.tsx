import Ionicons from '@expo/vector-icons/Ionicons';
import { T, useGT } from 'gt-react-native';
import { memo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar, Button } from '@/components/ui';
import { Fonts, FontSize, Radius, Spacing } from '@/constants/theme';
import type { ActivityEventRecord } from '@/features/convex/api';
import { useUserProfileImage } from '@/features/media/use-user-profile-image-url';
import { useTheme } from '@/hooks/use-theme';

type ActivityStatus = 'LoadingFirstPage' | 'CanLoadMore' | 'LoadingMore' | 'Exhausted';

/** The strip is a bounded preview; the activity tab holds the full history. */
const MAX_PREVIEW_ITEMS = 6;

interface ActivityStripProps {
  activities: ActivityEventRecord[];
  status: ActivityStatus;
  onOpenActivity: (activity: ActivityEventRecord) => void;
  onOpenActivityTab: () => void;
}

function activityIcon(type: ActivityEventRecord['type']): keyof typeof Ionicons.glyphMap {
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

const ActivityRow = memo(function ActivityRow({
  activity,
  hasSeparator,
  onOpenActivity,
}: {
  activity: ActivityEventRecord;
  hasSeparator: boolean;
  onOpenActivity: (activity: ActivityEventRecord) => void;
}) {
  const theme = useTheme();
  const gt = useGT();
  const customProfileImage = useUserProfileImage(
    activity.actorId,
    activity.actorProfileImageKey,
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={gt('{text} Beitrag öffnen', { text: activity.displayText })}
      onPress={() => onOpenActivity(activity)}
      style={({ pressed }) => [
        styles.row,
        hasSeparator && {
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.borderLight,
        },
        { opacity: pressed ? 0.72 : 1 },
      ]}
    >
      <Avatar
        name={activity.actorName}
        image={customProfileImage ?? activity.actorAvatarUrl ?? null}
        size="sm"
      />
      <View style={styles.rowCopy}>
        <Text style={[styles.rowTitle, { color: theme.text }]} numberOfLines={2}>
          {activity.displayText}
        </Text>
        <Text style={[styles.rowMeta, { color: theme.textTertiary }]} numberOfLines={1}>
          <Text style={[styles.rowMetaCircle, { color: theme.primary }]}>
            {activity.circleName}
          </Text>
          {' · '}
          {activity.createdAtLabel}
        </Text>
      </View>
      <View style={[styles.iconBubble, { backgroundColor: theme.primaryMuted }]}>
        <Ionicons name={activityIcon(activity.type)} size={15} color={theme.primary} />
      </View>
    </Pressable>
  );
});

export const ActivityStrip = memo(function ActivityStrip({
  activities,
  onOpenActivity,
  onOpenActivityTab,
  status,
}: ActivityStripProps) {
  const theme = useTheme();
  const gt = useGT();
  const isLoadingFirstPage = status === 'LoadingFirstPage';
  const previewActivities = activities.slice(0, MAX_PREVIEW_ITEMS);

  return (
    <View style={styles.wrapper}>
      <View style={styles.headerRow}>
        <T>
          <Text style={[styles.eyebrow, { color: theme.textTertiary }]}>Aktivität</Text>
        </T>
        <Text style={[styles.count, { color: theme.textTertiary }]}>
          {previewActivities.length.toString().padStart(2, '0')}
        </Text>
      </View>

      <View style={[styles.list, { backgroundColor: theme.surface }]}>
        {isLoadingFirstPage ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={theme.primary} />
          </View>
        ) : previewActivities.length > 0 ? (
          previewActivities.map((activity, index) => (
            <ActivityRow
              key={activity._id}
              activity={activity}
              hasSeparator={index < previewActivities.length - 1}
              onOpenActivity={onOpenActivity}
            />
          ))
        ) : (
          <View style={styles.emptyRow}>
            <Ionicons name="sparkles-outline" size={16} color={theme.textTertiary} />
            <T>
              <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
                Noch keine neuen Aktivitäten.
              </Text>
            </T>
          </View>
        )}
      </View>

      {previewActivities.length > 0 ? (
        <Button
          label={gt('Alle Aktivitäten')}
          icon="arrow-forward-outline"
          variant="outline"
          onPress={onOpenActivityTab}
        />
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrapper: {
    gap: Spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.xs,
  },
  eyebrow: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
  },
  count: {
    fontFamily: Fonts.mono,
    fontSize: 10,
    letterSpacing: 1.2,
  },
  list: {
    borderRadius: Radius.lg,
    overflow: 'hidden',
  },
  row: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  rowCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  rowTitle: {
    fontSize: FontSize.sm,
    fontWeight: '700',
    lineHeight: 18,
  },
  rowMeta: {
    fontSize: FontSize.xs,
    fontWeight: '600',
  },
  rowMetaCircle: {
    fontSize: FontSize.xs,
    fontWeight: '800',
  },
  iconBubble: {
    width: 32,
    height: 32,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingRow: {
    minHeight: 72,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyRow: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  emptyText: {
    flex: 1,
    fontSize: FontSize.sm,
    fontWeight: '600',
  },
});
