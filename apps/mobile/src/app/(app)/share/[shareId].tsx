import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useLocalSearchParams, usePathname, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useGT } from 'gt-react-native';

import { useAction, useConvexAuth, useMutation, useQuery } from 'convex/react';
import { VideoView } from 'expo-video';
import { SHARE_CAPTION_MAX_LENGTH, normalizeShareCaption } from '@beisammen/contracts';

import { Fonts, FontSize, Radius, Spacing } from '@/constants/theme';
import type { ShareAssetRecord } from '@/features/convex/api';
import { api } from '@/features/convex/api';
import { useSession } from '@/features/auth/session-provider';
import {
  downloadAssetToCache,
  formatMediaLocation,
  saveAssetToDeviceLibrary,
  shareLocalFile,
} from '@/features/media/client';
import { useCircleKeys } from '@/features/crypto/use-circle-keys';
import { useAssetMediaUri } from '@/features/media/use-asset-media-uri';
import { useLivePhotoPlayback } from '@/features/media/use-live-photo-playback';
import { useVideoPlayerSource } from '@/features/media/use-video-player-source';
import { isVideoProxyUrl } from '@/features/media/video-proxy/server';
import { useUserProfileImage } from '@/features/media/use-user-profile-image-url';
import { useTheme } from '@/hooks/use-theme';
import { useDateFormat } from '@/i18n/use-date-format';
import { enterSection, exitFade } from '@/lib/motion';

import {
  AnimatedPressable,
  Avatar,
  FeedbackToast,
  LivePhotoBadge,
  LoadingBox,
  MediaLoadingIndicator,
} from '@/components/ui';
import { EngagementPanel } from '@/components/share/EngagementPanel';
import { FullscreenMediaViewer } from '@/components/share/FullscreenMediaViewer';
import { ReactionBar } from '@/components/share/ReactionBar';

function splitLead(caption: string): { lead: string; tail: string | null } {
  const trimmed = caption.trim();
  const match = trimmed.match(/^([^.!?]{3,80}[.!?])\s+(.+)$/s);
  if (!match) {
    return { lead: trimmed, tail: null };
  }
  return { lead: match[1], tail: match[2] };
}

function CaptionBlock({
  caption,
  accentColor,
  baseColor,
}: {
  caption: string;
  accentColor: string;
  baseColor: string;
}) {
  const { lead, tail } = splitLead(caption);
  return (
    <View style={styles.captionBlock}>
      <Text style={[styles.captionLead, { color: baseColor }]}>{lead}</Text>
      {tail ? (
        <Text style={[styles.captionTail, { color: accentColor }]}>{tail}</Text>
      ) : null}
    </View>
  );
}

/** Replaces the caption block while the author rewrites the post text. */
function CaptionEditor({
  initialCaption,
  isSaving,
  onCancel,
  onSave,
}: {
  initialCaption: string;
  isSaving: boolean;
  onCancel: () => void;
  onSave: (caption: string) => void;
}) {
  const theme = useTheme();
  const gt = useGT();
  const [caption, setCaption] = useState(initialCaption);
  const canSave = !isSaving && caption.trim() !== initialCaption.trim();

  return (
    <View
      style={[
        styles.captionEditor,
        { backgroundColor: theme.surface, borderColor: theme.borderLight },
      ]}
    >
      <TextInput
        accessibilityLabel={gt('Beitragstext')}
        value={caption}
        onChangeText={setCaption}
        placeholder={gt('Schreib etwas dazu...')}
        placeholderTextColor={theme.textTertiary}
        autoFocus
        multiline
        maxLength={SHARE_CAPTION_MAX_LENGTH}
        editable={!isSaving}
        style={[styles.captionEditorInput, { color: theme.text }]}
      />
      <View style={styles.captionEditorActions}>
        <Text style={[styles.captionEditorCounter, { color: theme.textTertiary }]}>
          {caption.length}/{SHARE_CAPTION_MAX_LENGTH}
        </Text>
        <AnimatedPressable
          accessibilityRole="button"
          accessibilityLabel={gt('Abbrechen')}
          disabled={isSaving}
          onPress={onCancel}
          pressedScale={0.96}
          style={[styles.captionEditorButton, { backgroundColor: theme.surfacePressed }]}
        >
          <Text style={[styles.captionEditorButtonText, { color: theme.textSecondary }]}>
            {gt('Abbrechen')}
          </Text>
        </AnimatedPressable>
        <AnimatedPressable
          accessibilityRole="button"
          accessibilityLabel={gt('Speichern')}
          disabled={!canSave}
          onPress={() => onSave(caption)}
          pressedScale={0.96}
          style={[styles.captionEditorButton, { backgroundColor: theme.primary }]}
        >
          {isSaving ? (
            <ActivityIndicator size="small" color={theme.primaryText} />
          ) : (
            <Text style={[styles.captionEditorButtonText, { color: theme.primaryText }]}>
              {gt('Speichern')}
            </Text>
          )}
        </AnimatedPressable>
      </View>
    </View>
  );
}

