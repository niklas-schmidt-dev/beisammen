import Ionicons from '@expo/vector-icons/Ionicons';
import * as ImagePicker from 'expo-image-picker';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Branch, Num, Plural, T, Var, msg, useGT, useMessages } from 'gt-react-native';

import {
  useAction,
  useConvex,
  useConvexAuth,
  useMutation,
  usePaginatedQuery,
  useQuery,
} from 'convex/react';

import { Avatar, Button, Card, FeedbackToast, LoadingBox } from '@/components/ui';
import { InviteComposer, type InviteComposerSubmitArgs } from '@/components/invites/InviteComposer';
import { Fonts, FontSize, Radius, Spacing } from '@/constants/theme';
import { enterSection } from '@/lib/motion';
import type { CircleInviteRecord, CircleMemberRecord } from '@/features/convex/api';
import { useSession } from '@/features/auth/session-provider';
import { api } from '@/features/convex/api';
import { rotateCircleKeyNow } from '@/features/crypto/rotation';
import { inviteModeLabel } from '@/features/invites/preview-state';
import { formatBytes, optimizePickerAsset, uploadPreparedFile } from '@/features/media/client';
import { clearCircleDecryptedMedia } from '@/features/media/decrypted-cache';
import { useCircleImage } from '@/features/media/use-circle-image-url';
import { buildMemoryViewerHref } from '@/features/memories/timeline';
import { MemoryTile } from '@/features/memories/MemoryTile';
import { useTheme } from '@/hooks/use-theme';
import { useDateFormat } from '@/i18n/use-date-format';

function firstParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

async function pickSingleImageAsset(permissionErrorMessage: string) {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

  if (!permission.granted) {
    throw new Error(permissionErrorMessage);
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: false,
    quality: 1,
  });

  if (result.canceled || !result.assets.length) {
    return null;
  }

  return result.assets[0] ?? null;
}

const DATE_TIME_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
  dateStyle: 'medium',
  timeStyle: 'short',
};

function formatDateTime(timestamp: number, format: Intl.DateTimeFormat) {
  return format.format(new Date(timestamp));
}

function roleLabel(role: 'owner' | 'admin' | 'member') {
  switch (role) {
    case 'owner':
      return msg('Owner');
    case 'admin':
      return msg('Admin');
    default:
      return msg('Mitglied');
  }
}

function inviteStatusLabel(status: CircleInviteRecord['status']) {
  switch (status) {
    case 'accepted':
      return msg('Angenommen');
    case 'expired':
      return msg('Abgelaufen');
    case 'revoked':
      return msg('Zurückgezogen');
    default:
      return msg('Ausstehend');
  }
}

