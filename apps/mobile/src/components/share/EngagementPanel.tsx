import Ionicons from '@expo/vector-icons/Ionicons';
import { Num, T, useGT } from 'gt-react-native';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useMutation, usePaginatedQuery } from 'convex/react';
import { COMMENT_MAX_BODY_LENGTH, normalizeCommentBody } from '@beisammen/contracts';

import { AnimatedPressable, Avatar, Button, LoadingBox } from '@/components/ui';
import { Fonts, FontSize, Radius, Spacing } from '@/constants/theme';
import type {
  CommentRecord,
  ShareAssetRecord,
  ShareBatchRecord,
} from '@/features/convex/api';
import { api } from '@/features/convex/api';
import { buildCommentTarget } from '@/features/engagement/validation';
import { useUserProfileImage } from '@/features/media/use-user-profile-image-url';
import { useTheme } from '@/hooks/use-theme';
import { useDateFormat } from '@/i18n/use-date-format';

const COMMENT_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  dateStyle: 'short',
  timeStyle: 'short',
};

/** Inline editor shown in place of a comment's body while the author edits it. */
function CommentEditor({
  initialBody,
  isSaving,
  onCancel,
  onSave,
}: {
  initialBody: string;
  isSaving: boolean;
  onCancel: () => void;
  onSave: (body: string) => void;
}) {
  const theme = useTheme();
  const gt = useGT();
  const [body, setBody] = useState(initialBody);
  const canSave = !isSaving && body.trim().length > 0 && body.trim() !== initialBody.trim();

  return (
    <View style={styles.editor}>
      <TextInput
        accessibilityLabel={gt('Kommentar bearbeiten')}
        value={body}
        onChangeText={setBody}
        autoFocus
        multiline
        maxLength={COMMENT_MAX_BODY_LENGTH}
        editable={!isSaving}
        placeholderTextColor={theme.textTertiary}
        style={[
          styles.composerInput,
          styles.editorInput,
          {
            borderColor: theme.border,
            color: theme.text,
            backgroundColor: theme.background,
          },
        ]}
      />
      <View style={styles.editorActions}>
        <Text style={[styles.composerLimit, styles.editorLimit, { color: theme.textTertiary }]}>
          {body.length}/{COMMENT_MAX_BODY_LENGTH}
        </Text>
        <AnimatedPressable
          accessibilityRole="button"
          accessibilityLabel={gt('Abbrechen')}
          disabled={isSaving}
          onPress={onCancel}
          pressedScale={0.96}
          style={[styles.editorButton, { backgroundColor: theme.surfacePressed }]}
        >
          <Text style={[styles.editorButtonText, { color: theme.textSecondary }]}>
            {gt('Abbrechen')}
          </Text>
        </AnimatedPressable>
        <AnimatedPressable
          accessibilityRole="button"
          accessibilityLabel={gt('Speichern')}
          disabled={!canSave}
          onPress={() => onSave(body)}
          pressedScale={0.96}
          style={[styles.editorButton, { backgroundColor: theme.primary }]}
        >
          {isSaving ? (
            <ActivityIndicator size="small" color={theme.primaryText} />
          ) : (
            <Text style={[styles.editorButtonText, { color: theme.primaryText }]}>
              {gt('Speichern')}
            </Text>
          )}
        </AnimatedPressable>
      </View>
    </View>
  );
}

