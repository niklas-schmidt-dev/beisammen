import { useRouter } from 'expo-router';
import { T, useGT, useMessages } from 'gt-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAction, useConvexAuth, useMutation, usePaginatedQuery, useQuery } from 'convex/react';

import type { CircleUploadReadiness } from '@beisammen/contracts';

import { BottomTabInset, Fonts, FontSize, Spacing } from '@/constants/theme';
import { enterListItem, enterSection } from '@/lib/motion';
import { useSession } from '@/features/auth/session-provider';
import type { ActivityEventRecord } from '@/features/convex/api';
import { api } from '@/features/convex/api';
import { useCrypto } from '@/features/crypto/provider';
import { useCircleKeys } from '@/features/crypto/use-circle-keys';
import { buildShareDetailHref } from '@/features/engagement/navigation';
import { buildActivityHref } from '@/features/notifications/navigation';
import { uploadBlockerNotice } from '@/features/media/upload-readiness';
import { useProfileImage } from '@/features/media/use-profile-image-url';
import { useShareUploadFlow } from '@/features/media/use-share-upload-flow';
import { useMarkInteractive } from '@/features/observe/interactive';
import { shouldRedirectToOnboarding } from '@/features/onboarding/routing';
import { useTheme } from '@/hooks/use-theme';
import { createLogger } from '@/lib/logger';

import { Button, EmptyState, FeedbackToast, LoadingBox } from '@/components/ui';
import { CelebrationBurst } from '@/components/onboarding/CelebrationBurst';
import { ActivityStrip } from '@/components/home/ActivityStrip';
import { CircleSelector } from '@/components/home/CircleSelector';
import { ComposeFab } from '@/components/home/ComposeFab';
import { DraftSheet } from '@/components/home/DraftSheet';
import { FeedCard } from '@/components/home/FeedCard';
import { HomeHeader } from '@/components/home/HomeHeader';
import { Ornament } from '@/components/home/Ornament';

const logger = createLogger('home');