export default function CircleManagementScreen() {
  const router = useRouter();
  const theme = useTheme();
  const gt = useGT();
  const m = useMessages();
  const { setActiveCircleId } = useSession();
  const convex = useConvex();
  const convexAuth = useConvexAuth();
  const params = useLocalSearchParams<{ circleId?: string | string[] }>();
  const circleId = firstParam(params.circleId);
  const viewerState = useQuery(api.users.viewerState, convexAuth.isAuthenticated ? {} : 'skip');
  const hasViewer = viewerState?.isAuthenticated === true && viewerState.viewer !== null;
  const circle = useQuery(api.circles.getById, circleId && hasViewer ? { circleId } : 'skip');
  const members = useQuery(api.circles.listMembers, circleId && hasViewer ? { circleId } : 'skip');
  const invites = useQuery(api.invites.listForCircle, circleId && hasViewer ? { circleId } : 'skip');
  const updateCircle = useMutation(api.circles.update);
  const updateMemberRole = useMutation(api.circles.updateMemberRole);
  const removeMember = useMutation(api.circles.removeMember);
  const transferOwnership = useMutation(api.circles.transferOwnership);
  const leaveCircle = useMutation(api.circles.leave);
  const createInvite = useMutation(api.invites.create);
  const revokeInvite = useMutation(api.invites.revoke);
  const createCircleImageTarget = useAction(api.circles.createImageTarget);
  const completeCircleImageUpload = useAction(api.circles.completeImageUpload);
  const removeCircleImage = useAction(api.circles.removeImage);
  const deleteCircle = useAction(api.circles.deleteOwn);
  const mediaPage = usePaginatedQuery(
    api.memories.listForViewer,
    circleId && hasViewer ? { circleId } : 'skip',
    { initialNumItems: 12 },
  );
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isSavingDetails, setIsSavingDetails] = useState(false);
  const [isSubmittingInvite, setIsSubmittingInvite] = useState(false);
  const [busyMemberId, setBusyMemberId] = useState<string | null>(null);
  const [busyInviteId, setBusyInviteId] = useState<string | null>(null);
  const [isLeaving, setIsLeaving] = useState(false);
  const [isImageBusy, setIsImageBusy] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const image = useCircleImage(circle?._id, circle?.imageKey);
  const { width: windowWidth } = useWindowDimensions();
  // Screen padding + card padding on both sides, two gaps between three tiles.
  const mediaTileSize = Math.floor(
    (windowWidth - Spacing.lg * 4 - Spacing.xs * 2) / 3,
  );

  useEffect(() => {
    if (!circle) {
      return;
    }

    setName(circle.name);
    setDescription(circle.description);
  }, [circle?._id, circle?.name, circle?.description]);

  const detailsDirty =
    Boolean(circle) &&
    (name.trim() !== (circle?.name ?? '') ||
      description.trim() !== (circle?.description ?? ''));
  const otherMembers = useMemo(
    () => members?.filter((member) => !member.isSelf) ?? [],
    [members],
  );

  const handleSaveDetails = useCallback(async () => {
    if (!circleId || !circle) {
      return;
    }

    setIsSavingDetails(true);
    setFeedback(null);

    try {
      await updateCircle({
        circleId,
        name: name.trim(),
        description: description.trim() || undefined,
      });
      setFeedback(gt('Circle-Details aktualisiert.'));
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : gt('Circle konnte nicht aktualisiert werden.'),
      );
    } finally {
      setIsSavingDetails(false);
    }
  }, [circle, circleId, description, gt, name, updateCircle]);

  const handlePickCircleImage = useCallback(async () => {
    if (!circle?.canManage) {
      return;
    }

    setIsImageBusy(true);
    setFeedback(null);

    try {
      const pickedAsset = await pickSingleImageAsset(
        gt('Ohne Mediathek-Zugriff kann kein Bild ausgewählt werden.'),
      );

      if (!pickedAsset) {
        return;
      }

      const processedAsset = await optimizePickerAsset(pickedAsset);

      if (processedAsset.sizeBytes === undefined || processedAsset.sizeBytes <= 0) {
        throw new Error(gt('Die Dateigröße konnte nicht ermittelt werden.'));
      }

      const prepared = await createCircleImageTarget({
        circleId: circle._id,
        mimeType: processedAsset.mimeType,
        fileName: processedAsset.fileName,
        sizeBytes: processedAsset.sizeBytes,
      });
      const uploaded = await uploadPreparedFile({
        target: prepared.target,
        asset: processedAsset,
      });

      await completeCircleImageUpload({
        uploadId: prepared.uploadId,
        objectKey: uploaded.objectKey,
        sizeBytes: processedAsset.sizeBytes,
      });
      setFeedback(gt('Bild für "{name}" aktualisiert.', { name: circle.name }));
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : gt('Circle-Bild konnte nicht gesetzt werden.'),
      );
    } finally {
      setIsImageBusy(false);
    }
  }, [circle, completeCircleImageUpload, createCircleImageTarget, gt]);

  const handleRemoveCircleImage = useCallback(() => {
    if (!circle?.canManage || !circle.hasImage || isImageBusy) {
      return;
    }

    Alert.alert(
      gt('Circle-Bild entfernen?'),
      gt('Das Bild von "{name}" wird entfernt.', { name: circle.name }),
      [
        { text: gt('Abbrechen'), style: 'cancel' },
        {
          text: gt('Entfernen'),
          style: 'destructive',
          onPress: () => {
            setIsImageBusy(true);
            setFeedback(null);
            void removeCircleImage({ circleId: circle._id })
              .then(() => {
                setFeedback(gt('Bild für "{name}" entfernt.', { name: circle.name }));
              })
              .catch((error) => {
                setFeedback(
                  error instanceof Error
                    ? error.message
                    : gt('Circle-Bild konnte nicht entfernt werden.'),
                );
              })
              .finally(() => {
                setIsImageBusy(false);
              });
          },
        },
      ],
    );
  }, [circle, gt, isImageBusy, removeCircleImage]);

  const handleCreateInvite = useCallback(
    async (args: InviteComposerSubmitArgs) => {
      if (!circleId) {
        throw new Error(gt('Circle ist noch nicht geladen.'));
      }

      setIsSubmittingInvite(true);

      try {
        return await createInvite({
          circleId,
          mode: args.mode,
          invitedEmail: args.invitedEmail,
          role: args.role,
        });
      } finally {
        setIsSubmittingInvite(false);
      }
    },
    [circleId, createInvite, gt],
  );

  const handleToggleRole = useCallback(
    (member: CircleMemberRecord) => {
      const nextRole = member.role === 'admin' ? 'member' : 'admin';
      const message =
        nextRole === 'admin'
          ? gt('{name} wird zum Admin machen.', { name: member.displayName })
          : gt('{name} wird zum Mitglied herunterstufen.', { name: member.displayName });

      Alert.alert(
        gt('Rolle ändern?'),
        message,
        [
          { text: gt('Abbrechen'), style: 'cancel' },
          {
            text: gt('Bestätigen'),
            onPress: () => {
              setBusyMemberId(member._id);
              setFeedback(null);
              void updateMemberRole({
                circleId: circleId!,
                memberId: member._id,
                role: nextRole,
              })
                .then(() => {
                  setFeedback(gt('Rolle für {name} aktualisiert.', { name: member.displayName }));
                })
                .catch((error) => {
                  setFeedback(
                    error instanceof Error
                      ? error.message
                      : gt('Rolle konnte nicht geändert werden.'),
                  );
                })
                .finally(() => {
                  setBusyMemberId(null);
                });
            },
          },
        ],
      );
    },
    [circleId, gt, updateMemberRole],
  );

  const handleRemoveMember = useCallback(
    (member: CircleMemberRecord) => {
      Alert.alert(
        gt('Mitglied entfernen?'),
        gt('{name} verliert sofort den Zugriff auf diesen Circle.', {
          name: member.displayName,
        }),
        [
          { text: gt('Abbrechen'), style: 'cancel' },
          {
            text: gt('Entfernen'),
            style: 'destructive',
            onPress: () => {
              setBusyMemberId(member._id);
              setFeedback(null);
              void removeMember({
                circleId: circleId!,
                memberId: member._id,
              })
                .then(() => {
                  setFeedback(gt('{name} wurde entfernt.', { name: member.displayName }));

                  // Immediate E2EE key rotation so uploads are not gated on
                  // another admin coming online; the server keeps encrypted
                  // uploads blocked until a rotation lands (see docs/e2ee.md),
                  // so a failure here never compromises confidentiality.
                  void rotateCircleKeyNow({
                    convex,
                    circleId: circleId!,
                  });
                })
                .catch((error) => {
                  setFeedback(
                    error instanceof Error
                      ? error.message
                      : gt('Mitglied konnte nicht entfernt werden.'),
                  );
                })
                .finally(() => {
                  setBusyMemberId(null);
                });
            },
          },
        ],
      );
    },
    [circleId, convex, gt, removeMember],
  );

  const handleTransferOwnership = useCallback(
    (member: CircleMemberRecord) => {
      Alert.alert(
        gt('Ownership übertragen?'),
        gt('{name} wird Owner. Dein eigener Zugriff bleibt als Admin bestehen.', {
          name: member.displayName,
        }),
        [
          { text: gt('Abbrechen'), style: 'cancel' },
          {
            text: gt('Uebertragen'),
            onPress: () => {
              setBusyMemberId(member._id);
              setFeedback(null);
              void transferOwnership({
                circleId: circleId!,
                targetMemberId: member._id,
              })
                .then(() => {
                  setFeedback(gt('Ownership an {name} übertragen.', { name: member.displayName }));
                })
                .catch((error) => {
                  setFeedback(
                    error instanceof Error
                      ? error.message
                      : gt('Ownership konnte nicht übertragen werden.'),
                  );
                })
                .finally(() => {
                  setBusyMemberId(null);
                });
            },
          },
        ],
      );
    },
    [circleId, gt, transferOwnership],
  );

  const handleRevokeInvite = useCallback(
    (invite: CircleInviteRecord) => {
      Alert.alert(
        gt('Einladung zurückziehen?'),
        gt('Die Einladung für {email} wird sofort ungültig.', { email: invite.invitedEmail }),
        [
          { text: gt('Abbrechen'), style: 'cancel' },
          {
            text: gt('Zurückziehen'),
            style: 'destructive',
            onPress: () => {
              setBusyInviteId(invite._id);
              setFeedback(null);
              void revokeInvite({ inviteId: invite._id })
                .then(() => {
                  setFeedback(
                    gt('Einladung für {email} wurde zurückgezogen.', {
                      email: invite.invitedEmail,
                    }),
                  );
                })
                .catch((error) => {
                  setFeedback(
                    error instanceof Error
                      ? error.message
                      : gt('Einladung konnte nicht zurückgezogen werden.'),
                  );
                })
                .finally(() => {
                  setBusyInviteId(null);
                });
            },
          },
        ],
      );
    },
    [gt, revokeInvite],
  );

  const handleLeaveCircle = useCallback(() => {
    if (!circleId || !circle?.canLeave) {
      return;
    }

    Alert.alert(
      gt('Circle verlassen?'),
      gt('Du verlässt "{name}" und verlierst den Zugriff.', { name: circle.name }),
      [
        { text: gt('Abbrechen'), style: 'cancel' },
        {
          text: gt('Verlassen'),
          style: 'destructive',
          onPress: () => {
            setIsLeaving(true);
            setFeedback(null);
            void leaveCircle({ circleId })
              .then(() => {
                // Drop the circle's decrypted plaintext right away; removals
                // while the app was closed are caught by the start-up
                // reconciliation instead.
                void clearCircleDecryptedMedia(circleId).catch(() => undefined);
                setActiveCircleId(null);
                router.replace('/settings');
              })
              .catch((error) => {
                setFeedback(
                  error instanceof Error
                    ? error.message
                    : gt('Circle konnte nicht verlassen werden.'),
                );
              })
              .finally(() => {
                setIsLeaving(false);
              });
          },
        },
      ],
    );
  }, [circle?.canLeave, circle?.name, circleId, gt, leaveCircle, router, setActiveCircleId]);

  const handleOpenMemory = useCallback(
    (item: { _id: string }) => {
      router.push(buildMemoryViewerHref({ memoryId: item._id, circleId }) as never);
    },
    [circleId, router],
  );

  const handleDeleteCircle = useCallback(() => {
    if (!circleId || !circle?.isOwner || isDeleting) {
      return;
    }

    Alert.alert(
      gt('Circle wirklich löschen?'),
      gt(
        '"{name}" wird mit allen Beiträgen, Kommentaren, Reaktionen und Medien dauerhaft gelöscht – auch die Inhalte aller anderen Mitglieder. Dieser Vorgang kann nicht rückgängig gemacht werden.',
        { name: circle.name },
      ),
      [
        { text: gt('Abbrechen'), style: 'cancel' },
        {
          text: gt('Circle löschen'),
          style: 'destructive',
          onPress: () => {
            setIsDeleting(true);
            setFeedback(null);
            void deleteCircle({ circleId })
              .then(() => {
                setActiveCircleId(null);
                router.replace('/settings');
              })
              .catch((error) => {
                setFeedback(
                  error instanceof Error
                    ? error.message
                    : gt('Circle konnte nicht gelöscht werden.'),
                );
              })
              .finally(() => {
                setIsDeleting(false);
              });
          },
        },
      ],
    );
  }, [
    circle?.isOwner,
    circle?.name,
    circleId,
    deleteCircle,
    gt,
    isDeleting,
    router,
    setActiveCircleId,
  ]);

  if (!circleId) {
    return <Redirect href="/settings" />;
  }

  // The circle disappeared (deleted or membership revoked) while this screen
  // was open — leave gracefully instead of rendering a half-empty page.
  if (circle === null) {
    return <Redirect href="/settings" />;
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Animated.View entering={enterSection(0)} style={styles.header}>
          <T>
            <Text style={[styles.eyebrow, { color: theme.textTertiary }]}>circle management</Text>
          </T>
          <View style={styles.titleRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={gt('Zurück')}
              hitSlop={12}
              onPress={() => {
                router.back();
              }}
              style={({ pressed }) => [styles.backChevron, { opacity: pressed ? 0.5 : 1 }]}
            >
              <Ionicons name="chevron-back" size={26} color={theme.text} />
            </Pressable>
            <Text style={[styles.title, { color: theme.text }]} numberOfLines={2}>
              {circle?.name ?? 'Circle'}
            </Text>
          </View>
        </Animated.View>

        {!hasViewer ||
        circle === undefined ||
        members === undefined ||
        invites === undefined ? (
          <Card>
            <LoadingBox />
          </Card>
        ) : (
          <>
            <Card>
              <View style={styles.sectionHeader}>
                <T>
                  <Text style={[styles.cardTitle, { color: theme.text }]}>Circle-Details</Text>
                </T>
                <Text style={[styles.sectionMeta, { color: theme.textTertiary }]}>
                  {m(roleLabel(circle.role))}
                </Text>
              </View>

              <View style={styles.heroRow}>
                <Avatar name={circle.name} image={image} size="lg" />
                <View style={styles.heroCopy}>
                  <Text style={[styles.heroTitle, { color: theme.text }]}>{circle.name}</Text>
                  <T>
                    <Text style={[styles.heroSubtitle, { color: theme.textSecondary }]}>
                      <Plural
                        n={circle.memberCount}
                        one={
                          <>
                            <Num>{circle.memberCount}</Num> Mitglied
                          </>
                        }
                        other={
                          <>
                            <Num>{circle.memberCount}</Num> Mitglieder
                          </>
                        }
                      />
                    </Text>
                  </T>
                </View>
              </View>

              {circle.canManage ? (
                <View style={styles.buttonRow}>
                  <View style={styles.buttonCol}>
                    <Button
                      label={circle.hasImage ? gt('Bild ändern') : gt('Bild wählen')}
                      icon="image-outline"
                      variant="ghost"
                      loading={isImageBusy}
                      onPress={() => {
                        void handlePickCircleImage();
                      }}
                    />
                  </View>
                  {circle.hasImage ? (
                    <View style={styles.buttonCol}>
                      <Button
                        label={gt('Entfernen')}
                        icon="trash-outline"
                        variant="danger"
                        loading={isImageBusy}
                        onPress={handleRemoveCircleImage}
                      />
                    </View>
                  ) : null}
                </View>
              ) : null}

              {circle.canEdit ? (
                <>
                  <TextInput
                    value={name}
                    onChangeText={setName}
                    accessibilityLabel={gt('Name des Circles')}
                    placeholder={gt('Name des Circles')}
                    placeholderTextColor={theme.textTertiary}
                    style={[
                      styles.input,
                      {
                        backgroundColor: theme.background,
                        borderColor: theme.border,
                        color: theme.text,
                      },
                    ]}
                  />
                  <TextInput
                    value={description}
                    onChangeText={setDescription}
                    accessibilityLabel={gt('Beschreibung')}
                    placeholder={gt('Beschreibung')}
                    placeholderTextColor={theme.textTertiary}
                    multiline
                    style={[
                      styles.input,
                      styles.textArea,
                      {
                        backgroundColor: theme.background,
                        borderColor: theme.border,
                        color: theme.text,
                      },
                    ]}
                  />
                  <Button
                    label={gt('Details speichern')}
                    icon="save-outline"
                    loading={isSavingDetails}
                    disabled={!name.trim() || !detailsDirty}
                    onPress={() => {
                      void handleSaveDetails();
                    }}
                  />
                </>
              ) : (
                <Text style={[styles.body, { color: theme.textSecondary }]}>
                  {circle.description || gt('Keine Beschreibung hinterlegt.')}
                </Text>
              )}
            </Card>

            <Card>
              <View style={styles.sectionHeader}>
                <T>
                  <Text style={[styles.cardTitle, { color: theme.text }]}>Statistiken</Text>
                </T>
              </View>
              <View style={styles.statGrid}>
                <StatTile value={String(circle.imageCount)} label={gt('Fotos')} />
                <StatTile value={String(circle.videoCount)} label={gt('Videos')} />
                <StatTile
                  value={formatBytes(circle.totalSizeBytes) ?? '0 KB'}
                  label={gt('Speicher')}
                />
                <StatTile value={String(circle.memberCount)} label={gt('Mitglieder')} />
              </View>
            </Card>

            <Card>
              <View style={styles.sectionHeader}>
                <T>
                  <Text style={[styles.cardTitle, { color: theme.text }]}>Medien</Text>
                </T>
                <Text style={[styles.sectionMeta, { color: theme.textTertiary }]}>
                  {String(circle.imageCount + circle.videoCount).padStart(2, '0')}
                </Text>
              </View>
              {mediaPage.status === 'LoadingFirstPage' ? (
                <LoadingBox />
              ) : mediaPage.results.length === 0 ? (
                <T>
                  <Text style={[styles.body, { color: theme.textSecondary }]}>
                    In diesem Circle wurden noch keine Medien geteilt.
                  </Text>
                </T>
              ) : (
                <View style={styles.mediaGrid}>
                  {mediaPage.results.map((item) => (
                    <MemoryTile
                      key={item._id}
                      item={item}
                      size={mediaTileSize}
                      onOpen={handleOpenMemory}
                    />
                  ))}
                </View>
              )}
              {mediaPage.results.length > 0 && mediaPage.status !== 'Exhausted' ? (
                <Button
                  label={mediaPage.status === 'LoadingMore' ? gt('Lädt...') : gt('Mehr anzeigen')}
                  icon="chevron-down-outline"
                  variant="outline"
                  loading={mediaPage.status === 'LoadingMore'}
                  disabled={mediaPage.status === 'LoadingMore'}
                  onPress={() => mediaPage.loadMore(24)}
                />
              ) : null}
            </Card>

            <Card>
              <View style={styles.sectionHeader}>
                <T>
                  <Text style={[styles.cardTitle, { color: theme.text }]}>Mitglieder</Text>
                </T>
                <Text style={[styles.sectionMeta, { color: theme.textTertiary }]}>
                  {members.length.toString().padStart(2, '0')}
                </Text>
              </View>
              {members.map((member, index) => (
                <MemberRow
                  key={member._id}
                  member={member}
                  isBusy={busyMemberId === member._id}
                  hasSeparator={index < members.length - 1}
                  onToggleRole={handleToggleRole}
                  onRemove={handleRemoveMember}
                  onTransferOwnership={handleTransferOwnership}
                />
              ))}
            </Card>

            <Card>
              <View style={styles.sectionHeader}>
                <T>
                  <Text style={[styles.cardTitle, { color: theme.text }]}>Einladen</Text>
                </T>
                <Text style={[styles.sectionMeta, { color: theme.textTertiary }]}>
                  {circle.canInvite ? gt('aktiv') : gt('read only')}
                </Text>
              </View>

              {circle.canInvite ? (
                <InviteComposer
                  circleName={circle.name}
                  disabled={isSubmittingInvite}
                  onCreateInvite={handleCreateInvite}
                  onFeedback={setFeedback}
                />
              ) : (
                <T>
                  <Text style={[styles.body, { color: theme.textSecondary }]}>
                    Nur Owner und Admins dürfen neue Personen einladen.
                  </Text>
                </T>
              )}
            </Card>

            <Card>
              <View style={styles.sectionHeader}>
                <T>
                  <Text style={[styles.cardTitle, { color: theme.text }]}>Einladungen</Text>
                </T>
                <Text style={[styles.sectionMeta, { color: theme.textTertiary }]}>
                  {invites.length.toString().padStart(2, '0')}
                </Text>
              </View>
              {invites.length === 0 ? (
                <T>
                  <Text style={[styles.body, { color: theme.textSecondary }]}>
                    Aktuell gibt es keine offenen Einladungen für diesen Circle.
                  </Text>
                </T>
              ) : (
                invites.map((invite, index) => (
                  <InviteRow
                    key={invite._id}
                    invite={invite}
                    isBusy={busyInviteId === invite._id}
                    hasSeparator={index < invites.length - 1}
                    onRevoke={handleRevokeInvite}
                  />
                ))
              )}
            </Card>

            <Card>
              {circle.isOwner ? (
                <>
                  <T>
                    <Text style={[styles.cardTitle, { color: theme.text }]}>Circle löschen</Text>
                    <Text style={[styles.body, { color: theme.textSecondary }]}>
                      Löscht diesen Circle mit allen Beiträgen, Kommentaren und Medien dauerhaft –
                      auch die Inhalte aller anderen Mitglieder.
                      <Branch
                        branch={otherMembers.length === 0 ? 'empty' : 'members'}
                        empty={''}
                        members={
                          ' Wenn der Circle bestehen bleiben soll, übertrage die Ownership stattdessen oben an ein Mitglied.'
                        }
                      />
                    </Text>
                  </T>
                  <Button
                    label={gt('Circle löschen')}
                    icon="trash-outline"
                    variant="danger"
                    loading={isDeleting}
                    disabled={isDeleting}
                    onPress={handleDeleteCircle}
                  />
                </>
              ) : (
                <>
                  <T>
                    <Text style={[styles.cardTitle, { color: theme.text }]}>Circle verlassen</Text>
                    <Text style={[styles.body, { color: theme.textSecondary }]}>
                      Du kannst diesen Circle jederzeit verlassen. Der Zugriff auf alle Inhalte
                      endet sofort.
                    </Text>
                  </T>
                  <Button
                    label={gt('Circle verlassen')}
                    icon="exit-outline"
                    variant="danger"
                    loading={isLeaving}
                    onPress={handleLeaveCircle}
                  />
                </>
              )}
            </Card>
          </>
        )}
      </ScrollView>
      <FeedbackToast message={feedback} onDismiss={() => setFeedback(null)} />
    </SafeAreaView>
  );
}