function formatDuration(durationSeconds?: number): string | null {
  if (!durationSeconds || durationSeconds <= 0) {
    return null;
  }

  const totalSeconds = Math.round(durationSeconds);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

const ASSET_DATE_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
  dateStyle: 'medium',
};

/** Compact dots under the media pager; only rendered for multi-asset shares. */
function PagerDots({ count, index }: { count: number; index: number }) {
  const theme = useTheme();

  if (count <= 1) {
    return null;
  }

  return (
    <View style={styles.dotsRow} pointerEvents="none">
      {Array.from({ length: count }, (_, dotIndex) => (
        <View
          key={dotIndex}
          style={[
            styles.dot,
            {
              backgroundColor: dotIndex === index ? theme.primary : theme.border,
            },
          ]}
        />
      ))}
    </View>
  );
}

function MediaSlide({
  asset,
  circleId,
  height,
  isActive,
  isFocused,
  onExpand,
  width,
}: {
  asset: ShareAssetRecord;
  circleId: string;
  height: number;
  isActive: boolean;
  isFocused: boolean;
  onExpand: () => void;
  width: number;
}) {
  const theme = useTheme();
  const gt = useGT();
  const signedUrl = useAssetMediaUri(asset, 'original', circleId);
  const previewUrl = useAssetMediaUri(asset, 'preview', circleId);
  const { player, hasFirstFrame, playerStatus, onFirstFrameRender } = useVideoPlayerSource({
    assetId: asset._id,
    kind: asset.kind,
    signedUrl,
  });
  const livePhoto = useLivePhotoPlayback({
    asset,
    circleId,
    prefetch: isActive && isFocused && asset.kind === 'image',
  });

  useEffect(() => {
    if (asset.kind === 'video' && (!isActive || !isFocused)) {
      try {
        player.pause();
      } catch {
        // Native players can be released during fast swipes.
      }
    }
  }, [asset.kind, isActive, isFocused, player]);

  if (asset.kind === 'video') {
    return (
      <View style={[styles.slide, { width, height, backgroundColor: '#050505' }]}>
        {signedUrl ? (
          <VideoView
            player={player}
            style={styles.slideMedia}
            nativeControls
            contentFit="contain"
            onFirstFrameRender={onFirstFrameRender}
          />
        ) : null}

        {!hasFirstFrame && previewUrl ? (
          <Animated.View exiting={exitFade()} style={styles.slideMediaFill}>
            <Image source={{ uri: previewUrl }} style={styles.slideMedia} contentFit="contain" />
          </Animated.View>
        ) : null}

        <MediaLoadingIndicator visible={!hasFirstFrame || playerStatus === 'loading'} />
        {/* Top-right so it never overlaps the native controls' bottom bar. */}
        <AnimatedPressable
          accessibilityRole="button"
          accessibilityLabel={gt('Video im Vollbild öffnen')}
          onPress={onExpand}
          pressedScale={0.92}
          style={[styles.expandBadge, styles.expandBadgeVideo]}
        >
          <Ionicons name="expand-outline" size={16} color="#FFFFFF" />
        </AnimatedPressable>
      </View>
    );
  }

  return (
    <AnimatedPressable
      accessibilityRole="imagebutton"
      accessibilityLabel={
        livePhoto.isLivePhoto
          ? gt('Live-Foto: Antippen für Vollbild, gedrückt halten zum Abspielen')
          : gt('Foto im Vollbild öffnen')
      }
      onPress={onExpand}
      // Press-and-hold plays a Live Photo's companion clip; a plain tap still
      // expands (a fired long press suppresses onPress).
      delayLongPress={220}
      onLongPress={livePhoto.isLivePhoto ? livePhoto.start : undefined}
      onPressOut={livePhoto.isLivePhoto ? livePhoto.stop : undefined}
      pressedScale={0.99}
      pressedOpacity={0.97}
      style={[styles.slide, { width, height, backgroundColor: theme.surfacePressed }]}
    >
      {signedUrl ? (
        <Image
          source={{ uri: signedUrl }}
          style={styles.slideMedia}
          contentFit="cover"
          transition={280}
          recyclingKey={asset._id}
        />
      ) : previewUrl ? (
        <Image
          source={{ uri: previewUrl }}
          style={styles.slideMedia}
          contentFit="cover"
          recyclingKey={`${asset._id}-preview`}
        />
      ) : (
        <View style={styles.slideFallback}>
          <Ionicons name="image-outline" size={32} color={theme.textTertiary} />
        </View>
      )}
      {livePhoto.isPlaying ? (
        <View style={styles.slideMediaFill} pointerEvents="none">
          <VideoView
            player={livePhoto.player}
            style={styles.slideMedia}
            nativeControls={false}
            contentFit="cover"
          />
        </View>
      ) : null}
      <MediaLoadingIndicator visible={livePhoto.isLoading} />
      {livePhoto.isLivePhoto ? <LivePhotoBadge style={styles.liveBadge} /> : null}
      <View style={styles.expandBadge} pointerEvents="none">
        <Ionicons name="expand-outline" size={16} color="#FFFFFF" />
      </View>
    </AnimatedPressable>
  );
}

