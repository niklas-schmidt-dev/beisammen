import Ionicons from '@expo/vector-icons/Ionicons';
import { Redirect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { T, Var, useGT, useMessages } from 'gt-react-native';

import { useConvexAuth, useMutation, usePaginatedQuery, useQuery } from 'convex/react';

import { LegalLinks } from '@/components/billing/LegalLinks';
import { Button, Card, FeedbackToast, LoadingBox } from '@/components/ui';
import { InviteComposer, type InviteComposerSubmitArgs } from '@/components/invites/InviteComposer';
import { InviteQrScanner } from '@/components/invites/InviteQrScanner';
import { CelebrationBurst } from '@/components/onboarding/CelebrationBurst';
import { DriftFieldBackdrop } from '@/components/onboarding/DriftFieldBackdrop';
import { OrbitHero } from '@/components/onboarding/OrbitHero';
import { StepRail } from '@/components/onboarding/StepRail';
import { TiltCard } from '@/components/onboarding/TiltCard';
import { enterDepth } from '@/components/onboarding/depth-motion';
import { useScreenTransition } from '@/components/transition/screen-transition';
import { Fonts, FontSize, Radius, Spacing } from '@/constants/theme';
import { useSession } from '@/features/auth/session-provider';
import { circleCreationNotice } from '@/features/billing/circle-creation-readiness';
import { usePlanPaywall } from '@/features/billing/use-plan-paywall';
import { useEntitlementReconciliation } from '@/features/billing/use-purchase-sync';
import { api } from '@/features/convex/api';
import { parseInviteToken } from '@/features/invites/parse-invite-token';
import { useMarkInteractive } from '@/features/observe/interactive';
import {
  inviteModeLabel,
  inviteRoleLabel,
  resolveInvitePreviewState,
} from '@/features/invites/preview-state';
import { useTheme } from '@/hooks/use-theme';
import { useDateFormat } from '@/i18n/use-date-format';

type OnboardingMode = 'choice' | 'create' | 'join';

interface CreatedCircle {
  circleId: string;
  name: string;
}

const INVITE_EXPIRY_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
  dateStyle: 'medium',
  timeStyle: 'short',
};

function formatInviteExpiry(timestamp: number, format: Intl.DateTimeFormat) {
  return format.format(new Date(timestamp));
}