function MemberRow({
  member,
  hasSeparator,
  isBusy,
  onToggleRole,
  onRemove,
  onTransferOwnership,
}: {
  member: CircleMemberRecord;
  hasSeparator: boolean;
  isBusy: boolean;
  onToggleRole: (member: CircleMemberRecord) => void;
  onRemove: (member: CircleMemberRecord) => void;
  onTransferOwnership: (member: CircleMemberRecord) => void;
}) {
  const theme = useTheme();
  const gt = useGT();
  const m = useMessages();
  const dateTimeFormat = useDateFormat(DATE_TIME_FORMAT_OPTIONS);

  return (
    <View
      style={[
        styles.row,
        hasSeparator && {
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.borderLight,
        },
      ]}
    >
      <Avatar name={member.displayName} image={member.avatarUrl ?? null} size="sm" />
      <View style={styles.rowCopy}>
        <View style={styles.inlineRow}>
          <Text style={[styles.rowTitle, { color: theme.text }]} numberOfLines={1}>
            {member.displayName}
          </Text>
          {member.isSelf ? (
            <T>
              <Text style={[styles.selfBadge, { color: theme.primary }]}>du</Text>
            </T>
          ) : null}
        </View>
        <T>
          <Text style={[styles.rowMeta, { color: theme.textSecondary }]} numberOfLines={1}>
            <Var>{m(roleLabel(member.role))}</Var> · seit{' '}
            <Var>{formatDateTime(member.joinedAt, dateTimeFormat)}</Var>
          </Text>
        </T>
        {member.email ? (
          <Text style={[styles.rowMeta, { color: theme.textTertiary }]} numberOfLines={1}>
            {member.email}
          </Text>
        ) : null}
      </View>
      <View style={styles.toolsColumn}>
        {member.canChangeRole ? (
          <MiniAction
            label={member.role === 'admin' ? gt('Als Mitglied') : gt('Als Admin')}
            onPress={() => onToggleRole(member)}
            disabled={isBusy}
          />
        ) : null}
        {member.canTransferOwnership ? (
          <MiniAction
            label={gt('Owner geben')}
            variant="outline"
            onPress={() => onTransferOwnership(member)}
            disabled={isBusy}
          />
        ) : null}
        {member.canRemove ? (
          <MiniAction
            label={gt('Entfernen')}
            variant="danger"
            onPress={() => onRemove(member)}
            disabled={isBusy}
          />
        ) : null}
      </View>
    </View>
  );
}

