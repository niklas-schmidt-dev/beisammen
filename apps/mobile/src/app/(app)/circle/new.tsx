import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
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
import { T, useGT, useMessages } from 'gt-react-native';

import { useConvexAuth, useMutation, useQuery } from 'convex/react';

import { LegalLinks } from '@/components/billing/LegalLinks';
import { Button, Card, FeedbackToast, LoadingBox } from '@/components/ui';
import { Fonts, FontSize, Radius, Spacing } from '@/constants/theme';
import { enterSection } from '@/lib/motion';
import { useSession } from '@/features/auth/session-provider';
import { circleCreationNotice } from '@/features/billing/circle-creation-readiness';
import { usePlanPaywall } from '@/features/billing/use-plan-paywall';
import { useEntitlementReconciliation } from '@/features/billing/use-purchase-sync';
import { api } from '@/features/convex/api';
import { userFacingErrorMessage } from '@/lib/user-facing-error';
import { useTheme } from '@/hooks/use-theme';

export default function NewCircleScreen() {
  const router = useRouter();
  const theme = useTheme();
  const gt = useGT();
  const m = useMessages();
  const { setActiveCircleId } = useSession();
  const convexAuth = useConvexAuth();
  const viewerState = useQuery(api.users.viewerState, convexAuth.isAuthenticated ? {} : 'skip');
  const hasViewer = viewerState?.isAuthenticated === true && viewerState.viewer !== null;
  const creationReadiness = useQuery(api.billing.circleCreationReadiness, hasViewer ? {} : 'skip');
  const createCircle = useMutation(api.circles.create);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const { isPresenting: isPresentingPaywall, present: presentPaywall } =
    usePlanPaywall(setFeedback);
  const hasAutoPresentedPaywall = useRef(false);

  const isLoadingReadiness = !hasViewer || creationReadiness === undefined;
  const notice = circleCreationNotice(creationReadiness);

  // A purchase the backend has not seen yet (webhook lag) must not block the
  // form: reconcile against the store once while the plan gate is showing.
  useEntitlementReconciliation(creationReadiness);
  const needsPlan = notice?.action === 'choose_plan';

  // The page is the paywall guard for every create-circle entry point: users
  // without a plan see the offer immediately instead of a disabled form.
  useEffect(() => {
    if (
      hasAutoPresentedPaywall.current ||
      isLoadingReadiness ||
      creationReadiness?.reason !== 'plan_required'
    ) {
      return;
    }

    hasAutoPresentedPaywall.current = true;
    void presentPaywall();
  }, [creationReadiness, isLoadingReadiness, presentPaywall]);

  const handleCreateCircle = useCallback(async () => {
    const normalizedName = name.trim();

    if (!normalizedName) {
      setFeedback(gt('Gib deinem Circle einen Namen.'));
      return;
    }

    setIsCreating(true);
    setFeedback(null);

    try {
      const created = await createCircle({
        name: normalizedName,
        description: description.trim() || undefined,
      });

      setActiveCircleId(created.circleId);
      router.replace(`/circle/${created.circleId}` as never);
    } catch (error) {
      setFeedback(userFacingErrorMessage(error, gt('Der Circle konnte nicht angelegt werden.')));
    } finally {
      setIsCreating(false);
    }
  }, [createCircle, description, gt, name, router, setActiveCircleId]);

  const usageMeta =
    creationReadiness?.reason === 'limit_reached' &&
    creationReadiness.usedCircles !== null &&
    creationReadiness.maxCircles !== null
      ? gt('{used} von {total} Circles belegt', {
          used: creationReadiness.usedCircles,
          total: creationReadiness.maxCircles,
        })
      : null;

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
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Animated.View entering={enterSection(0)} style={styles.header}>
            <T>
              <Text style={[styles.eyebrow, { color: theme.textTertiary }]}>neuer circle</Text>
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
              <T>
                <Text style={[styles.title, { color: theme.text }]}>
                  Benenne zuerst die Menschen.
                </Text>
              </T>
            </View>
            <T>
              <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
                Erstelle einen privaten Raum für genau eine Gruppe. Keine Suche, kein Publikum, nur
                eingeladene Personen.
              </Text>
            </T>
          </Animated.View>

          {isLoadingReadiness ? (
            <Card>
              <LoadingBox />
            </Card>
          ) : needsPlan && notice ? (
            <Animated.View entering={enterSection(1)}>
              <Card style={styles.gateCard}>
                <View style={[styles.gateIcon, { backgroundColor: theme.primaryMuted }]}>
                  <Ionicons name="sparkles-outline" size={26} color={theme.primary} />
                </View>
                <Text style={[styles.gateTitle, { color: theme.text }]}>{m(notice.title)}</Text>
                <Text style={[styles.gateMessage, { color: theme.textSecondary }]}>
                  {m(notice.message)}
                </Text>
                {usageMeta ? (
                  <Text style={[styles.gateMeta, { color: theme.textTertiary }]}>{usageMeta}</Text>
                ) : null}
                <View style={styles.gateAction}>
                  <Button
                    label={gt('Tarife ansehen')}
                    icon="sparkles-outline"
                    loading={isPresentingPaywall}
                    onPress={() => {
                      void presentPaywall();
                    }}
                  />
                </View>
                <LegalLinks />
              </Card>
            </Animated.View>
          ) : (
            <Animated.View entering={enterSection(1)}>
              <Card>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  accessibilityLabel={gt('Circle-Name')}
                  placeholder={gt('Familie, Urlaub, Partner')}
                  placeholderTextColor={theme.textTertiary}
                  editable={!isCreating}
                  style={inputStyle}
                />
                <TextInput
                  value={description}
                  onChangeText={setDescription}
                  accessibilityLabel={gt('Beschreibung (optional)')}
                  placeholder={gt('Beschreibung (optional)')}
                  placeholderTextColor={theme.textTertiary}
                  editable={!isCreating}
                  style={inputStyle}
                />
                {notice ? (
                  <Text style={[styles.formNotice, { color: theme.textSecondary }]}>
                    {m(notice.message)}
                  </Text>
                ) : null}
                <Button
                  label={isCreating ? gt('Erstellt...') : gt('Circle erstellen')}
                  icon="add-outline"
                  loading={isCreating}
                  disabled={!name.trim() || notice !== null}
                  onPress={() => {
                    void handleCreateCircle();
                  }}
                />
              </Card>
            </Animated.View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
      <FeedbackToast message={feedback} onDismiss={() => setFeedback(null)} />
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
  subtitle: {
    fontSize: FontSize.sm,
    lineHeight: 20,
    marginTop: 2,
  },
  input: {
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    fontSize: FontSize.base,
  },
  gateCard: {
    alignItems: 'center',
    paddingVertical: Spacing.xl,
    gap: Spacing.sm,
  },
  gateIcon: {
    width: 56,
    height: 56,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xs,
  },
  gateTitle: {
    fontFamily: Fonts.display,
    fontSize: FontSize.xl,
    fontWeight: '700',
    letterSpacing: -0.4,
    textAlign: 'center',
  },
  gateMessage: {
    fontSize: FontSize.sm,
    lineHeight: 20,
    textAlign: 'center',
  },
  gateMeta: {
    fontFamily: Fonts.mono,
    fontSize: FontSize.xs,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  gateAction: {
    alignSelf: 'stretch',
    marginTop: Spacing.sm,
  },
  formNotice: {
    fontSize: FontSize.sm,
    lineHeight: 20,
  },
});