/** Round secondary action (save / share) sitting next to the reaction bar. */
function MediaAction({
  icon,
  label,
  loading,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  loading: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={loading}
      onPress={onPress}
      pressedScale={0.92}
      style={[styles.mediaAction, { backgroundColor: theme.surfacePressed }]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={theme.text} />
      ) : (
        <Ionicons name={icon} size={19} color={theme.text} />
      )}
    </AnimatedPressable>
  );
}

export default function ShareDetailScreen() {
  const router = useRouter();
  const { session } = useSession();
  const convexAuth = useConvexAuth();
  const params = useLocalSearchParams<{
    shareId?: string | string[];
    assetId?: string | string[];
    edit?: string | string[];
  }>();
  const shareId = Array.isArray(params.shareId) ? params.shareId[0] : params.shareId;
  const requestedAssetId = Array.isArray(params.assetId) ? params.assetId[0] : params.assetId;
  const requestedEdit = (Array.isArray(params.edit) ? params.edit[0] : params.edit) === '1';
  const theme = useTheme();
  const gt = useGT();
  const pathname = usePathname();
  const isFocused = pathname.startsWith('/share/');
  const assetDateFormat = useDateFormat(ASSET_DATE_FORMAT_OPTIONS);
  const { width: windowWidth } = useWindowDimensions();
  const mediaWidth = windowWidth - Spacing.lg * 2;
  const mediaHeight = Math.min(Math.round(mediaWidth * 1.25), 520);

  const [isDeleted, setIsDeleted] = useState(false);
  const viewerState = useQuery(api.users.viewerState, convexAuth.isAuthenticated ? {} : 'skip');
  const hasViewer = viewerState?.isAuthenticated === true && viewerState.viewer !== null;
  const isViewerBootstrapping =
    Boolean(session && convexAuth.isAuthenticated) &&
    (viewerState === undefined || (viewerState.isAuthenticated && viewerState.viewer === null));
  const share = useQuery(
    api.shares.getById,
    shareId && hasViewer && !isDeleted ? { shareBatchId: shareId } : 'skip',
  );
  const circle = useQuery(
    api.circles.getById,
    share ? { circleId: share.circleId } : 'skip',
  );
  const getReadUrl = useAction(api.assets.getReadUrl);
  const deleteShare = useAction(api.shares.delete);
  const updateCaption = useMutation(api.shares.updateCaption);

  const [activeAssetId, setActiveAssetId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isViewerOpen, setIsViewerOpen] = useState(false);
  // Opened via the feed's "Text bearbeiten" menu entry, or the pencil here.
  const [isEditingCaption, setIsEditingCaption] = useState(requestedEdit);
  const [isSavingCaption, setIsSavingCaption] = useState(false);
  const pagerRef = useRef<FlatList<ShareAssetRecord>>(null);

  useEffect(() => {
    if (!isViewerBootstrapping && share === null) {
      router.replace('/home');
    }
  }, [isViewerBootstrapping, router, share]);

  useEffect(() => {
    if (!share) {
      return;
    }

    setActiveAssetId((current) =>
      current && share.assets.some((asset) => asset._id === current)
        ? current
        : requestedAssetId && share.assets.some((asset) => asset._id === requestedAssetId)
          ? requestedAssetId
        : share.assets[0]?._id ?? null,
    );
  }, [requestedAssetId, share]);

  const activeAsset = useMemo(
    () => share?.assets.find((asset) => asset._id === activeAssetId) ?? share?.assets[0] ?? null,
    [activeAssetId, share],
  );
  const activeIndex = useMemo(() => {
    if (!share || !activeAsset) {
      return 0;
    }
    const index = share.assets.findIndex((asset) => asset._id === activeAsset._id);
    return index >= 0 ? index : 0;
  }, [activeAsset, share]);
  const activeAssetUrl = useAssetMediaUri(activeAsset, 'original', share?.circleId);
  // Save/share need the circle keys to decrypt encrypted assets imperatively.
  const circleKeys = useCircleKeys(activeAsset?.encryption ? share?.circleId : null);
  const keysByEpoch = circleKeys.status === 'ready' ? circleKeys.keysByEpoch : undefined;
  const customAuthorImage = useUserProfileImage(share?.authorId, share?.authorProfileImageKey);
  const authorImage = customAuthorImage ?? share?.authorAvatarUrl ?? null;

  // Keep the pager in sync when the active asset changes elsewhere
  // (deep link with assetId, swiping inside the fullscreen viewer).
  useEffect(() => {
    pagerRef.current?.scrollToOffset({ offset: activeIndex * mediaWidth, animated: false });
  }, [activeIndex, mediaWidth]);

  const downloadActiveAsset = useCallback(async () => {
    if (!activeAsset) {
      throw new Error(gt('Medium ist noch nicht geladen.'));
    }

    // The local video proxy serves plaintext; the download path decrypts
    // itself, so it needs the real signed ciphertext URL instead.
    const signed =
      activeAssetUrl && !isVideoProxyUrl(activeAssetUrl)
        ? { url: activeAssetUrl }
        : await getReadUrl({ assetId: activeAsset._id, variant: 'original' });
    if (!signed.url) {
      throw new Error(gt('Datei ist nicht mehr im Speicher vorhanden.'));
    }
    return await downloadAssetToCache({
      asset: activeAsset,
      url: signed.url,
      ...(keysByEpoch ? { keysByEpoch } : {}),
    });
  }, [activeAsset, activeAssetUrl, getReadUrl, gt, keysByEpoch]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      await saveAssetToDeviceLibrary(await downloadActiveAsset());
      setFeedback(gt('Medium wurde auf dem Gerät gespeichert.'));
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : gt('Medium konnte nicht gespeichert werden.'),
      );
    } finally {
      setIsSaving(false);
    }
  }, [downloadActiveAsset, gt]);

  const handleShare = useCallback(async () => {
    setIsSharing(true);
    try {
      await shareLocalFile(await downloadActiveAsset());
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : gt('Medium konnte nicht geteilt werden.'),
      );
    } finally {
      setIsSharing(false);
    }
  }, [downloadActiveAsset, gt]);

  const performDelete = useCallback(async () => {
    if (!share) {
      return;
    }

    setIsDeleting(true);
    setIsDeleted(true);
    try {
      await deleteShare({ shareBatchId: share._id });
      router.replace('/home');
    } catch (error) {
      setIsDeleted(false);
      setFeedback(
        error instanceof Error ? error.message : gt('Beitrag konnte nicht gelöscht werden.'),
      );
    } finally {
      setIsDeleting(false);
    }
  }, [deleteShare, gt, router, share]);

  const handleSaveCaption = useCallback(
    async (caption: string) => {
      if (!share) {
        return;
      }

      setIsSavingCaption(true);
      try {
        const normalized = normalizeShareCaption(caption);
        await updateCaption({
          shareBatchId: share._id,
          ...(normalized !== undefined ? { caption: normalized } : {}),
        });
        setIsEditingCaption(false);
        setFeedback(gt('Beitragstext wurde gespeichert.'));
      } catch (error) {
        setFeedback(
          error instanceof Error ? error.message : gt('Beitragstext konnte nicht gespeichert werden.'),
        );
      } finally {
        setIsSavingCaption(false);
      }
    },
    [gt, share, updateCaption],
  );

  const handleDelete = useCallback(() => {
    if (!share?.canDelete) {
      return;
    }

    Alert.alert(
      gt('Beitrag löschen?'),
      gt('Dieser Beitrag und alle Medien werden dauerhaft entfernt.'),
      [
        { text: gt('Abbrechen'), style: 'cancel' },
        {
          text: gt('Löschen'),
          style: 'destructive',
          onPress: () => {
            void performDelete();
          },
        },
      ],
    );
  }, [gt, performDelete, share?.canDelete]);

  const handlePagerIndexChange = useCallback(
    (index: number) => {
      const asset = share?.assets[index];
      if (asset) {
        setActiveAssetId(asset._id);
      }
    },
    [share?.assets],
  );

  if (isViewerBootstrapping || (shareId && hasViewer && share === undefined)) {
    return <LoadingBox />;
  }

  if (!shareId || share === undefined || share === null) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]} edges={['top']}>
        <View style={styles.loadingState}>
          <LoadingBox />
        </View>
      </SafeAreaView>
    );
  }

  const activeAssetMeta = [
    activeAsset?.capturedAt && activeAsset.capturedAt > 0
      ? assetDateFormat.format(new Date(activeAsset.capturedAt))
      : null,
    formatDuration(activeAsset?.durationSeconds),
    formatMediaLocation(activeAsset?.location),
  ]
    .filter(Boolean)
    .join('  ·  ');

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        automaticallyAdjustKeyboardInsets
      >
        <View style={styles.headerRow}>
          <AnimatedPressable
            accessibilityRole="button"
            accessibilityLabel={gt('Zurück')}
            hitSlop={12}
            onPress={() => router.back()}
            pressedScale={0.94}
            style={styles.backChevron}
          >
            <Ionicons name="chevron-back" size={24} color={theme.text} />
          </AnimatedPressable>
          {circle ? (
            <Text style={[styles.circleLabel, { color: theme.text }]} numberOfLines={1}>
              {circle.name}
            </Text>
          ) : (
            <View style={styles.circleLabelPlaceholder} />
          )}

          {share.canEdit || share.canDelete ? (
            <View style={styles.headerActions}>
              {share.canEdit ? (
                <AnimatedPressable
                  accessibilityRole="button"
                  accessibilityLabel={gt('Beitragstext bearbeiten')}
                  disabled={isEditingCaption || isDeleting}
                  onPress={() => setIsEditingCaption(true)}
                  pressedScale={0.92}
                  style={[styles.iconButton, { backgroundColor: theme.surfacePressed }]}
                >
                  <Ionicons name="pencil-outline" size={18} color={theme.text} />
                </AnimatedPressable>
              ) : null}
              {share.canDelete ? (
                <AnimatedPressable
                  accessibilityRole="button"
                  accessibilityLabel={gt('Beitrag löschen')}
                  disabled={isDeleting}
                  onPress={handleDelete}
                  pressedScale={0.92}
                  style={[styles.iconButton, { backgroundColor: theme.dangerMuted }]}
                >
                  <Ionicons name="trash-outline" size={18} color={theme.danger} />
                </AnimatedPressable>
              ) : null}
            </View>
          ) : (
            <View style={styles.iconButtonPlaceholder}>
              <Ionicons name="lock-closed-outline" size={16} color={theme.textSecondary} />
            </View>
          )}
        </View>

        {/* The media leads: a tall swipeable pager, tap a photo for fullscreen. */}
        <Animated.View entering={enterSection(0)} style={styles.mediaBlock}>
          <View
            style={[
              styles.pagerCard,
              {
                height: mediaHeight,
                ...Platform.select({
                  ios: { shadowColor: theme.text },
                  android: {},
                }),
              },
            ]}
          >
            {share.assets.length > 0 ? (
              <FlatList
                ref={pagerRef}
                data={share.assets}
                keyExtractor={(asset) => asset._id}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                getItemLayout={(_, index) => ({
                  length: mediaWidth,
                  offset: mediaWidth * index,
                  index,
                })}
                onMomentumScrollEnd={(event) => {
                  const index = Math.max(
                    0,
                    Math.min(
                      Math.round(event.nativeEvent.contentOffset.x / mediaWidth),
                      share.assets.length - 1,
                    ),
                  );
                  handlePagerIndexChange(index);
                }}
                renderItem={({ index, item }) => (
                  <MediaSlide
                    asset={item}
                    circleId={share.circleId}
                    width={mediaWidth}
                    height={mediaHeight}
                    isActive={index === activeIndex}
                    isFocused={isFocused && !isViewerOpen}
                    onExpand={() => setIsViewerOpen(true)}
                  />
                )}
              />
            ) : (
              <View style={[styles.slideFallback, { backgroundColor: theme.surfacePressed }]}>
                <Ionicons name="images-outline" size={32} color={theme.textTertiary} />
              </View>
            )}

            {share.assets.length > 1 ? (
              <View style={styles.counterChip} pointerEvents="none">
                <Ionicons name="albums-outline" size={12} color="#FFFFFF" />
                <Text allowFontScaling={false} style={styles.counterChipText}>
                  {activeIndex + 1}/{share.assets.length}
                </Text>
              </View>
            ) : null}
          </View>

          <PagerDots count={share.assets.length} index={activeIndex} />
        </Animated.View>

        {/* Reactions and save/share live right at the photo. */}
        <Animated.View entering={enterSection(1)} style={styles.socialRow}>
          <View style={styles.reactionSlot}>
            <ReactionBar shareBatchId={share._id} onFeedback={setFeedback} />
          </View>
          <View style={styles.mediaActions}>
            <MediaAction
              icon="download-outline"
              label={gt('Speichern')}
              loading={isSaving}
              onPress={() => {
                void handleSave();
              }}
            />
            <MediaAction
              icon="share-social-outline"
              label={gt('Teilen')}
              loading={isSharing}
              onPress={() => {
                void handleShare();
              }}
            />
          </View>
        </Animated.View>

        <Animated.View entering={enterSection(2)} style={styles.storyBlock}>
          <View style={styles.authorRow}>
            <Avatar name={share.authorName ?? '?'} image={authorImage} size="md" expandable />
            <View style={styles.authorInfo}>
              <Text style={[styles.authorName, { color: theme.text }]} numberOfLines={1}>
                {share.authorName}
              </Text>
              <Text style={[styles.timestamp, { color: theme.textTertiary }]} numberOfLines={1}>
                {share.createdAtLabel}
                {share.editedAt ? ` · ${gt('bearbeitet')}` : ''}
              </Text>
            </View>
          </View>

          {isEditingCaption && share.canEdit ? (
            <CaptionEditor
              initialCaption={share.caption}
              isSaving={isSavingCaption}
              onCancel={() => setIsEditingCaption(false)}
              onSave={(caption) => {
                void handleSaveCaption(caption);
              }}
            />
          ) : share.caption ? (
            <CaptionBlock caption={share.caption} accentColor={theme.accent} baseColor={theme.text} />
          ) : null}

          {activeAssetMeta ? (
            <Text style={[styles.assetMeta, { color: theme.textTertiary }]}>{activeAssetMeta}</Text>
          ) : null}
        </Animated.View>

        <Animated.View entering={enterSection(3)}>
          <EngagementPanel share={share} activeAsset={activeAsset} onFeedback={setFeedback} />
        </Animated.View>
      </ScrollView>

      <FullscreenMediaViewer
        visible={isViewerOpen}
        assets={share.assets}
        circleId={share.circleId}
        initialIndex={activeIndex}
        onIndexChange={handlePagerIndexChange}
        onClose={() => setIsViewerOpen(false)}
      />

      <FeedbackToast message={feedback} onDismiss={() => setFeedback(null)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  loadingState: {
    flex: 1,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xl,
  },
  scroll: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing['3xl'],
    gap: Spacing.lg,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  backChevron: {
    height: 40,
    justifyContent: 'center',
    marginLeft: -6,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButtonPlaceholder: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleLabel: {
    flex: 1,
    textAlign: 'center',
    fontFamily: Fonts.display,
    fontStyle: 'italic',
    fontSize: FontSize.md,
    paddingHorizontal: Spacing.sm,
  },
  circleLabelPlaceholder: {
    flex: 1,
  },
  mediaBlock: {
    gap: Spacing.md,
  },
  pagerCard: {
    borderRadius: Radius.xl,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.14,
        shadowRadius: 22,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  slide: {
    overflow: 'hidden',
  },
  slideMedia: {
    width: '100%',
    height: '100%',
  },
  slideMediaFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  slideFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveBadge: {
    position: 'absolute',
    left: Spacing.md,
    bottom: Spacing.md,
  },
  expandBadge: {
    position: 'absolute',
    right: Spacing.md,
    bottom: Spacing.md,
    width: 32,
    height: 32,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(12,12,14,0.55)',
  },
  expandBadgeVideo: {
    bottom: undefined,
    top: Spacing.md,
  },
  counterChip: {
    position: 'absolute',
    top: Spacing.md,
    left: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: Radius.full,
    backgroundColor: 'rgba(12,12,14,0.55)',
  },
  counterChipText: {
    color: '#FFFFFF',
    fontFamily: Fonts.mono,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  dotsRow: {
    flexDirection: 'row',
    alignSelf: 'center',
    alignItems: 'center',
    gap: 5,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: Radius.full,
  },
  socialRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
  },
  reactionSlot: {
    flex: 1,
    minWidth: 0,
  },
  mediaActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  mediaAction: {
    width: 44,
    height: 44,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  storyBlock: {
    gap: Spacing.md,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  authorInfo: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  authorName: {
    fontFamily: Fonts.display,
    fontSize: FontSize.md,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  timestamp: {
    fontFamily: Fonts.mono,
    fontSize: 10,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  captionBlock: {
    gap: 4,
  },
  captionLead: {
    fontFamily: Fonts.display,
    fontSize: FontSize.xl,
    fontWeight: '700',
    letterSpacing: -0.3,
    lineHeight: 30,
  },
  captionTail: {
    fontFamily: Fonts.display,
    fontStyle: 'italic',
    fontSize: FontSize.lg,
    lineHeight: 28,
  },
  assetMeta: {
    fontFamily: Fonts.mono,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.4,
  },
  captionEditor: {
    borderWidth: 1,
    borderRadius: Radius.xl,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  captionEditorInput: {
    fontSize: FontSize.md,
    lineHeight: 26,
    minHeight: 100,
    textAlignVertical: 'top',
  },
  captionEditorActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  captionEditorCounter: {
    flex: 1,
    fontFamily: Fonts.mono,
    fontSize: FontSize.xs,
    letterSpacing: 0.5,
  },
  captionEditorButton: {
    minWidth: 88,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: 9,
  },
  captionEditorButtonText: {
    fontSize: FontSize.sm,
    fontWeight: '700',
  },
});