function InviteRow({
  invite,
  hasSeparator,
  isBusy,
  onRevoke,
}: {
  invite: CircleInviteRecord;
  hasSeparator: boolean;
  isBusy: boolean;
  onRevoke: (invite: CircleInviteRecord) => void;
}) {
  const theme = useTheme();
  const gt = useGT();
  const m = useMessages();
  const dateTimeFormat = useDateFormat(DATE_TIME_FORMAT_OPTIONS);

  return (
    <View
      style={[
        styles.row,
        hasSeparator && {
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.borderLight,
        },
      ]}
    >
      <View style={styles.inviteMarker}>
        <Ionicons
          name={invite.mode === 'open' ? 'link-outline' : 'mail-open-outline'}
          size={16}
          color={theme.primary}
        />
      </View>
      <View style={styles.rowCopy}>
        <Text style={[styles.rowTitle, { color: theme.text }]} numberOfLines={1}>
          {invite.invitedEmail ?? m(inviteModeLabel(invite.mode))}
        </Text>
        <Text style={[styles.rowMeta, { color: theme.textSecondary }]}>
          {m(roleLabel(invite.role))} · {m(inviteStatusLabel(invite.status))}
          {invite.acceptedBy ? ` · ${invite.acceptedBy.displayName}` : ''}
        </Text>
        <T>
          <Text style={[styles.rowMeta, { color: theme.textTertiary }]} numberOfLines={1}>
            Von <Var>{invite.invitedBy.displayName}</Var> · bis{' '}
            <Var>{formatDateTime(invite.expiresAt, dateTimeFormat)}</Var>
          </Text>
        </T>
      </View>
      {invite.canRevoke ? (
        <MiniAction
          label={gt('Zurückziehen')}
          variant="danger"
          onPress={() => onRevoke(invite)}
          disabled={isBusy}
        />
      ) : null}
    </View>
  );
}