const CommentRow = memo(function CommentRow({
  comment,
  isEditing,
  isSaving,
  onCancelEdit,
  onDelete,
  onSaveEdit,
  onStartEdit,
}: {
  comment: CommentRecord;
  isEditing: boolean;
  isSaving: boolean;
  onCancelEdit: () => void;
  onDelete: (comment: CommentRecord) => void;
  onSaveEdit: (comment: CommentRecord, body: string) => void;
  onStartEdit: (comment: CommentRecord) => void;
}) {
  const theme = useTheme();
  const gt = useGT();
  const commentTimeFormat = useDateFormat(COMMENT_TIME_OPTIONS);
  const customImage = useUserProfileImage(comment.authorId, comment.authorProfileImageKey);
  const avatarImage = customImage ?? comment.authorAvatarUrl ?? null;

  return (
    <View style={styles.commentRow}>
      <Avatar name={comment.authorName} image={avatarImage} size="sm" />
      <View style={styles.commentContent}>
        <View style={styles.commentHeader}>
          <Text style={[styles.commentAuthor, { color: theme.text }]} numberOfLines={1}>
            {comment.authorName}
          </Text>
          <Text style={[styles.commentTime, { color: theme.textTertiary }]}>
            {commentTimeFormat.format(new Date(comment.createdAt))}
            {comment.editedAt ? ` · ${gt('bearbeitet')}` : ''}
          </Text>
          {comment.canEdit && !isEditing ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={gt('Kommentar bearbeiten')}
              hitSlop={10}
              onPress={() => onStartEdit(comment)}
            >
              <Ionicons name="pencil-outline" size={14} color={theme.textTertiary} />
            </Pressable>
          ) : null}
          {comment.canDelete && !isEditing ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={gt('Kommentar entfernen')}
              hitSlop={10}
              onPress={() => onDelete(comment)}
            >
              <Ionicons name="trash-outline" size={14} color={theme.textTertiary} />
            </Pressable>
          ) : null}
        </View>
        {isEditing ? (
          <CommentEditor
            initialBody={comment.body}
            isSaving={isSaving}
            onCancel={onCancelEdit}
            onSave={(body) => onSaveEdit(comment, body)}
          />
        ) : (
          <Text style={[styles.commentBody, { color: theme.textSecondary }]}>{comment.body}</Text>
        )}
      </View>
    </View>
  );
});

function ScopeChip({
  icon,
  label,
  onPress,
  selected,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  selected: boolean;
}) {
  const theme = useTheme();

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      pressedScale={0.96}
      style={[
        styles.scopeChip,
        { backgroundColor: selected ? theme.primaryMuted : theme.surfacePressed },
      ]}
    >
      <Ionicons name={icon} size={14} color={selected ? theme.primary : theme.textSecondary} />
      <Text
        style={[
          styles.scopeChipText,
          { color: selected ? theme.primary : theme.textSecondary },
        ]}
      >
        {label}
      </Text>
    </AnimatedPressable>
  );
}

/**
 * The conversation under a share: comments on the whole post or — for posts
 * with several photos — on the one currently in view, chosen with two chips.
 */
