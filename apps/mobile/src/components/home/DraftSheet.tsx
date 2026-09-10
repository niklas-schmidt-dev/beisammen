import Ionicons from '@expo/vector-icons/Ionicons';
import { T, Var, useGT, useMessages } from 'gt-react-native';
import { memo, useCallback, useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type {
  CircleListItem,
  DraftUploadRecord,
  ShareDraftRecord,
} from '@/features/convex/api';
import { useCircleImage } from '@/features/media/use-circle-image-url';
import type { UploadReadinessNotice } from '@/features/media/upload-readiness';
import type { UploadQueueState } from '@beisammen/upload-client';

import { Fonts, FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { AssetThumbnail } from '@/components/media/AssetThumbnail';
import { FullscreenMediaViewer } from '@/components/share/FullscreenMediaViewer';
import { Avatar, Button, FeedbackToast, LoadingBox } from '@/components/ui';

const CAPTION_MAX_LENGTH = 240;

interface DraftSheetProps {
  visible: boolean;
  circle: CircleListItem | null;
  draft: ShareDraftRecord | null | undefined;
  caption: string;
  onChangeCaption: (text: string) => void;
  isDraftLoading: boolean;
  isUploading: boolean;
  isPublishing: boolean;
  isDeletingDraft: boolean;
  canPublish: boolean;
  uploadQueue: UploadQueueState;
  persistedUploads: DraftUploadRecord[];
  /** Why the picker cannot open right now; rendered inline above the caption. */
  uploadBlocker?: UploadReadinessNotice | null;
  /**
   * Feedback from the home screen. Rendered inside this sheet because the
   * native modal hides anything drawn on the screen underneath.
   */
  feedback: string | null;
  onDismissFeedback: () => void;
  onPickMedia: () => void;
  onOpenBilling?: () => void;
  onRetryEncryption?: () => void;
  onPublish: () => void;
  onDeleteDraft: () => void;
  onDeleteAsset: (assetId: string) => void;
  onRetryFailedUpload: (itemId: string) => void;
  onRemoveFailedUpload: (itemId: string) => void;
  onDiscardPersistedUpload: (uploadId: string) => void;
  onClose: () => void;
}

export const DraftSheet = memo(function DraftSheet({
  visible,
  circle,
  draft,
  caption,
  onChangeCaption,
  isDraftLoading,
  isUploading,
  isPublishing,
  isDeletingDraft,
  canPublish,
  uploadQueue,
  persistedUploads,
  uploadBlocker,
  feedback,
  onDismissFeedback,
  onPickMedia,
  onOpenBilling,
  onRetryEncryption,
  onPublish,
  onDeleteDraft,
  onDeleteAsset,
  onRetryFailedUpload,
  onRemoveFailedUpload,
  onDiscardPersistedUpload,
  onClose,
}: DraftSheetProps) {
  const theme = useTheme();
  const gt = useGT();
  const m = useMessages();
  const captionLength = caption.length;
  const circleImage = useCircleImage(circle?._id, circle?.imageKey);
  const readinessNotice = uploadBlocker ?? null;
  // Fullscreen preview of an already uploaded draft asset; null = closed.
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const draftAssets = draft?.assets ?? [];

  const closePreview = useCallback(() => setPreviewIndex(null), []);

  // Deleting the last asset (or closing the sheet) must not leave a viewer
  // open on stale data.
  useEffect(() => {
    if (!visible || draftAssets.length === 0) {
      setPreviewIndex(null);
    }
  }, [draftAssets.length, visible]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={[styles.container, { backgroundColor: theme.background }]}
      >
        {/* Handle bar */}
        <View style={styles.handleRow}>
          <View style={[styles.handle, { backgroundColor: theme.borderLight }]} />
        </View>

        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
            >
              <Ionicons name="chevron-down" size={24} color={theme.textSecondary} />
            </Pressable>
          </View>

          <T>
            <Text style={[styles.headerTitle, { color: theme.text }]}>
              Neuer <Text style={styles.headerTitleAccent}>Beitrag</Text>
            </Text>
          </T>

          <View style={styles.headerRight}>
            {draft ? (
              <Pressable
                onPress={onDeleteDraft}
                hitSlop={12}
                disabled={isDeletingDraft || isUploading || isPublishing}
                style={({ pressed }) => ({
                  opacity: pressed || isDeletingDraft ? 0.5 : 1,
                })}
              >
                <Ionicons name="trash-outline" size={20} color={theme.danger} />
              </Pressable>
            ) : null}
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {isDraftLoading ? (
            <LoadingBox />
          ) : (
            <>
              {/* Circle target card */}
              {circle ? (
                <View
                  style={[
                    styles.circleCard,
                    {
                      backgroundColor: theme.surface,
                      borderColor: theme.borderLight,
                    },
                  ]}
                >
                  <Avatar name={circle.name} image={circleImage} size="sm" />
                  <View style={styles.circleCopy}>
                    <T>
                      <Text style={[styles.circleTarget, { color: theme.text }]} numberOfLines={1}>
                        An ·{' '}
                        <Text style={styles.circleTargetName}>
                          <Var>{circle.name}</Var>
                        </Text>
                      </Text>
                    </T>
                    <Text style={[styles.circleMembers, { color: theme.textTertiary }]}>
                      {gt('{count, plural, one {# Person} other {# Personen}}', {
                        count: circle.memberCount,
                      })}
                    </Text>
                  </View>
                </View>
              ) : null}

              {readinessNotice ? (
                <View
                  style={[
                    styles.readinessCard,
                    {
                      backgroundColor: theme.accentMuted,
                      borderColor: theme.accent,
                    },
                  ]}
                >
                  <View style={styles.readinessIcon}>
                    <Ionicons
                      name={
                        readinessNotice.action === 'choose_plan'
                          ? 'card-outline'
                          : readinessNotice.action === 'retry_now'
                            ? 'alert-circle-outline'
                            : 'information-circle-outline'
                      }
                      size={18}
                      color={theme.accent}
                    />
                  </View>
                  <View style={styles.readinessCopy}>
                    <Text style={[styles.readinessTitle, { color: theme.text }]}>
                      {m(readinessNotice.title)}
                    </Text>
                    <Text style={[styles.readinessMessage, { color: theme.textSecondary }]}>
                      {m(readinessNotice.message)}
                    </Text>
                    {readinessNotice.action === 'choose_plan' && onOpenBilling ? (
                      <View style={styles.readinessAction}>
                        <Button
                          label={gt('Tarif wählen')}
                          icon="card-outline"
                          variant="outline"
                          onPress={onOpenBilling}
                        />
                      </View>
                    ) : null}
                    {readinessNotice.action === 'retry_now' && onRetryEncryption ? (
                      <View style={styles.readinessAction}>
                        <Button
                          label={gt('Erneut versuchen')}
                          icon="refresh-outline"
                          variant="outline"
                          onPress={onRetryEncryption}
                        />
                      </View>
                    ) : null}
                  </View>
                </View>
              ) : null}

              {/* Caption input */}
              <View
                style={[
                  styles.captionCard,
                  {
                    backgroundColor: theme.surface,
                    borderColor: theme.borderLight,
                  },
                ]}
              >
                <TextInput
                  accessibilityLabel={gt('Beitragstext')}
                  value={caption}
                  onChangeText={onChangeCaption}
                  placeholder={gt('Schreib etwas dazu...')}
                  placeholderTextColor={theme.textTertiary}
                  multiline
                  maxLength={CAPTION_MAX_LENGTH}
                  style={[styles.captionInput, { color: theme.text }]}
                />
                <View style={styles.captionMeta}>
                  <View style={styles.captionMetaLeft}>
                    <Ionicons name="lock-closed-outline" size={12} color={theme.textTertiary} />
                    <T>
                      <Text style={[styles.captionMetaHint, { color: theme.textTertiary }]}>
                        Nur dieser Circle
                      </Text>
                    </T>
                  </View>
                  <Text
                    style={[
                      styles.captionCounter,
                      { color: theme.textTertiary },
                    ]}
                  >
                    {captionLength}/{CAPTION_MAX_LENGTH}
                  </Text>
                </View>
              </View>

              {/* Asset thumbnails */}
              {draft?.assets.length ? (
                <View style={styles.assetsSection}>
                  <Text style={[styles.assetsSectionLabel, { color: theme.textSecondary }]}>
                    {gt('{count, plural, one {# Medium} other {# Medien}}', {
                      count: draft.assets.length,
                    })}
                  </Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.assetRow}
                  >
                    {draft.assets.map((asset, index) => (
                      <AssetThumbnail
                        key={asset._id}
                        asset={asset}
                        circleId={draft.circleId}
                        size={100}
                        onPress={() => setPreviewIndex(index)}
                        onRemove={() => onDeleteAsset(asset._id)}
                      />
                    ))}
                  </ScrollView>
                </View>
              ) : null}

              {/* Upload queue */}
              {uploadQueue.items.length > 0 ? (
                <View style={styles.queueList}>
                  {uploadQueue.items.map((item) => (
                    <UploadQueueItem
                      key={item.id}
                      item={item}
                      onRetry={
                        item.status === 'failed' ? () => onRetryFailedUpload(item.id) : undefined
                      }
                      onRemove={
                        item.status === 'failed' ? () => onRemoveFailedUpload(item.id) : undefined
                      }
                    />
                  ))}
                </View>
              ) : null}

              {persistedUploads.length > 0 ? (
                <View style={styles.queueList}>
                  {persistedUploads.map((upload) => (
                    <UploadQueueItem
                      key={upload._id}
                      item={{
                        id: upload._id,
                        fileName: upload.fileName,
                        status: upload.status,
                        errorMessage: upload.failureReason,
                      }}
                      onRemove={() => onDiscardPersistedUpload(upload._id)}
                    />
                  ))}
                </View>
              ) : null}

              {/* Actions */}
              <View style={styles.actions}>
                <Button
                  label={isUploading ? gt('Wird vorbereitet...') : gt('Medien hinzufügen')}
                  icon={isUploading ? 'cloud-upload-outline' : 'images-outline'}
                  variant="ghost"
                  loading={isUploading}
                  disabled={isPublishing || isDeletingDraft}
                  onPress={onPickMedia}
                />

                <Button
                  label={isPublishing ? gt('Wird veröffentlicht...') : gt('Veröffentlichen')}
                  icon="send-outline"
                  loading={isPublishing}
                  disabled={!canPublish || isUploading || isDeletingDraft}
                  onPress={onPublish}
                />
              </View>
            </>
          )}
        </ScrollView>

        {feedback ? (
          <View style={styles.feedback}>
            <FeedbackToast message={feedback} onDismiss={onDismissFeedback} />
          </View>
        ) : null}

        {/* Fullscreen check of uploaded media before publishing; supports
            zoom, video playback, and Live Photo hold-to-play like the feed. */}
        {draft && draftAssets.length > 0 ? (
          <FullscreenMediaViewer
            assets={draftAssets}
            circleId={draft.circleId}
            initialIndex={Math.min(previewIndex ?? 0, draftAssets.length - 1)}
            visible={previewIndex !== null}
            onClose={closePreview}
            onIndexChange={setPreviewIndex}
          />
        ) : null}
      </KeyboardAvoidingView>
    </Modal>
  );
});

// ---------------------------------------------------------------------------

interface UploadQueueItemData {
  id: string;
  fileName: string;
  locationLabel?: string;
  bytesSent?: number;
  totalBytesExpectedToSend?: number;
  progressRatio?: number;
  status: string;
  errorMessage?: string;
}

function formatProgressPercent(progressRatio?: number): string | null {
  if (progressRatio === undefined) {
    return null;
  }

  return `${Math.round(progressRatio * 100)}%`;
}

const UploadQueueItem = memo(function UploadQueueItem({
  item,
  onRetry,
  onRemove,
}: {
  item: UploadQueueItemData;
  onRetry?: () => void;
  onRemove?: () => void;
}) {
  const theme = useTheme();
  const gt = useGT();

  const iconName =
    item.status === 'uploaded'
      ? 'checkmark-circle'
      : item.status === 'failed'
        ? 'alert-circle'
        : item.status === 'uploading'
          ? 'cloud-upload-outline'
          : item.status === 'processing'
            ? 'sparkles-outline'
            : 'time-outline';

  const iconColor =
    item.status === 'uploaded'
      ? theme.primary
      : item.status === 'failed'
        ? theme.danger
        : item.status === 'processing'
          ? theme.accent
          : theme.textTertiary;

  const statusLabel =
    item.status === 'processing'
      ? gt('Wird komprimiert')
      : item.status === 'uploading'
        ? gt('Wird hochgeladen')
        : item.status === 'uploaded'
          ? gt('Fertig')
          : item.status === 'failed'
            ? gt('Fehlgeschlagen')
            : gt('Wartet');
  const progressPercent = item.status === 'uploading'
    ? formatProgressPercent(item.progressRatio)
    : null;
  const progressLabel = progressPercent ? `${statusLabel} · ${progressPercent}` : statusLabel;

  return (
    <View style={[styles.queueItem, { borderBottomColor: theme.borderLight }]}>
      <Ionicons name={iconName as keyof typeof Ionicons.glyphMap} size={14} color={iconColor} />
      <View style={styles.queueText}>
        <Text style={[styles.queueFile, { color: theme.text }]} numberOfLines={1}>
          {item.fileName}
        </Text>
        <Text style={[styles.queueStatus, { color: theme.textSecondary }]} numberOfLines={2}>
          {item.status === 'failed' && item.errorMessage ? item.errorMessage : progressLabel}
        </Text>
        {item.status === 'uploading' && item.progressRatio !== undefined ? (
          <View style={[styles.progressTrack, { backgroundColor: theme.surfacePressed }]}>
            <View
              style={[
                styles.progressFill,
                {
                  backgroundColor: theme.primary,
                  width: `${Math.max(2, Math.round(item.progressRatio * 100))}%`,
                },
              ]}
            />
          </View>
        ) : null}
        {item.locationLabel ? (
          <Text style={[styles.queueLocation, { color: theme.textSecondary }]} numberOfLines={1}>
            {item.locationLabel}
          </Text>
        ) : null}
      </View>
      {onRetry || onRemove ? (
        <View style={styles.queueActions}>
          {onRetry ? (
            <Pressable accessibilityLabel={gt('Upload erneut versuchen')} onPress={onRetry} hitSlop={8}>
              <Ionicons name="refresh-circle" size={20} color={theme.primary} />
            </Pressable>
          ) : null}
          {onRemove ? (
            <Pressable accessibilityLabel={gt('Upload entfernen')} onPress={onRemove} hitSlop={8}>
              <Ionicons name="close-circle" size={20} color={theme.textTertiary} />
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  handleRow: {
    alignItems: 'center',
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.xs,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
  },
  headerLeft: {
    width: 40,
    alignItems: 'flex-start',
  },
  headerTitle: {
    fontFamily: Fonts.display,
    fontSize: FontSize.md,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  headerTitleAccent: {
    fontStyle: 'italic',
    fontWeight: '400',
  },
  circleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm + 2,
    paddingHorizontal: Spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md + 2,
  },
  circleCopy: {
    flex: 1,
    gap: 2,
  },
  circleTarget: {
    fontSize: FontSize.sm,
    fontWeight: '600',
  },
  circleTargetName: {
    fontWeight: '700',
  },
  circleMembers: {
    fontSize: FontSize.xs,
  },
  readinessCard: {
    flexDirection: 'row',
    gap: Spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  readinessIcon: {
    paddingTop: 2,
  },
  readinessCopy: {
    flex: 1,
    gap: Spacing.xs,
  },
  readinessTitle: {
    fontSize: FontSize.sm,
    fontWeight: '700',
  },
  readinessMessage: {
    fontSize: FontSize.sm,
    lineHeight: 19,
  },
  readinessAction: {
    alignSelf: 'flex-start',
    paddingTop: Spacing.xs,
  },
  captionCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md + 2,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.sm,
  },
  captionMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: Spacing.sm,
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'transparent',
  },
  captionMetaLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  captionMetaHint: {
    fontSize: FontSize.xs,
  },
  captionCounter: {
    fontFamily: Fonts.mono,
    fontSize: FontSize.xs,
    letterSpacing: 0.5,
  },
  headerRight: {
    width: 40,
    alignItems: 'flex-end',
  },
  scroll: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing['3xl'],
    gap: Spacing.xl,
  },
  captionInput: {
    fontSize: FontSize.md,
    lineHeight: 26,
    minHeight: 100,
    textAlignVertical: 'top',
  },
  assetsSection: {
    gap: Spacing.sm,
  },
  assetsSectionLabel: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  assetRow: {
    gap: Spacing.sm,
  },
  queueList: {
    gap: 2,
  },
  queueItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  queueText: {
    flex: 1,
    gap: 2,
  },
  queueActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  queueFile: {
    fontSize: FontSize.sm,
    fontWeight: '700',
  },
  queueStatus: {
    fontSize: FontSize.xs,
  },
  progressTrack: {
    height: 4,
    overflow: 'hidden',
    borderRadius: Radius.full,
    marginTop: 2,
  },
  progressFill: {
    height: '100%',
    borderRadius: Radius.full,
  },
  queueLocation: {
    fontSize: FontSize.xs,
  },
  actions: {
    gap: Spacing.md,
  },
  feedback: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.xl,
  },
});