function StatTile({ value, label }: { value: string; label: string }) {
  const theme = useTheme();

  return (
    <View style={styles.statTile}>
      <Text
        style={[styles.statValue, { color: theme.text }]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </Text>
      <Text style={[styles.statLabel, { color: theme.textTertiary }]}>{label}</Text>
    </View>
  );
}

function MiniAction({
  disabled,
  label,
  onPress,
  variant = 'ghost',
}: {
  disabled: boolean;
  label: string;
  onPress: () => void;
  variant?: 'ghost' | 'outline' | 'danger';
}) {
  const theme = useTheme();
  const colors =
    variant === 'danger'
      ? { backgroundColor: theme.dangerMuted, borderColor: 'transparent', color: theme.danger }
      : variant === 'outline'
        ? { backgroundColor: 'transparent', borderColor: theme.border, color: theme.text }
        : { backgroundColor: theme.primaryMuted, borderColor: 'transparent', color: theme.primary };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.miniAction,
        {
          backgroundColor: colors.backgroundColor,
          borderColor: colors.borderColor,
          opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
        },
      ]}
    >
      <Text style={[styles.miniActionLabel, { color: colors.color }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  content: {
    padding: Spacing.lg,
    gap: Spacing.lg,
  },
  header: {
    gap: Spacing.xs,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginLeft: -6,
  },
  backChevron: {
    height: 38,
    justifyContent: 'center',
  },
  eyebrow: {
    fontFamily: Fonts.mono,
    fontSize: FontSize.xs,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  title: {
    flex: 1,
    fontFamily: Fonts.display,
    fontSize: FontSize['2xl'],
    letterSpacing: -0.6,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  cardTitle: {
    fontFamily: Fonts.display,
    fontSize: FontSize.xl,
    letterSpacing: -0.4,
  },
  sectionMeta: {
    fontFamily: Fonts.mono,
    fontSize: FontSize.xs,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  heroCopy: {
    flex: 1,
    gap: 2,
  },
  heroTitle: {
    fontSize: FontSize.lg,
    fontWeight: '700',
  },
  heroSubtitle: {
    fontSize: FontSize.sm,
  },
  input: {
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    fontSize: FontSize.base,
  },
  textArea: {
    minHeight: 96,
    textAlignVertical: 'top',
  },
  body: {
    fontSize: FontSize.base,
    lineHeight: 22,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  buttonCol: {
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
  },
  rowCopy: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    fontSize: FontSize.base,
    fontWeight: '700',
  },
  rowMeta: {
    fontSize: FontSize.xs,
    lineHeight: 18,
  },
  toolsColumn: {
    gap: Spacing.xs,
    alignItems: 'flex-end',
  },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  selfBadge: {
    fontFamily: Fonts.mono,
    fontSize: FontSize.xs,
    letterSpacing: 0.9,
    textTransform: 'uppercase',
  },
  miniAction: {
    minWidth: 108,
    borderRadius: Radius.md,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    alignItems: 'center',
  },
  miniActionLabel: {
    fontSize: FontSize.xs,
    fontWeight: '700',
  },
  inviteMarker: {
    width: 34,
    height: 34,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  statTile: {
    width: '50%',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.md,
  },
  statValue: {
    fontFamily: Fonts.display,
    fontSize: FontSize.xl,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  statLabel: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  mediaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
  },
});