export const EngagementPanel = memo(function EngagementPanel({
  activeAsset,
  onFeedback,
  share,
}: {
  activeAsset: ShareAssetRecord | null;
  onFeedback: (message: string | null) => void;
  share: ShareBatchRecord;
}) {
  const theme = useTheme();
  const gt = useGT();
  const [engagementScope, setEngagementScope] = useState<'share' | 'asset'>('share');
  const [commentDraft, setCommentDraft] = useState('');
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const hasMultipleAssets = share.assets.length > 1;

  const commentTarget = useMemo(
    () =>
      buildCommentTarget({
        shareBatchId: share._id,
        activeAssetId: engagementScope === 'asset' ? activeAsset?._id : null,
      }),
    [activeAsset?._id, engagementScope, share._id],
  );
  const commentsPage = usePaginatedQuery(
    api.comments.listForShare,
    {
      shareBatchId: share._id,
      ...(commentTarget.assetId ? { assetId: commentTarget.assetId } : {}),
    },
    { initialNumItems: 20 },
  );
  const createComment = useMutation(api.comments.create);
  const updateComment = useMutation(api.comments.update);
  const deleteComment = useMutation(api.comments.delete);

  useEffect(() => {
    if (engagementScope === 'asset' && (!activeAsset || !hasMultipleAssets)) {
      setEngagementScope('share');
    }
  }, [activeAsset, engagementScope, hasMultipleAssets]);

  const handleSubmitComment = useCallback(async () => {
    setIsSubmittingComment(true);
    onFeedback(null);

    try {
      const body = normalizeCommentBody(commentDraft);
      await createComment({
        shareBatchId: commentTarget.shareBatchId,
        ...(commentTarget.assetId ? { assetId: commentTarget.assetId } : {}),
        body,
      });
      setCommentDraft('');
    } catch (error) {
      onFeedback(
        error instanceof Error ? error.message : gt('Kommentar konnte nicht gespeichert werden.'),
      );
    } finally {
      setIsSubmittingComment(false);
    }
  }, [commentDraft, commentTarget, createComment, gt, onFeedback]);

  const handleStartEdit = useCallback((comment: CommentRecord) => {
    setEditingCommentId(comment._id);
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingCommentId(null);
  }, []);

  const handleSaveEdit = useCallback(
    async (comment: CommentRecord, body: string) => {
      setIsSavingEdit(true);
      onFeedback(null);

      try {
        await updateComment({ commentId: comment._id, body: normalizeCommentBody(body) });
        setEditingCommentId(null);
      } catch (error) {
        onFeedback(
          error instanceof Error ? error.message : gt('Kommentar konnte nicht gespeichert werden.'),
        );
      } finally {
        setIsSavingEdit(false);
      }
    },
    [gt, onFeedback, updateComment],
  );

  const handleDeleteComment = useCallback(
    (comment: CommentRecord) => {
      Alert.alert(
        gt('Kommentar entfernen?'),
        gt('Dieser Kommentar wird für alle Mitglieder entfernt.'),
        [
          { text: gt('Abbrechen'), style: 'cancel' },
          {
            text: gt('Entfernen'),
            style: 'destructive',
            onPress: () => {
              onFeedback(null);
              void deleteComment({ commentId: comment._id }).catch((error) => {
                onFeedback(
                  error instanceof Error
                    ? error.message
                    : gt('Kommentar konnte nicht entfernt werden.'),
                );
              });
            },
          },
        ],
      );
    },
    [deleteComment, gt, onFeedback],
  );

  const targetSummary =
    commentTarget.targetKind === 'asset' ? activeAsset?.engagement : share.shareTargetEngagement;
  const comments = commentsPage.results;
  const isCommentsLoading = commentsPage.status === 'LoadingFirstPage';
  const hasMoreComments = commentsPage.status !== 'Exhausted';
  const canSubmitComment =
    !isCommentsLoading && !isSubmittingComment && commentDraft.trim().length > 0;
  const assetScopeIndex = activeAsset
    ? share.assets.findIndex((asset) => asset._id === activeAsset._id)
    : -1;

  return (
    <View style={[styles.panel, { backgroundColor: theme.surface }]}>
      <View style={styles.header}>
        <T>
          <Text style={[styles.title, { color: theme.text }]}>Gespräch</Text>
          <Text style={[styles.meta, { color: theme.textTertiary }]}>
            <Num>{targetSummary?.commentCount ?? 0}</Num> Kommentare
          </Text>
        </T>
      </View>

      {hasMultipleAssets ? (
        <View style={styles.scopeRow}>
          <ScopeChip
            icon="albums-outline"
            label={gt('Ganzer Beitrag')}
            selected={engagementScope === 'share'}
            onPress={() => setEngagementScope('share')}
          />
          <ScopeChip
            icon={activeAsset?.kind === 'video' ? 'videocam-outline' : 'image-outline'}
            label={
              activeAsset?.kind === 'video'
                ? gt('Video {position}', { position: assetScopeIndex + 1 })
                : gt('Foto {position}', { position: assetScopeIndex + 1 })
            }
            selected={engagementScope === 'asset'}
            onPress={() => setEngagementScope('asset')}
          />
        </View>
      ) : null}

      <View style={styles.composerRow}>
        <TextInput
          accessibilityLabel={gt('Kommentar schreiben')}
          value={commentDraft}
          onChangeText={setCommentDraft}
          placeholder={
            engagementScope === 'asset'
              ? gt('Zu diesem Medium schreiben…')
              : gt('Antwort schreiben…')
          }
          placeholderTextColor={theme.textTertiary}
          multiline
          maxLength={COMMENT_MAX_BODY_LENGTH}
          style={[
            styles.composerInput,
            {
              borderColor: theme.border,
              color: theme.text,
              backgroundColor: theme.background,
            },
          ]}
        />
        <AnimatedPressable
          accessibilityRole="button"
          accessibilityLabel={gt('Kommentar senden')}
          disabled={!canSubmitComment}
          onPress={() => {
            void handleSubmitComment();
          }}
          pressedScale={0.92}
          style={[styles.sendButton, { backgroundColor: theme.primary }]}
        >
          {isSubmittingComment ? (
            <ActivityIndicator size="small" color={theme.primaryText} />
          ) : (
            <Ionicons name="arrow-up" size={19} color={theme.primaryText} />
          )}
        </AnimatedPressable>
      </View>
      {commentDraft.length > 0 ? (
        <Text style={[styles.composerLimit, { color: theme.textTertiary }]}>
          {commentDraft.length}/{COMMENT_MAX_BODY_LENGTH}
        </Text>
      ) : null}

      <View style={styles.commentsList}>
        {isCommentsLoading ? (
          <LoadingBox />
        ) : comments.length > 0 ? (
          comments.map((comment, index) => (
            <View key={comment._id}>
              {index > 0 ? (
                <View style={[styles.separator, { backgroundColor: theme.borderLight }]} />
              ) : null}
              <CommentRow
                comment={comment}
                isEditing={editingCommentId === comment._id}
                isSaving={isSavingEdit && editingCommentId === comment._id}
                onCancelEdit={handleCancelEdit}
                onDelete={handleDeleteComment}
                onSaveEdit={(target, body) => {
                  void handleSaveEdit(target, body);
                }}
                onStartEdit={handleStartEdit}
              />
            </View>
          ))
        ) : (
          <T>
            <Text style={[styles.emptyText, { color: theme.textTertiary }]}>
              Noch keine Kommentare — schreib den ersten.
            </Text>
          </T>
        )}

        {hasMoreComments && comments.length > 0 ? (
          <Button
            label={commentsPage.status === 'LoadingMore' ? gt('Lädt...') : gt('Mehr laden')}
            icon="chevron-down-outline"
            variant="ghost"
            loading={commentsPage.status === 'LoadingMore'}
            onPress={() => commentsPage.loadMore(20)}
          />
        ) : null}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  panel: {
    borderRadius: Radius.xl,
    gap: Spacing.md,
    padding: Spacing.lg,
  },
  header: {
    gap: 2,
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: FontSize.lg,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  meta: {
    fontFamily: Fonts.mono,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  scopeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  scopeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: 9,
  },
  scopeChipText: {
    fontSize: FontSize.sm,
    fontWeight: '700',
  },
  composerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
  },
  composerInput: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderWidth: 1,
    borderRadius: Radius.xl,
    paddingHorizontal: Spacing.md,
    paddingTop: 12,
    paddingBottom: 12,
    fontSize: FontSize.base,
    lineHeight: 20,
    textAlignVertical: 'top',
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerLimit: {
    alignSelf: 'flex-end',
    fontFamily: Fonts.mono,
    fontSize: 10,
    fontWeight: '700',
    marginTop: -Spacing.xs,
  },
  commentsList: {
    gap: Spacing.sm,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginBottom: Spacing.sm,
    marginLeft: 32 + Spacing.sm,
  },
  commentRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  commentContent: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  commentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  commentAuthor: {
    flex: 1,
    fontSize: FontSize.sm,
    fontWeight: '700',
  },
  commentTime: {
    fontFamily: Fonts.mono,
    fontSize: 10,
    fontWeight: '600',
  },
  commentBody: {
    fontSize: FontSize.base,
    lineHeight: 21,
  },
  editor: {
    gap: Spacing.xs,
    marginTop: 2,
  },
  editorInput: {
    flex: 0,
  },
  editorActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: Spacing.xs,
  },
  editorLimit: {
    flex: 1,
    alignSelf: 'center',
    marginTop: 0,
  },
  editorButton: {
    minWidth: 88,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: 9,
  },
  editorButtonText: {
    fontSize: FontSize.sm,
    fontWeight: '700',
  },
  emptyText: {
    fontSize: FontSize.sm,
    fontWeight: '600',
  },
});
