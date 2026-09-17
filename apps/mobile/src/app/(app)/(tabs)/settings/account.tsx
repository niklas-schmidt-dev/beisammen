import Ionicons from '@expo/vector-icons/Ionicons';
import * as ImagePicker from 'expo-image-picker';
import { useUser } from '@clerk/expo';
import { useCallback, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { T, useGT } from 'gt-react-native';

import { useAction, useConvexAuth, useQuery } from 'convex/react';

import { FontSize, Fonts, Spacing } from '@/constants/theme';
import { enterSection } from '@/lib/motion';
import { useSession } from '@/features/auth/session-provider';
import { logOutPurchases } from '@/features/billing/purchases';
import { api } from '@/features/convex/api';
import { optimizeAvatarImageAsset, uploadPreparedFile } from '@/features/media/client';
import { clearUploadRecoveryForInstance } from '@/features/media/upload-recovery-runtime';
import { userFacingErrorMessage } from '@/lib/user-facing-error';
import { useProfileImage } from '@/features/media/use-profile-image-url';
import { useTheme } from '@/hooks/use-theme';

import { Avatar, Button, Card, FeedbackToast, SectionHeader } from '@/components/ui';
import { SettingsScreenHeader } from '@/components/settings/SettingsScreenHeader';

async function pickSingleImageAsset(permissionDeniedMessage: string) {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

  if (!permission.granted) {
    throw new Error(permissionDeniedMessage);
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

export default function AccountScreen() {
  const { user } = useUser();
  const {
    clearPendingInviteToken,
    instance,
    session,
    setActiveCircleId,
    signOut,
  } = useSession();
  const convexAuth = useConvexAuth();
  const theme = useTheme();
  const gt = useGT();
  const viewerState = useQuery(api.users.viewerState, convexAuth.isAuthenticated ? {} : 'skip');
  const viewer = viewerState?.viewer ?? null;
  const createProfileImageTarget = useAction(api.users.createProfileImageTarget);
  const completeProfileImageUpload = useAction(api.users.completeProfileImageUpload);
  const removeProfileImage = useAction(api.users.removeProfileImage);
  const deleteAccountData = useAction(api.accountDeletion.deleteMyAccountData);

  const [feedback, setFeedback] = useState<string | null>(null);
  const [isProfileImageBusy, setIsProfileImageBusy] = useState(false);
  const [isAccountDeletionBusy, setIsAccountDeletionBusy] = useState(false);

  const customProfileImage = useProfileImage(viewer?.profileImageKey);
  const profileImage = customProfileImage ?? session?.avatarUrl ?? null;
  const accountLabel = session?.email ?? session?.displayName ?? gt('Angemeldet');
  const profileName = viewer?.displayName ?? session?.displayName ?? accountLabel;
  const hasProfileImage = Boolean(viewer?.hasProfileImage);

  const handlePickProfileImage = useCallback(async () => {
    if (!viewer) {
      setFeedback(gt('Dein Profil ist noch nicht geladen.'));
      return;
    }

    setIsProfileImageBusy(true);
    setFeedback(null);

    try {
      const pickedAsset = await pickSingleImageAsset(
        gt('Ohne Mediathek-Zugriff kann kein Bild ausgewählt werden.'),
      );

      if (!pickedAsset) {
        return;
      }

      const processedAsset = await optimizeAvatarImageAsset(pickedAsset);

      if (processedAsset.sizeBytes === undefined || processedAsset.sizeBytes <= 0) {
        throw new Error(gt('Die Dateigröße konnte nicht ermittelt werden.'));
      }

      const prepared = await createProfileImageTarget({
        mimeType: processedAsset.mimeType,
        fileName: processedAsset.fileName,
        sizeBytes: processedAsset.sizeBytes,
      });
      const uploaded = await uploadPreparedFile({
        target: prepared.target,
        asset: processedAsset,
      });

      await completeProfileImageUpload({
        uploadId: prepared.uploadId,
        objectKey: uploaded.objectKey,
        sizeBytes: processedAsset.sizeBytes,
      });
      setFeedback(gt('Profilbild aktualisiert.'));
    } catch (error) {
      setFeedback(userFacingErrorMessage(error, gt('Profilbild konnte nicht gesetzt werden.')));
    } finally {
      setIsProfileImageBusy(false);
    }
  }, [completeProfileImageUpload, createProfileImageTarget, gt, viewer]);

  const handleRemoveProfileImage = useCallback(() => {
    if (!hasProfileImage || isProfileImageBusy) {
      return;
    }

    Alert.alert(gt('Profilbild entfernen?'), gt('Dein eigenes Profilbild wird entfernt.'), [
      {
        text: gt('Abbrechen'),
        style: 'cancel',
      },
      {
        text: gt('Entfernen'),
        style: 'destructive',
        onPress: () => {
          setIsProfileImageBusy(true);
          setFeedback(null);
          void removeProfileImage({})
            .then(() => {
              setFeedback(gt('Profilbild entfernt.'));
            })
            .catch((error) => {
              setFeedback(
                userFacingErrorMessage(error, gt('Profilbild konnte nicht entfernt werden.')),
              );
            })
            .finally(() => {
              setIsProfileImageBusy(false);
            });
        },
      },
    ]);
  }, [gt, hasProfileImage, isProfileImageBusy, removeProfileImage]);

  const handleSignOut = useCallback(() => {
    void signOut();
  }, [signOut]);

  const handleDeleteAccount = useCallback(() => {
    if (!user || isAccountDeletionBusy) {
      return;
    }

    Alert.alert(
      gt('Konto wirklich löschen?'),
      gt(
        'Dein Konto, deine Beiträge, Kommentare, Reaktionen und Medien werden dauerhaft gelöscht. Circles, die du besitzt, werden einschließlich der Inhalte anderer Mitglieder gelöscht; übertrage sie vorher, wenn sie erhalten bleiben sollen. Ein App-Store-Abo wird dadurch nicht automatisch gekündigt; kündige es vorher über „Abo verwalten“. Dieser Vorgang kann nicht rückgängig gemacht werden.',
      ),
      [
        {
          text: gt('Abbrechen'),
          style: 'cancel',
        },
        {
          text: gt('Konto löschen'),
          style: 'destructive',
          onPress: () => {
            setIsAccountDeletionBusy(true);
            setFeedback(null);

            void deleteAccountData({})
              .then(async () => {
                await logOutPurchases();
                setActiveCircleId(null);
                await Promise.all([
                  clearPendingInviteToken().catch(() => undefined),
                  clearUploadRecoveryForInstance(instance.instance.baseUrl).catch(() => undefined),
                ]);
                await user.delete();
              })
              .catch((error) => {
                setFeedback(
                  userFacingErrorMessage(
                    error,
                    gt('Das Konto konnte nicht vollständig gelöscht werden. Versuche es erneut.'),
                  ),
                );
              })
              .finally(() => {
                setIsAccountDeletionBusy(false);
              });
          },
        },
      ],
    );
  }, [
    clearPendingInviteToken,
    deleteAccountData,
    gt,
    instance.instance.baseUrl,
    isAccountDeletionBusy,
    setActiveCircleId,
    user,
  ]);

  const handleDismissFeedback = useCallback(() => setFeedback(null), []);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]} edges={['top']}>
      <Animated.ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View entering={enterSection(0)}>
          <SettingsScreenHeader eyebrow={gt('Einstellungen')} title={gt('Konto')} />
        </Animated.View>

        <Animated.View entering={enterSection(1)} style={styles.section}>
          <Card style={styles.heroCard}>
            <Avatar name={profileName} image={profileImage} size="xl" expandable />
            <View style={styles.heroCopy}>
              <Text style={[styles.heroName, { color: theme.text }]} numberOfLines={1}>
                {profileName}
              </Text>
              <Text style={[styles.heroMeta, { color: theme.textSecondary }]} numberOfLines={1}>
                {accountLabel}
              </Text>
            </View>
            <View style={styles.heroActions}>
              <View style={styles.heroActionCol}>
                <Button
                  label={hasProfileImage ? gt('Bild ändern') : gt('Bild wählen')}
                  icon="image-outline"
                  variant="ghost"
                  loading={isProfileImageBusy}
                  onPress={handlePickProfileImage}
                />
              </View>
              {hasProfileImage ? (
                <View style={styles.heroActionCol}>
                  <Button
                    label={gt('Entfernen')}
                    icon="trash-outline"
                    variant="outline"
                    loading={isProfileImageBusy}
                    onPress={handleRemoveProfileImage}
                  />
                </View>
              ) : null}
            </View>
          </Card>
        </Animated.View>

        <Animated.View entering={enterSection(2)} style={styles.section}>
          <SectionHeader icon="globe-outline" label={gt('Server')} />
          <Card style={styles.infoCard}>
            <InfoRow icon="business-outline" label={gt('Server')} value={instance.instance.name} />
            <InfoRow
              icon="link-outline"
              label={gt('Adresse')}
              value={instance.instance.baseUrl}
              hasSeparator={false}
            />
          </Card>
        </Animated.View>

        <Animated.View entering={enterSection(3)} style={styles.section}>
          <SectionHeader icon="key-outline" label={gt('Sitzung')} />
          <Card>
            <Button
              label={gt('Abmelden')}
              icon="log-out-outline"
              variant="outline"
              onPress={handleSignOut}
            />
          </Card>
        </Animated.View>

        <Animated.View entering={enterSection(4)} style={styles.section}>
          <SectionHeader icon="warning-outline" label={gt('Gefahrenzone')} />
          <Card>
            <T>
              <Text style={[styles.dangerCopy, { color: theme.textSecondary }]}>
                Löscht dein Konto samt Beiträgen, Kommentaren und Medien dauerhaft. Circles, die
                du besitzt, werden ebenfalls gelöscht.
              </Text>
            </T>
            <Button
              label={gt('Konto und Daten löschen')}
              icon="trash-outline"
              variant="danger"
              loading={isAccountDeletionBusy}
              disabled={isAccountDeletionBusy}
              onPress={handleDeleteAccount}
            />
          </Card>
        </Animated.View>
      </Animated.ScrollView>

      <FeedbackToast message={feedback} onDismiss={handleDismissFeedback} />
    </SafeAreaView>
  );
}