export default function HomeScreen() {
  const gt = useGT();
  const m = useMessages();
  const router = useRouter();
  const { activeCircleId, pendingInviteToken, session, setActiveCircleId } = useSession();
  const convexAuth = useConvexAuth();
  const theme = useTheme();

  const viewerState = useQuery(api.users.viewerState, convexAuth.isAuthenticated ? {} : 'skip');
  const viewer = viewerState?.viewer;
  const hasViewer = viewerState?.isAuthenticated === true && viewer !== null;
  const circlesPage = usePaginatedQuery(
    api.circles.listForViewer,
    hasViewer ? {} : 'skip',
    { initialNumItems: 20 },
  );
  const circles = hasViewer ? circlesPage.results : undefined;
  // Home always shows a concrete circle: the shared selection when it exists
  // (persisted, shared with Erinnerungen), otherwise the newest circle. The
  // fallback is display-only — it never writes the shared selection, so an
  // "Alle Circles" choice in Erinnerungen survives visiting Home.
  const resolvedCircleId =
    circles && circles.length > 0
      ? activeCircleId && circles.some((circle) => circle._id === activeCircleId)
        ? activeCircleId
        : (circles[0]?._id ?? null)
      : null;
  const selectedCircle = circles?.find((circle) => circle._id === resolvedCircleId) ?? null;
  // Resolve the active circle's E2EE key while Home is visible: initializes
  // the first epoch and tops up missing grants for other members, so keys are
  // in place before the media pipeline starts encrypting (docs/e2ee.md).
  const crypto = useCrypto();
  const circleKeys = useCircleKeys(resolvedCircleId);
  const shareFeed = usePaginatedQuery(
    api.shares.listForCircle,
    hasViewer && resolvedCircleId ? { circleId: resolvedCircleId } : 'skip',
    { initialNumItems: 10 },
  );
  const activityFeed = usePaginatedQuery(
    api.activity.listForViewer,
    hasViewer ? {} : 'skip',
    { initialNumItems: 6 },
  );
  const activeDraft = useQuery(
    api.shares.getDraftForCircle,
    hasViewer && resolvedCircleId ? { circleId: resolvedCircleId } : 'skip',
  );
  const updateDraft = useMutation(api.shares.updateDraft);
  const publishDraft = useMutation(api.shares.publish);
  const deleteDraftAsset = useAction(api.assets.deleteDraftAsset);
  const deleteShare = useAction(api.shares.delete);
  const uploadReadiness =
    useQuery(
      api.billing.uploadReadinessForCircle,
      hasViewer && resolvedCircleId ? { circleId: resolvedCircleId } : 'skip',
    ) ?? null;

  const [draftCaption, setDraftCaption] = useState('');
  const [isPublishing, setIsPublishing] = useState(false);
  const [deletingShareId, setDeletingShareId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isDraftSheetOpen, setIsDraftSheetOpen] = useState(false);
  const [publishBurstKey, setPublishBurstKey] = useState(0);
  const customProfileImage = useProfileImage(viewer?.profileImageKey);
  const {
    selectedQueueItems,
    hasUnresolvedUploads,
    isUploading,
    handlePickMedia,
    handleRetryFailedUpload,
    handleRemoveFailedUpload,
    handleDiscardUpload,
    removeItemsForShareBatch,
  } = useShareUploadFlow({
    selectedCircle,
    activeDraft,
    circleKeys,
    onFeedback: setFeedback,
  });

  useEffect(() => {
    if (
      shouldRedirectToOnboarding({
        hasViewer,
        circlesLoaded: circles !== undefined && circlesPage.status !== 'LoadingFirstPage',
        circleCount: circles?.length ?? 0,
        pendingInviteToken,
      })
    ) {
      router.replace('/onboarding' as never);
    }
  }, [circles, circlesPage.status, hasViewer, pendingInviteToken, router]);

  // ---------------------------------------------------------------------------
  //  Draft caption sync
  // ---------------------------------------------------------------------------

  // Adopt the server caption only when the draft itself changes (opened,
  // created, published or deleted). Re-syncing on every caption update from
  // the server races with fast typing: the debounced save below echoes a
  // stale, trimmed caption back and overwrites characters typed meanwhile.
  const activeDraftId = activeDraft?._id ?? null;
  const activeDraftCaption = activeDraft?.caption;
  const syncedDraftIdRef = useRef<string | null>(null);

  useEffect(() => {
    const previousDraftId = syncedDraftIdRef.current;
    if (previousDraftId === activeDraftId) return;
    syncedDraftIdRef.current = activeDraftId;

    // A draft created while the user is already typing has no caption yet;
    // keep the local text so the save effect persists it.
    const keepLocalText =
      previousDraftId === null && activeDraftId !== null && activeDraftCaption === undefined;
    if (!keepLocalText) {
      setDraftCaption(activeDraftCaption ?? '');
    }
  }, [activeDraftId, activeDraftCaption]);

  useEffect(() => {
    if (!activeDraftId) return;
    if ((draftCaption.trim() || undefined) === activeDraftCaption) return;

    const timeout = setTimeout(() => {
      void updateDraft({
        shareBatchId: activeDraftId,
        caption: draftCaption.trim() || undefined,
      }).catch((error) => {
        logger.warn('Draft update failed', {
          shareBatchId: activeDraftId,
          error,
        });
        setFeedback(error instanceof Error ? error.message : gt('Entwurf konnte nicht aktualisiert werden.'));
      });
    }, 400);

    return () => clearTimeout(timeout);
  }, [activeDraftId, activeDraftCaption, draftCaption, gt, updateDraft]);

  // ---------------------------------------------------------------------------
  //  Animations
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  //  Derived state
  // ---------------------------------------------------------------------------

  const displayName = session?.displayName ?? session?.email ?? 'beisammen';
  const profileImage = customProfileImage ?? session?.avatarUrl ?? null;
  const hasCircles = Boolean(circles && circles.length > 0);
  const isCirclesLoading = hasViewer && circlesPage.status === 'LoadingFirstPage';
  const isLoadingMoreCircles = circlesPage.status === 'LoadingMore';
  const isViewerBootstrapping =
    Boolean(session) &&
    (
      convexAuth.isLoading ||
      !convexAuth.isAuthenticated ||
      viewerState === undefined ||
      (viewerState.isAuthenticated && !viewer)
    );

  const feedItems = shareFeed.results;
  const activityItems = hasViewer ? activityFeed.results : [];
  const isFeedLoading = Boolean(resolvedCircleId) && shareFeed.status === 'LoadingFirstPage';
  const isLoadingMoreFeed = shareFeed.status === 'LoadingMore';
  const visiblePersistedUploads =
    activeDraft?.unresolvedUploads.filter(
      (upload) => !selectedQueueItems.some((item) => item.uploadId === upload._id),
    ) ?? [];
  const hasPersistedUnresolvedUploads = visiblePersistedUploads.length > 0;
  const canPublish = Boolean(
    activeDraft &&
      activeDraft.assets.length > 0 &&
      !hasUnresolvedUploads &&
      !hasPersistedUnresolvedUploads,
  );
  const isDraftLoading = Boolean(resolvedCircleId) && activeDraft === undefined;

  useMarkInteractive(!isViewerBootstrapping && !isCirclesLoading && !isFeedLoading);

  // ---------------------------------------------------------------------------
  //  Handlers
  // ---------------------------------------------------------------------------

  const handleSelectCircle = useCallback(
    (circleId: string) => setActiveCircleId(circleId),
    [setActiveCircleId],
  );

  const performDeleteShare = useCallback(
    async (shareBatchId: string, successMessage: string) => {
      setDeletingShareId(shareBatchId);
      try {
        await deleteShare({ shareBatchId });
        removeItemsForShareBatch(shareBatchId);
        if (activeDraft?._id === shareBatchId) {
          setDraftCaption('');
        }
        setFeedback(successMessage);
      } catch (error) {
        logger.warn('Share delete failed', {
          shareBatchId,
          error,
        });
        setFeedback(error instanceof Error ? error.message : gt('Beitrag konnte nicht gelöscht werden.'));
      } finally {
        setDeletingShareId(null);
      }
    },
    [activeDraft?._id, deleteShare, gt, removeItemsForShareBatch],
  );

  const handleDeleteDraft = useCallback(() => {
    if (!activeDraft) return;
    Alert.alert(
      gt('Entwurf löschen?'),
      gt('Der Entwurf und alle hochgeladenen Medien werden dauerhaft entfernt.'),
      [
        { text: gt('Abbrechen'), style: 'cancel' },
        {
          text: gt('Löschen'),
          style: 'destructive',
          onPress: () => {
            setIsDraftSheetOpen(false);
            void performDeleteShare(activeDraft._id, gt('Entwurf wurde gelöscht.'));
          },
        },
      ],
    );
  }, [activeDraft, gt, performDeleteShare]);

  const handleDeletePublishedShare = useCallback(
    (shareBatchId: string) => {
      Alert.alert(
        gt('Beitrag löschen?'),
        gt('Der Beitrag und alle Medien werden dauerhaft gelöscht.'),
        [
          { text: gt('Abbrechen'), style: 'cancel' },
          {
            text: gt('Löschen'),
            style: 'destructive',
            onPress: () => {
              void performDeleteShare(shareBatchId, gt('Beitrag wurde gelöscht.'));
            },
          },
        ],
      );
    },
    [gt, performDeleteShare],
  );

  const handleDeleteAsset = useCallback(
    (assetId: string) => {
      Alert.alert(
        gt('Medium entfernen?'),
        gt('Die Datei wird aus dem Entwurf und aus dem Storage gelöscht.'),
        [
          { text: gt('Abbrechen'), style: 'cancel' },
          {
            text: gt('Entfernen'),
            style: 'destructive',
            onPress: () => {
              void deleteDraftAsset({ assetId })
                .then(() => {
                  setFeedback(gt('Medium wurde entfernt.'));
                })
                .catch((error) => {
                  logger.warn('Draft asset delete failed', {
                    assetId,
                    error,
                  });
                  setFeedback(
                    error instanceof Error ? error.message : gt('Medium konnte nicht entfernt werden.'),
                  );
                });
            },
          },
        ],
      );
    },
    [deleteDraftAsset, gt],
  );

  const handleDiscardPersistedUpload = useCallback(
    (uploadId: string) => {
      void handleDiscardUpload(uploadId)
        .then(() => {
          setFeedback(gt('Unterbrochener Upload wurde entfernt.'));
        })
        .catch((error) => {
          logger.warn('Persisted upload discard failed', {
            uploadId,
            error,
          });
          setFeedback(
            error instanceof Error
              ? error.message
              : gt('Unterbrochener Upload konnte nicht entfernt werden.'),
          );
        });
    },
    [gt, handleDiscardUpload],
  );

  const handlePublishDraft = useCallback(async () => {
    if (!activeDraft) return;

    setIsPublishing(true);

    try {
      await publishDraft({
        shareBatchId: activeDraft._id,
        caption: draftCaption.trim() || undefined,
      });
      removeItemsForShareBatch(activeDraft._id);
      setDraftCaption('');
      setIsDraftSheetOpen(false);
      setPublishBurstKey((key) => key + 1);
      setFeedback(gt('Beitrag wurde veröffentlicht.'));
    } catch (error) {
      logger.warn('Draft publish failed', {
        shareBatchId: activeDraft._id,
        error,
      });
      setFeedback(error instanceof Error ? error.message : gt('Beitrag konnte nicht veröffentlicht werden.'));
    } finally {
      setIsPublishing(false);
    }
  }, [activeDraft, draftCaption, gt, publishDraft, removeItemsForShareBatch]);

  const handleOpenShare = useCallback(
    (shareId: string, assetId?: string | null) =>
      router.push(buildShareDetailHref({ shareBatchId: shareId, assetId }) as never),
    [router],
  );
  const handleOpenActivity = useCallback(
    (activity: ActivityEventRecord) => router.push(buildActivityHref(activity) as never),
    [router],
  );

  const handleOpenSettings = useCallback(() => {
    router.push('/settings' as never);
  }, [router]);

  // Everything that keeps the picker closed: readiness still loading, billing,
  // or encryption keys (uploads encrypt with the circle key). The draft sheet
  // shows this inline so the media button never appears to do nothing.
  const uploadBlocker = useMemo(
    () =>
      uploadBlockerNotice({
        readiness: uploadReadiness,
        cryptoStatus: crypto.status,
        circleKeysStatus: circleKeys.status,
      }),
    [circleKeys.status, crypto.status, uploadReadiness],
  );

  const checkUploadReadiness = useCallback((): CircleUploadReadiness | null => {
    if (!selectedCircle) {
      setFeedback(gt('Bitte wähle zuerst einen Circle aus.'));
      return null;
    }

    if (uploadBlocker) {
      setFeedback(m(uploadBlocker.message));
      return null;
    }

    return uploadReadiness;
  }, [gt, m, selectedCircle, uploadBlocker, uploadReadiness]);

  const handlePickMediaWithReadiness = useCallback(async () => {
    const readiness = checkUploadReadiness();

    if (!readiness) {
      return;
    }

    await handlePickMedia();
  }, [checkUploadReadiness, handlePickMedia]);

  const handleOpenDraftSheet = useCallback(() => {
    if (!selectedCircle) {
      setFeedback(gt('Bitte wähle zuerst einen Circle aus.'));
      return;
    }
    setIsDraftSheetOpen(true);
    // Also trigger media pick if no draft exists yet
    if (!activeDraft) {
      void handlePickMediaWithReadiness();
    }
  }, [selectedCircle, activeDraft, gt, handlePickMediaWithReadiness]);

  const handleOpenBilling = useCallback(() => {
    setIsDraftSheetOpen(false);
    handleOpenSettings();
  }, [handleOpenSettings]);

  const handleDismissFeedback = useCallback(() => setFeedback(null), []);

  // ---------------------------------------------------------------------------
  //  Render
  // ---------------------------------------------------------------------------

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]} edges={['top']}>
      <View style={styles.flex}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <Animated.View entering={enterSection(0)} style={styles.headerPad}>
            <HomeHeader
              displayName={displayName}
              profileImage={profileImage}
              onOpenSettings={handleOpenSettings}
            />
          </Animated.View>

          {/* Circle selector — edge-to-edge, manages its own inset */}
          {hasCircles ? (
            <Animated.View entering={enterSection(1)} style={styles.circlesBlock}>
              <View style={styles.circlesLabelRow}>
                <T>
                  <Text style={[styles.circlesLabel, { color: theme.textTertiary }]}>
                    Deine Circles
                  </Text>
                </T>
                <Text style={[styles.circlesCount, { color: theme.textTertiary }]}>
                  {circles!.length.toString().padStart(2, '0')}
                </Text>
              </View>
              <CircleSelector
                circles={circles!}
                activeCircleId={resolvedCircleId}
                onSelect={handleSelectCircle}
              />
              {circlesPage.status !== 'Exhausted' ? (
                <View style={styles.circleLoadMore}>
                  <Button
                    label={isLoadingMoreCircles ? gt('Lädt...') : gt('Weitere Circles')}
                    icon="chevron-down-outline"
                    variant="outline"
                    loading={isLoadingMoreCircles}
                    disabled={isLoadingMoreCircles}
                    onPress={() => circlesPage.loadMore(20)}
                  />
                </View>
              ) : null}
            </Animated.View>
          ) : null}

          {hasCircles ? (
            <Animated.View entering={enterSection(2)} style={styles.activitySection}>
              <ActivityStrip
                activities={activityItems}
                status={activityFeed.status}
                onOpenActivity={handleOpenActivity}
                onOpenActivityTab={() => router.push('/activity' as never)}
              />
            </Animated.View>
          ) : null}

          {/* Feed */}
          <Animated.View entering={enterSection(2)} style={styles.feedSection}>
            {isViewerBootstrapping || circles === undefined || isCirclesLoading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={theme.primary} />
              </View>
            ) : !hasCircles ? (
              <EmptyState
                icon="people-outline"
                message={gt('Erstelle deinen ersten Circle in den Einstellungen, um loszulegen.')}
              />
            ) : !selectedCircle ? (
              <EmptyState
                icon="albums-outline"
                message={gt('Wähle einen Circle aus, um den Feed zu sehen.')}
              />
            ) : isFeedLoading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={theme.primary} />
              </View>
            ) : feedItems.length === 0 ? (
              <EmptyState
                icon="images-outline"
                title={gt('Noch keine Beiträge')}
                message={gt('Teile dein erstes Foto oder Video mit {circleName}.', {
                  circleName: selectedCircle.name,
                })}
              />
            ) : (
              <>
                <View style={styles.feedHeaderRow}>
                  <T>
                    <Text style={[styles.feedEyebrow, { color: theme.textTertiary }]}>
                      Aktuelles aus
                    </Text>
                  </T>
                  <Text
                    style={[styles.feedCircleName, { color: theme.text }]}
                    numberOfLines={1}
                  >
                    {selectedCircle.name}
                  </Text>
                </View>
                <View style={styles.feedList}>
                  {feedItems.map((share, idx) => (
                    <Animated.View key={share._id} entering={enterListItem(idx)}>
                      {idx > 0 ? <Ornament /> : null}
                      <FeedCard
                        share={share}
                        currentUserId={viewer?._id ?? null}
                        currentProfileImage={profileImage}
                        isDeleting={deletingShareId === share._id}
                        onOpenShare={handleOpenShare}
                        onDeleteShare={handleDeletePublishedShare}
                      />
                    </Animated.View>
                  ))}
                  {shareFeed.status !== 'Exhausted' ? (
                    <Button
                      label={isLoadingMoreFeed ? gt('Lädt...') : gt('Mehr laden')}
                      icon="chevron-down-outline"
                      variant="outline"
                      loading={isLoadingMoreFeed}
                      disabled={isLoadingMoreFeed}
                      onPress={() => shareFeed.loadMore(10)}
                    />
                  ) : null}
                </View>
              </>
            )}
          </Animated.View>
        </ScrollView>

        {/* FAB */}
        {hasCircles && selectedCircle ? (
          <ComposeFab
            hasDraft={Boolean(activeDraft)}
            draftAssetCount={activeDraft?.assetCount ?? 0}
            isUploading={isUploading}
            onPress={handleOpenDraftSheet}
          />
        ) : null}

        {/* Draft sheet */}
        <DraftSheet
          visible={isDraftSheetOpen}
          circle={selectedCircle}
          draft={activeDraft}
          caption={draftCaption}
          onChangeCaption={setDraftCaption}
          isDraftLoading={isDraftLoading}
          isUploading={isUploading}
          isPublishing={isPublishing}
          isDeletingDraft={Boolean(activeDraft && deletingShareId === activeDraft._id)}
          canPublish={canPublish}
          uploadQueue={{ items: selectedQueueItems }}
          persistedUploads={visiblePersistedUploads}
          uploadBlocker={uploadBlocker}
          feedback={feedback}
          onDismissFeedback={handleDismissFeedback}
          onPickMedia={() => void handlePickMediaWithReadiness()}
          onOpenBilling={handleOpenBilling}
          onRetryEncryption={crypto.retry}
          onPublish={() => void handlePublishDraft()}
          onDeleteDraft={handleDeleteDraft}
          onDeleteAsset={handleDeleteAsset}
          onRetryFailedUpload={(itemId) => void handleRetryFailedUpload(itemId)}
          onRemoveFailedUpload={(itemId) => void handleRemoveFailedUpload(itemId)}
          onDiscardPersistedUpload={handleDiscardPersistedUpload}
          onClose={() => setIsDraftSheetOpen(false)}
        />

        {publishBurstKey > 0 ? (
        <CelebrationBurst key={publishBurstKey} size={260} topOffset={180} />
      ) : null}
      {/* While the draft sheet is open its native modal covers this toast, so
          the sheet renders the same feedback itself. */}
      {isDraftSheetOpen ? null : (
        <FeedbackToast message={feedback} onDismiss={handleDismissFeedback} />
      )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  scroll: {
    paddingBottom: BottomTabInset + Spacing['3xl'],
  },
  headerPad: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.sm,
  },
  circlesBlock: {
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.xs,
  },
  circleLoadMore: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.sm,
  },
  circlesLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.sm,
  },
  circlesLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
  },
  circlesCount: {
    fontFamily: Fonts.mono,
    fontSize: 10,
    letterSpacing: 1.2,
  },
  feedSection: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
  },
  activitySection: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
  },
  feedHeaderRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.xs,
    paddingBottom: Spacing.md,
  },
  feedEyebrow: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
  },
  feedCircleName: {
    flex: 1,
    fontFamily: Fonts.display,
    fontStyle: 'italic',
    fontSize: FontSize.base,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  feedList: {
    gap: Spacing.sm,
  },
  loadingContainer: {
    paddingVertical: Spacing['4xl'],
    alignItems: 'center',
  },
});