export default function OnboardingScreen() {
  const router = useRouter();
  const { wipe } = useScreenTransition();
  const theme = useTheme();
  const gt = useGT();
  const m = useMessages();
  const inviteExpiryFormat = useDateFormat(INVITE_EXPIRY_FORMAT_OPTIONS);
  const { pendingInviteToken, setActiveCircleId } = useSession();
  const convexAuth = useConvexAuth();
  const viewerState = useQuery(api.users.viewerState, convexAuth.isAuthenticated ? {} : 'skip');
  const hasViewer = viewerState?.isAuthenticated === true && viewerState.viewer !== null;
  const circlesPage = usePaginatedQuery(
    api.circles.listForViewer,
    hasViewer ? {} : 'skip',
    { initialNumItems: 1 },
  );
  const createCircle = useMutation(api.circles.create);
  const createInvite = useMutation(api.invites.create);
  const acceptInvite = useMutation(api.invites.accept);
  const creationReadiness = useQuery(api.billing.circleCreationReadiness, hasViewer ? {} : 'skip');

  const [mode, setMode] = useState<OnboardingMode>('choice');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [createdCircle, setCreatedCircle] = useState<CreatedCircle | null>(null);
  const [isCreatingCircle, setIsCreatingCircle] = useState(false);
  const [joinInput, setJoinInput] = useState('');
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isAccepting, setIsAccepting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const { isPresenting: isPresentingPaywall, present: presentPaywall } =
    usePlanPaywall(setFeedback);

  const joinToken = useMemo(() => parseInviteToken(joinInput), [joinInput]);
  const joinPreview = useQuery(
    api.invites.preview,
    mode === 'join' && joinToken && hasViewer ? { token: joinToken } : 'skip',
  );
  const joinPreviewState = resolveInvitePreviewState({ preview: joinPreview });

  const hasExistingCircle = circlesPage.results.length > 0;
  const isLoading = hasViewer && circlesPage.status === 'LoadingFirstPage';
  const creationBlockedNotice = createdCircle ? null : circleCreationNotice(creationReadiness);

  // A purchase the backend has not seen yet (webhook lag) must not block
  // onboarding: reconcile against the store once while the plan gate shows.
  useEntitlementReconciliation(creationReadiness);

  useMarkInteractive(
    !pendingInviteToken &&
      hasViewer &&
      !isLoading &&
      (!hasExistingCircle || createdCircle !== null),
  );

  const handleChooseCreate = useCallback(async () => {
    if (isPresentingPaywall) {
      return;
    }

    // Creating a circle requires an active cloud plan; open the paywall right
    // away instead of leading into a form whose submit button is blocked.
    if (creationBlockedNotice?.action === 'choose_plan') {
      const outcome = await presentPaywall();

      if (outcome === 'dismissed') {
        setFeedback(m(creationBlockedNotice.message));
        return;
      }

      if (outcome !== 'purchased' && outcome !== 'restored') {
        return;
      }
    }

    setMode('create');
  }, [creationBlockedNotice, isPresentingPaywall, m, presentPaywall]);

  const handleCreateCircle = useCallback(async () => {
    const normalizedName = name.trim();

    if (!normalizedName) {
      setFeedback(gt('Gib deinem Circle einen Namen.'));
      return;
    }

    setIsCreatingCircle(true);
    setFeedback(null);

    try {
      const created = await createCircle({
        name: normalizedName,
        description: description.trim() || undefined,
      });

      setCreatedCircle({
        circleId: created.circleId,
        name: normalizedName,
      });
      setActiveCircleId(created.circleId);
      setFeedback(gt('Circle erstellt.'));
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : gt('Circle konnte nicht erstellt werden.'),
      );
    } finally {
      setIsCreatingCircle(false);
    }
  }, [createCircle, description, gt, name, setActiveCircleId]);

  const handleCreateInvite = useCallback(
    async (args: InviteComposerSubmitArgs) => {
      if (!createdCircle) {
        throw new Error(gt('Erstelle zuerst einen Circle.'));
      }

      return await createInvite({
        circleId: createdCircle.circleId,
        mode: args.mode,
        invitedEmail: args.invitedEmail,
        role: args.role,
      });
    },
    [createInvite, createdCircle, gt],
  );

  const handleAcceptInvite = useCallback(async () => {
    if (!joinToken) {
      return;
    }

    setIsAccepting(true);
    setFeedback(null);

    try {
      const accepted = await acceptInvite({ token: joinToken });

      if (accepted.status !== 'accepted') {
        setFeedback(gt('Einladung nicht gefunden. Prüfe den Code oder bitte um eine neue Einladung.'));
        return;
      }

      setActiveCircleId(accepted.circleId);
      wipe(() => router.replace('/home'));
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : gt('Einladung konnte nicht angenommen werden.'),
      );
    } finally {
      setIsAccepting(false);
    }
  }, [acceptInvite, gt, joinToken, router, setActiveCircleId]);

  if (pendingInviteToken) {
    return <Redirect href="/invite" />;
  }

  if (!hasViewer || isLoading) {
    return <LoadingBox />;
  }

  if (hasExistingCircle && !createdCircle) {
    return <Redirect href="/home" />;
  }

  const showBackButton = mode !== 'choice' && !createdCircle;
  const headerCopy = {
    choice: {
      title: gt('Schön, dass du da bist'),
      subtitle: gt(
        'Ein Circle ist deine private Gruppe. Erstelle einen eigenen oder tritt einem bestehenden bei.',
      ),
    },
    create: {
      title: gt('Dein erster Circle'),
      subtitle: gt(
        'Starte mit einer festen Gruppe und teile danach Fotos oder Videos nur mit diesen Menschen.',
      ),
    },
    join: {
      title: gt('Circle beitreten'),
      subtitle: gt('Füge den Einladungslink oder Code ein, den du bekommen hast.'),
    },
  }[mode];

  const inputStyle = [
    styles.input,
    {
      backgroundColor: theme.background,
      borderColor: theme.border,
      color: theme.text,
    },
  ];

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]} edges={['top']}>
      <DriftFieldBackdrop />
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Animated.View
            key={`header-${mode}`}
            entering={enterDepth(0)}
            style={[styles.header, mode === 'choice' ? styles.headerCentered : null]}
          >
            {mode === 'choice' ? (
              <OrbitHero size={210} />
            ) : showBackButton ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={gt('Zurück')}
                onPress={() => {
                  setMode('choice');
                  setFeedback(null);
                }}
                style={({ pressed }) => [
                  styles.backButton,
                  {
                    backgroundColor: theme.surface,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <Ionicons name="arrow-back-outline" size={18} color={theme.text} />
              </Pressable>
            ) : (
              <View style={[styles.iconWrap, { backgroundColor: theme.primaryMuted }]}>
                <Ionicons name="people-circle-outline" size={28} color={theme.primary} />
              </View>
            )}
            <T>
              <Text style={[styles.eyebrow, { color: theme.textTertiary }]}>Willkommen</Text>
            </T>
            <Text
              style={[
                styles.title,
                { color: theme.text },
                mode === 'choice' ? styles.textCentered : null,
              ]}
            >
              {headerCopy.title}
            </Text>
            <Text
              style={[
                styles.subtitle,
                { color: theme.textSecondary },
                mode === 'choice' ? styles.textCentered : null,
              ]}
            >
              {headerCopy.subtitle}
            </Text>
          </Animated.View>

          {mode === 'choice' ? (
            <View style={styles.choiceStack}>
              <Animated.View entering={enterDepth(1)}>
                <TiltCard
                  icon="add-circle-outline"
                  title={gt('Neuen Circle erstellen')}
                  description={gt(
                    'Für deine Familie, Partner oder engen Freundeskreis. Du lädst danach alle ein.',
                  )}
                  emphasized
                  onPress={() => {
                    void handleChooseCreate();
                  }}
                />
              </Animated.View>
              <Animated.View entering={enterDepth(2)}>
                <TiltCard
                  icon="mail-open-outline"
                  title={gt('Mit Einladung beitreten')}
                  description={gt(
                    'Du hast einen Einladungslink oder Code bekommen? Tritt dem Circle direkt bei.',
                  )}
                  onPress={() => setMode('join')}
                />
              </Animated.View>
            </View>
          ) : null}

          {mode === 'create' ? (
            <Animated.View key="create" entering={enterDepth(1)} style={styles.modeStack}>
              {createdCircle ? <CelebrationBurst /> : null}
              <StepRail
                steps={[gt('Benennen'), gt('Einladen'), gt('Teilen')]}
                activeIndex={createdCircle ? 1 : 0}
              />
              <Card>
                <View style={styles.stepHeader}>
                  <Text style={[styles.stepNumber, { color: theme.primary }]}>01</Text>
                  <View style={styles.stepCopy}>
                    <T>
                      <Text style={[styles.cardTitle, { color: theme.text }]}>Circle benennen</Text>
                      <Text style={[styles.body, { color: theme.textSecondary }]}>
                        Der Name sollte die Gruppe klar wiedererkennen lassen.
                      </Text>
                    </T>
                  </View>
                </View>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  accessibilityLabel={gt('Circle-Name')}
                  placeholder={gt('Familie, Urlaub, Partner')}
                  placeholderTextColor={theme.textTertiary}
                  editable={!createdCircle && !isCreatingCircle}
                  style={inputStyle}
                />
                <TextInput
                  value={description}
                  onChangeText={setDescription}
                  accessibilityLabel={gt('Beschreibung (optional)')}
                  placeholder={gt('Beschreibung (optional)')}
                  placeholderTextColor={theme.textTertiary}
                  editable={!createdCircle && !isCreatingCircle}
                  style={inputStyle}
                />
                {creationBlockedNotice ? (
                  <>
                    <Text style={[styles.body, { color: theme.textSecondary }]}>
                      {m(creationBlockedNotice.message)}
                    </Text>
                    {creationBlockedNotice.action === 'choose_plan' ? (
                      <>
                        <Button
                          label={gt('Tarife ansehen')}
                          icon="sparkles-outline"
                          variant="outline"
                          loading={isPresentingPaywall}
                          onPress={() => {
                            void presentPaywall();
                          }}
                        />
                        <LegalLinks />
                      </>
                    ) : null}
                  </>
                ) : null}
                <Button
                  label={
                    createdCircle
                      ? gt('Circle erstellt')
                      : isCreatingCircle
                        ? gt('Erstellt...')
                        : gt('Circle erstellen')
                  }
                  icon={createdCircle ? 'checkmark-circle-outline' : 'add-outline'}
                  loading={isCreatingCircle}
                  disabled={
                    Boolean(createdCircle) || !name.trim() || creationBlockedNotice !== null
                  }
                  onPress={() => {
                    void handleCreateCircle();
                  }}
                />
              </Card>

              {createdCircle ? (
                <>
                  <Animated.View entering={enterDepth(0)}>
                    <Card>
                      <View style={styles.stepHeader}>
                        <Text style={[styles.stepNumber, { color: theme.primary }]}>02</Text>
                        <View style={styles.stepCopy}>
                          <T>
                            <Text style={[styles.cardTitle, { color: theme.text }]}>
                              Menschen einladen
                            </Text>
                            <Text style={[styles.body, { color: theme.textSecondary }]}>
                              E-Mail bleibt privat voreingestellt. Offene Links sind für schnelle
                              Übergaben gedacht.
                            </Text>
                          </T>
                        </View>
                      </View>
                      <InviteComposer
                        circleName={createdCircle.name}
                        onCreateInvite={handleCreateInvite}
                        onFeedback={setFeedback}
                      />
                    </Card>
                  </Animated.View>

                  <Animated.View entering={enterDepth(1)}>
                    <Card>
                      <T>
                        <Text style={[styles.cardTitle, { color: theme.text }]}>
                          Bereit zum Teilen
                        </Text>
                        <Text style={[styles.body, { color: theme.textSecondary }]}>
                          Dein Circle ist aktiv. Auf Home kannst du den ersten Beitrag vorbereiten.
                        </Text>
                      </T>
                      <Button
                        label={gt('Zu Home')}
                        icon="home-outline"
                        onPress={() => {
                          wipe(() => router.replace('/home'));
                        }}
                      />
                    </Card>
                  </Animated.View>
                </>
              ) : null}
            </Animated.View>
          ) : null}

          {mode === 'join' ? (
            <Animated.View key="join" entering={enterDepth(1)} style={styles.modeStack}>
              <Card>
                <T>
                  <Text style={[styles.cardTitle, { color: theme.text }]}>Einladung einfügen</Text>
                  <Text style={[styles.body, { color: theme.textSecondary }]}>
                    Gib den Code ein (z.B. K7MF3-QX9WD), füge den Link ein oder scanne den QR-Code.
                  </Text>
                </T>
                <TextInput
                  value={joinInput}
                  onChangeText={setJoinInput}
                  accessibilityLabel={gt('Einladungslink oder Code')}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder={gt('Einladungslink oder Code')}
                  placeholderTextColor={theme.textTertiary}
                  editable={!isAccepting}
                  style={inputStyle}
                />
                {joinInput.trim() && !joinToken ? (
                  <T>
                    <Text style={[styles.joinHint, { color: theme.danger }]}>
                      Das sieht nicht wie ein Einladungslink oder Code aus.
                    </Text>
                  </T>
                ) : null}
                <Button
                  label={gt('QR-Code scannen')}
                  icon="qr-code-outline"
                  variant="outline"
                  disabled={isAccepting}
                  onPress={() => setIsScannerOpen(true)}
                />
              </Card>

              {joinToken ? (
                joinPreviewState.kind === 'loading' ? (
                  <Card>
                    <LoadingBox />
                  </Card>
                ) : joinPreviewState.kind === 'not-found' || !joinPreview ? (
                  <Card>
                    <Text style={[styles.cardTitle, { color: theme.text }]}>
                      {m(joinPreviewState.title)}
                    </Text>
                    <T>
                      <Text style={[styles.body, { color: theme.textSecondary }]}>
                        Prüfe, ob der Link vollständig ist, oder bitte um eine neue Einladung.
                      </Text>
                    </T>
                  </Card>
                ) : (
                  <Card>
                    <View style={styles.previewHeader}>
                      <View style={[styles.iconWrap, { backgroundColor: theme.primaryMuted }]}>
                        <Ionicons name="people-outline" size={24} color={theme.primary} />
                      </View>
                      <View style={styles.stepCopy}>
                        <Text style={[styles.cardTitle, { color: theme.text }]}>
                          {joinPreview.circleName}
                        </Text>
                        <T>
                          <Text style={[styles.body, { color: theme.textSecondary }]}>
                            <Var>{m(inviteModeLabel(joinPreview.mode))}</Var> · Rolle:{' '}
                            <Var>{m(inviteRoleLabel(joinPreview.role))}</Var>
                          </Text>
                          <Text style={[styles.body, { color: theme.textTertiary }]}>
                            Gültig bis <Var>{formatInviteExpiry(joinPreview.expiresAt, inviteExpiryFormat)}</Var>
                          </Text>
                        </T>
                      </View>
                    </View>

                    {joinPreviewState.kind === 'can-accept' ? (
                      <Button
                        label={
                          isAccepting
                            ? gt('Tritt bei...')
                            : gt('„{name}" beitreten', { name: joinPreview.circleName })
                        }
                        icon="enter-outline"
                        loading={isAccepting}
                        onPress={() => {
                          void handleAcceptInvite();
                        }}
                      />
                    ) : (
                      <View style={[styles.previewNotice, { backgroundColor: theme.dangerMuted }]}>
                        <Ionicons name="alert-circle-outline" size={15} color={theme.danger} />
                        <Text style={[styles.previewNoticeText, { color: theme.danger }]}>
                          {m(joinPreviewState.title)}
                        </Text>
                      </View>
                    )}
                  </Card>
                )
              ) : null}
            </Animated.View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
      <FeedbackToast message={feedback} onDismiss={() => setFeedback(null)} />
      <InviteQrScanner
        visible={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onScanned={(scannedToken) => {
          setIsScannerOpen(false);
          setJoinInput(scannedToken);
        }}
      />
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
  content: {
    padding: Spacing.xl,
    paddingBottom: Spacing['3xl'],
    gap: Spacing.lg,
  },
  header: {
    gap: Spacing.sm,
  },
  headerCentered: {
    alignItems: 'center',
    paddingVertical: Spacing.lg,
  },
  textCentered: {
    textAlign: 'center',
  },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xs,
  },
  iconWrap: {
    width: 54,
    height: 54,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eyebrow: {
    fontFamily: Fonts.mono,
    fontSize: FontSize.xs,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: FontSize['2xl'],
    fontWeight: '700',
    letterSpacing: -0.6,
  },
  subtitle: {
    fontSize: FontSize.base,
    lineHeight: 22,
  },
  choiceStack: {
    gap: Spacing.md,
  },
  modeStack: {
    gap: Spacing.lg,
  },
  stepHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
  },
  stepNumber: {
    fontFamily: Fonts.mono,
    fontSize: FontSize.sm,
    fontWeight: '800',
    marginTop: 4,
  },
  stepCopy: {
    flex: 1,
    gap: 4,
  },
  cardTitle: {
    fontFamily: Fonts.display,
    fontSize: FontSize.xl,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  body: {
    fontSize: FontSize.sm,
    lineHeight: 20,
  },
  input: {
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    fontSize: FontSize.base,
  },
  joinHint: {
    fontSize: FontSize.sm,
    lineHeight: 19,
  },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
  },
  previewNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.md,
  },
  previewNoticeText: {
    flex: 1,
    fontSize: FontSize.sm,
    lineHeight: 20,
    fontWeight: '600',
  },
});