function InfoRow({
  icon,
  label,
  value,
  hasSeparator = true,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  hasSeparator?: boolean;
}) {
  const theme = useTheme();

  return (
    <View
      style={[
        styles.infoRow,
        hasSeparator && {
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.borderLight,
        },
      ]}
    >
      <Ionicons name={icon} size={15} color={theme.textTertiary} />
      <Text style={[styles.infoLabel, { color: theme.textSecondary }]}>{label}</Text>
      <Text
        style={[styles.infoValue, { color: theme.text }]}
        numberOfLines={1}
        ellipsizeMode="middle"
      >
        {value}
      </Text>
    </View>
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
  heroCard: {
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.xl,
  },
  heroCopy: {
    alignItems: 'center',
    gap: 2,
  },
  heroName: {
    fontFamily: Fonts.display,
    fontSize: FontSize.xl,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  heroMeta: {
    fontSize: FontSize.sm,
  },
  heroActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    alignSelf: 'stretch',
  },
  heroActionCol: {
    flex: 1,
  },
  infoCard: {
    gap: 0,
    paddingVertical: Spacing.xs,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
  },
  infoLabel: {
    fontSize: FontSize.sm,
    fontWeight: '500',
    minWidth: 60,
  },
  infoValue: {
    flex: 1,
    fontSize: FontSize.sm,
    fontWeight: '600',
    textAlign: 'right',
  },
  dangerCopy: {
    fontSize: FontSize.sm,
    lineHeight: 20,
  },
});
