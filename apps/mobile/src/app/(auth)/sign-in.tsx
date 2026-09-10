import Ionicons from '@expo/vector-icons/Ionicons';
import { useSignIn, useSignUp, useSSO } from '@clerk/expo';
import * as AuthSession from 'expo-auth-session';
import { Redirect } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { T, Var, useGT, useMessages } from 'gt-react-native';
import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { normalizeBaseUrl } from '@beisammen/contracts';

import { AppleSignInButton, GoogleSignInButton } from '@/components/auth/sso-buttons';
import { AnimatedPressable, AuroraBackdrop, Button, Card } from '@/components/ui';
import { BrandMarkAnimated } from '@/components/ui/skia/BrandMarkAnimated';
import { useScreenTransition } from '@/components/transition/screen-transition';
import { Fonts, FontSize, Radius, Spacing } from '@/constants/theme';
import { useSession } from '@/features/auth/session-provider';
import { useMarkInteractive } from '@/features/observe/interactive';
import { defaultInstanceConfig } from '@/features/instances/catalog';
import { resolveInstanceConfig } from '@/features/instances/discovery';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { appEnv } from '@/lib/env';
import { createLogger } from '@/lib/logger';
import { enterSection, exitFade, settleLayout } from '@/lib/motion';

WebBrowser.maybeCompleteAuthSession();

const logger = createLogger('auth.sign-in');

type AuthMode = 'sign-in' | 'sign-up' | 'verify-email' | 'verify-device';

/**
 * Native SSO callback. Clerk rejects the sign-in ("Redirect url mismatch")
 * unless this exact URL is allowlisted under Native Applications for the
 * instance, so keep it explicit and stable: `beisammen://sso-callback`.
 */
const ssoRedirectUrl = AuthSession.makeRedirectUri({
  scheme: appEnv.appScheme,
  path: 'sso-callback',
});

type Translate = ReturnType<typeof useGT>;

interface ClerkApiError {
  code?: string;
  longMessage?: string;
  message?: string;
  meta?: { paramName?: string };
}

function firstClerkError(error: unknown): ClerkApiError | null {
  if (error && typeof error === 'object' && 'errors' in error) {
    const clerkErrors = (error as { errors?: ClerkApiError[] }).errors;
    return clerkErrors?.[0] ?? null;
  }

  return null;
}

/**
 * Clerk only returns English API messages, so map the codes we can hit from
 * this screen to German copy. Unknown codes fall back to Clerk's message so a
 * new error is at least visible instead of silently generic.
 */
function translateClerkError(clerkError: ClerkApiError, gt: Translate): string | null {
  const rawMessage = clerkError.longMessage ?? clerkError.message ?? '';

  switch (clerkError.code) {
    case 'form_identifier_not_found':
      return gt('Zu dieser E-Mail-Adresse wurde kein Konto gefunden.');
    case 'form_identifier_exists':
      return gt('Für diese E-Mail-Adresse gibt es bereits ein Konto. Bitte melde dich an.');
    case 'form_password_incorrect':
      return gt('Das Passwort ist falsch.');
    case 'form_password_length_too_short': {
      const minLength = /(\d+)/.exec(rawMessage)?.[1];
      return minLength
        ? gt('Das Passwort muss mindestens {count} Zeichen lang sein.', { count: minLength })
        : gt('Das Passwort ist zu kurz.');
    }
    case 'form_password_size_in_bytes_exceeded':
      return gt('Das Passwort ist zu lang.');
    case 'form_password_pwned':
      return gt('Dieses Passwort ist aus einem Datenleck bekannt. Bitte wähle ein anderes.');
    case 'form_password_not_strong_enough':
    case 'form_password_validation_failed':
      return gt('Das Passwort ist zu schwach. Bitte wähle ein längeres Passwort.');
    case 'form_param_format_invalid':
      return clerkError.meta?.paramName === 'email_address' || /email/i.test(rawMessage)
        ? gt('Bitte gib eine gültige E-Mail-Adresse ein.')
        : gt('Bitte prüfe deine Eingaben.');
    case 'form_param_nil':
      return gt('Bitte fülle alle Felder aus.');
    case 'form_code_incorrect':
      return gt('Der Code ist falsch.');
    case 'verification_expired':
      return gt('Der Code ist abgelaufen. Fordere einen neuen an.');
    case 'verification_failed':
      return gt('Die Bestätigung ist fehlgeschlagen. Fordere einen neuen Code an.');
    case 'too_many_requests':
      return gt('Zu viele Versuche. Bitte warte kurz und versuche es erneut.');
    case 'user_locked':
      return gt('Dein Konto ist vorübergehend gesperrt. Bitte versuche es später erneut.');
    case 'session_exists':
    case 'identifier_already_signed_in':
      return gt('Du bist bereits angemeldet.');
    case 'strategy_for_user_invalid':
      return gt('Für dieses Konto ist keine Passwort-Anmeldung möglich. Nutze Google oder Apple.');
    case 'not_allowed_access':
    case 'sign_up_restricted':
      return gt('Die Registrierung ist mit dieser E-Mail-Adresse nicht möglich.');
    default:
      return null;
  }
}

function authErrorMessage(error: unknown, gt: Translate): string {
  const clerkError = firstClerkError(error);

  if (clerkError) {
    const translated = translateClerkError(clerkError, gt);

    if (translated) {
      return translated;
    }

    if (clerkError.longMessage || clerkError.message) {
      return clerkError.longMessage ?? clerkError.message ?? gt('Anmeldung fehlgeschlagen.');
    }
  }

  const message =
    error instanceof Error
      ? error.message
      : error && typeof error === 'object' && 'message' in error
        ? (error as { message?: unknown }).message
        : null;

  if (typeof message === 'string' && message.trim().length > 0) {
    if (/network request failed|failed to fetch/i.test(message)) {
      return gt('Keine Verbindung. Prüfe dein Internet und versuche es erneut.');
    }

    return message;
  }

  return gt('Anmeldung fehlgeschlagen.');
}

export default function SignInScreen() {
  const {
    instance,
    instanceError,
    isReady,
    pendingInviteToken,
    session,
    setActiveInstance,
  } = useSession();
  const { signIn } = useSignIn();
  const { signUp } = useSignUp();
  const { startSSOFlow } = useSSO();
  const { wipe } = useScreenTransition();
  const gt = useGT();
  const theme = useTheme();
  const colorScheme = useColorScheme();
  const [customInstanceUrl, setCustomInstanceUrl] = useState(instance.instance.baseUrl);
  const [isInstanceEditorOpen, setIsInstanceEditorOpen] = useState(false);
  const [isSwitchingInstance, setIsSwitchingInstance] = useState(false);
  const [instanceSwitchError, setInstanceSwitchError] = useState<string | null>(null);
  const [instanceSwitchMessage, setInstanceSwitchMessage] = useState<string | null>(null);

  const [authMode, setAuthMode] = useState<AuthMode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [verifyNotice, setVerifyNotice] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const isDefaultInstance =
    normalizeBaseUrl(instance.instance.baseUrl) ===
    normalizeBaseUrl(defaultInstanceConfig.instance.baseUrl);
  const supportsPassword = instance.auth.capabilities.includes('password');
  const supportsSocial = instance.auth.capabilities.includes('social');
  const showAppleButton = supportsSocial && Platform.OS === 'ios';
  const isAuthReady = isReady;
  const isInteractionLocked = !isAuthReady || isSwitchingInstance || isBusy;

  useMarkInteractive(isAuthReady && !session);

  useEffect(() => {
    setCustomInstanceUrl(instance.instance.baseUrl);
  }, [instance.instance.baseUrl]);

  async function handleSwitchInstance() {
    const nextUrl = customInstanceUrl.trim();

    if (!nextUrl) {
      setInstanceSwitchError(gt('Gib die Backend-Adresse deiner Instanz ein.'));
      setInstanceSwitchMessage(null);
      return;
    }

    setIsSwitchingInstance(true);
    setInstanceSwitchError(null);
    setInstanceSwitchMessage(null);

    try {
      const nextInstance = await resolveInstanceConfig(nextUrl);
      await setActiveInstance(nextInstance);
      setCustomInstanceUrl(nextInstance.instance.baseUrl);
      setInstanceSwitchMessage(gt('Verbunden mit {name}.', { name: nextInstance.instance.name }));
      setIsInstanceEditorOpen(false);
    } catch (error) {
      setInstanceSwitchError(
        error instanceof Error
          ? error.message
          : gt('Instanz konnte nicht geprüft werden.'),
      );
    } finally {
      setIsSwitchingInstance(false);
    }
  }

  async function handleResetInstance() {
    setIsSwitchingInstance(true);
    setInstanceSwitchError(null);
    setInstanceSwitchMessage(null);

    try {
      await setActiveInstance(defaultInstanceConfig);
      setCustomInstanceUrl(defaultInstanceConfig.instance.baseUrl);
      setInstanceSwitchMessage(
        gt('Verbunden mit {name}.', { name: defaultInstanceConfig.instance.name }),
      );
      setIsInstanceEditorOpen(false);
    } catch (error) {
      setInstanceSwitchError(
        error instanceof Error
          ? error.message
          : gt('Standard-Instanz konnte nicht aktiviert werden.'),
      );
    } finally {
      setIsSwitchingInstance(false);
    }
  }

  async function handlePasswordSubmit() {
    if (!signIn || !signUp) {
      return;
    }

    const normalizedEmail = email.trim();

    if (!normalizedEmail || !password) {
      setAuthError(gt('E-Mail-Adresse und Passwort werden benötigt.'));
      return;
    }

    setIsBusy(true);
    setAuthError(null);

    try {
      if (authMode === 'sign-in') {
        const { error } = await signIn.password({
          identifier: normalizedEmail,
          password,
        });

        if (error) {
          setAuthError(authErrorMessage(error, gt));
          return;
        }

        if (signIn.status === 'complete') {
          const finalized = await signIn.finalize();

          if (finalized.error) {
            setAuthError(authErrorMessage(finalized.error, gt));
          } else {
            // Cover the auth→app swap with the brand iris.
            wipe();
          }
        } else if (
          (signIn.status === 'needs_client_trust' || signIn.status === 'needs_second_factor') &&
          signIn.supportedSecondFactors.some((factor) => factor.strategy === 'email_code')
        ) {
          // Device Trust: new devices must be confirmed with an email code.
          const sent = await signIn.mfa.sendEmailCode();

          if (sent.error) {
            setAuthError(authErrorMessage(sent.error, gt));
            return;
          }

          setVerificationCode('');
          setVerifyNotice(null);
          setAuthMode('verify-device');
        } else {
          logger.warn('Sign-in requires further steps', { status: signIn.status });
          setAuthError(gt('Diese Anmeldung erfordert weitere Schritte. Bitte versuche es erneut.'));
        }

        return;
      }

      const created = await signUp.create({
        emailAddress: normalizedEmail,
        password,
      });

      if (created.error) {
        setAuthError(authErrorMessage(created.error, gt));
        return;
      }

      const sent = await signUp.verifications.sendEmailCode();

      if (sent.error) {
        setAuthError(authErrorMessage(sent.error, gt));
        return;
      }

      setVerificationCode('');
      setAuthMode('verify-email');
    } catch (error) {
      logger.warn('Password auth failed', { mode: authMode, error });
      setAuthError(authErrorMessage(error, gt));
    } finally {
      setIsBusy(false);
    }
  }

  async function handleVerifyEmail() {
    if (!signUp) {
      return;
    }

    const normalizedCode = verificationCode.trim();

    if (!normalizedCode) {
      setAuthError(gt('Gib den Code aus deiner E-Mail ein.'));
      return;
    }

    setIsBusy(true);
    setAuthError(null);

    try {
      const verified = await signUp.verifications.verifyEmailCode({
        code: normalizedCode,
      });

      if (verified.error) {
        setAuthError(authErrorMessage(verified.error, gt));
        return;
      }

      if (signUp.status === 'complete') {
        const finalized = await signUp.finalize();

        if (finalized.error) {
          setAuthError(authErrorMessage(finalized.error, gt));
        } else {
          wipe();
        }
      } else {
        logger.warn('Sign-up verification incomplete', { status: signUp.status });
        setAuthError(gt('Bestätigung unvollständig. Bitte versuche es erneut.'));
      }
    } catch (error) {
      logger.warn('Email verification failed', { error });
      setAuthError(authErrorMessage(error, gt));
    } finally {
      setIsBusy(false);
    }
  }

  async function handleVerifyDevice() {
    if (!signIn) {
      return;
    }

    const normalizedCode = verificationCode.trim();

    if (!normalizedCode) {
      setAuthError(gt('Gib den Code aus deiner E-Mail ein.'));
      return;
    }

    setIsBusy(true);
    setAuthError(null);
    setVerifyNotice(null);

    try {
      const verified = await signIn.mfa.verifyEmailCode({ code: normalizedCode });

      if (verified.error) {
        setAuthError(authErrorMessage(verified.error, gt));
        return;
      }

      if (signIn.status === 'complete') {
        const finalized = await signIn.finalize();

        if (finalized.error) {
          setAuthError(authErrorMessage(finalized.error, gt));
        } else {
          wipe();
        }
      } else {
        logger.warn('Device verification incomplete', { status: signIn.status });
        setAuthError(gt('Bestätigung unvollständig. Bitte versuche es erneut.'));
      }
    } catch (error) {
      logger.warn('Device verification failed', { error });
      setAuthError(authErrorMessage(error, gt));
    } finally {
      setIsBusy(false);
    }
  }

  async function handleResendDeviceCode() {
    if (!signIn) {
      return;
    }

    setIsBusy(true);
    setAuthError(null);
    setVerifyNotice(null);

    try {
      const sent = await signIn.mfa.sendEmailCode();

      if (sent.error) {
        setAuthError(authErrorMessage(sent.error, gt));
        return;
      }

      setVerificationCode('');
      setVerifyNotice(gt('Wir haben dir einen neuen Code geschickt.'));
    } catch (error) {
      logger.warn('Resending device code failed', { error });
      setAuthError(authErrorMessage(error, gt));
    } finally {
      setIsBusy(false);
    }
  }

  async function handleCancelDeviceVerification() {
    setAuthMode('sign-in');
    setAuthError(null);
    setVerifyNotice(null);
    setVerificationCode('');

    // Discard the pending sign-in attempt so the next submit starts clean.
    await signIn?.reset();
  }

  async function handleSSO(strategy: 'oauth_google' | 'oauth_apple') {
    setIsBusy(true);
    setAuthError(null);

    try {
      const { createdSessionId, setActive } = await startSSOFlow({
        strategy,
        redirectUrl: ssoRedirectUrl,
      });

      if (createdSessionId && setActive) {
        await setActive({ session: createdSessionId });
        wipe();
      }
    } catch (error) {
      logger.warn('SSO sign-in failed', { strategy, error });
      setAuthError(authErrorMessage(error, gt));
    } finally {
      setIsBusy(false);
    }
  }

  if (session) {
    return <Redirect href={pendingInviteToken ? '/invite' : '/home'} />;
  }

  const inputStyle = [
    styles.input,
    {
      borderColor: theme.border,
      color: theme.text,
      backgroundColor: theme.background,
    },
  ];

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Animated.View entering={enterSection(0)} style={styles.hero}>
            <AuroraBackdrop />
            <BrandMarkAnimated size={52} tone={colorScheme === 'dark' ? 'light' : 'dark'} />
            <Text style={[styles.brand, { color: theme.text }]}>beisammen</Text>
            <Text style={[styles.tagline, { color: theme.textSecondary }]}>
              {pendingInviteToken
                ? gt('Melde dich an, um deine Circle-Einladung zu öffnen.')
                : gt('Familien- und Partner-Medien\nprivat und selbstbestimmt teilen.')}
            </Text>
          </Animated.View>

          <Animated.View entering={enterSection(1)} layout={settleLayout} style={styles.authArea}>
            {instanceError ? (
              <ErrorBanner message={instanceError} theme={theme} />
            ) : null}
            {authError ? <ErrorBanner message={authError} theme={theme} /> : null}
            {instanceSwitchMessage ? (
              <View style={[styles.successBanner, { backgroundColor: theme.primaryMuted }]}>
                <Ionicons name="checkmark-circle-outline" size={15} color={theme.primary} />
                <Text style={[styles.successText, { color: theme.primary }]}>
                  {instanceSwitchMessage}
                </Text>
              </View>
            ) : null}
            {verifyNotice ? (
              <View style={[styles.successBanner, { backgroundColor: theme.primaryMuted }]}>
                <Ionicons name="paper-plane-outline" size={15} color={theme.primary} />
                <Text style={[styles.successText, { color: theme.primary }]}>{verifyNotice}</Text>
              </View>
            ) : null}

            {authMode === 'verify-email' || authMode === 'verify-device' ? (
              <Card style={[styles.authCard, { borderColor: theme.borderLight }]}>
                <View style={styles.verifyHeader}>
                  <View style={[styles.verifyIcon, { backgroundColor: theme.primaryMuted }]}>
                    <Ionicons
                      name={
                        authMode === 'verify-device'
                          ? 'shield-checkmark-outline'
                          : 'mail-unread-outline'
                      }
                      size={20}
                      color={theme.primary}
                    />
                  </View>
                  {authMode === 'verify-device' ? (
                    <>
                      <T>
                        <Text style={[styles.authTitle, { color: theme.text }]}>
                          Neues Gerät bestätigen
                        </Text>
                      </T>
                      <T>
                        <Text style={[styles.authSubtitle, { color: theme.textSecondary }]}>
                          Zum Schutz deines Kontos haben wir dir einen Code an{' '}
                          <Var>
                            <Text style={{ color: theme.text, fontWeight: '600' }}>
                              {email.trim()}
                            </Text>
                          </Var>{' '}
                          geschickt.
                        </Text>
                      </T>
                    </>
                  ) : (
                    <>
                      <T>
                        <Text style={[styles.authTitle, { color: theme.text }]}>
                          E-Mail bestätigen
                        </Text>
                      </T>
                      <T>
                        <Text style={[styles.authSubtitle, { color: theme.textSecondary }]}>
                          Wir haben dir einen Code an{' '}
                          <Var>
                            <Text style={{ color: theme.text, fontWeight: '600' }}>
                              {email.trim()}
                            </Text>
                          </Var>{' '}
                          geschickt.
                        </Text>
                      </T>
                    </>
                  )}
                </View>
                <TextInput
                  value={verificationCode}
                  onChangeText={setVerificationCode}
                  accessibilityLabel={gt('Bestätigungscode')}
                  autoCapitalize="none"
                  autoComplete="one-time-code"
                  autoCorrect={false}
                  keyboardType="number-pad"
                  textContentType="oneTimeCode"
                  placeholder={gt('Bestätigungscode')}
                  placeholderTextColor={theme.textTertiary}
                  editable={!isBusy}
                  style={[inputStyle, styles.codeInput]}
                />
                <PrimaryAction
                  label={isBusy ? gt('Wird geprüft...') : gt('Code bestätigen')}
                  icon="checkmark-outline"
                  disabled={isInteractionLocked}
                  busy={isBusy}
                  theme={theme}
                  onPress={() => {
                    void (authMode === 'verify-device' ? handleVerifyDevice() : handleVerifyEmail());
                  }}
                />
                <View style={styles.verifyLinks}>
                  {authMode === 'verify-device' ? (
                    <Pressable
                      disabled={isBusy}
                      onPress={() => {
                        void handleResendDeviceCode();
                      }}
                      style={styles.textLink}
                    >
                      <T>
                        <Text style={[styles.textLinkLabel, { color: theme.primary }]}>
                          Code erneut senden
                        </Text>
                      </T>
                    </Pressable>
                  ) : null}
                  <Pressable
                    disabled={isBusy}
                    onPress={() => {
                      if (authMode === 'verify-device') {
                        void handleCancelDeviceVerification();
                      } else {
                        setAuthMode('sign-up');
                        setAuthError(null);
                      }
                    }}
                    style={styles.textLink}
                  >
                    <T>
                      <Text style={[styles.textLinkLabel, { color: theme.textSecondary }]}>
                        Zurück
                      </Text>
                    </T>
                  </Pressable>
                </View>
              </Card>
            ) : (
              <Card style={[styles.authCard, { borderColor: theme.borderLight }]}>
                {supportsSocial ? (
                  <View style={styles.ssoStack}>
                    {showAppleButton ? (
                      <AppleSignInButton
                        disabled={isInteractionLocked}
                        onPress={() => {
                          void handleSSO('oauth_apple');
                        }}
                      />
                    ) : null}
                    <GoogleSignInButton
                      disabled={isInteractionLocked}
                      onPress={() => {
                        void handleSSO('oauth_google');
                      }}
                    />
                  </View>
                ) : null}

                {supportsSocial && supportsPassword ? (
                  <View style={styles.divider}>
                    <View style={[styles.dividerLine, { backgroundColor: theme.borderLight }]} />
                    <T>
                      <Text style={[styles.dividerLabel, { color: theme.textTertiary }]}>
                        oder
                      </Text>
                    </T>
                    <View style={[styles.dividerLine, { backgroundColor: theme.borderLight }]} />
                  </View>
                ) : null}

                {supportsPassword ? (
                  <View style={styles.form}>
                    <TextInput
                      value={email}
                      onChangeText={setEmail}
                      accessibilityLabel={gt('E-Mail-Adresse')}
                      autoCapitalize="none"
                      autoComplete="email"
                      autoCorrect={false}
                      keyboardType="email-address"
                      textContentType="emailAddress"
                      placeholder={gt('E-Mail-Adresse')}
                      placeholderTextColor={theme.textTertiary}
                      editable={!isBusy}
                      style={inputStyle}
                    />
                    <TextInput
                      value={password}
                      onChangeText={setPassword}
                      accessibilityLabel={gt('Passwort')}
                      autoCapitalize="none"
                      autoComplete={authMode === 'sign-in' ? 'current-password' : 'new-password'}
                      autoCorrect={false}
                      secureTextEntry
                      textContentType={authMode === 'sign-in' ? 'password' : 'newPassword'}
                      placeholder={gt('Passwort')}
                      placeholderTextColor={theme.textTertiary}
                      editable={!isBusy}
                      style={inputStyle}
                    />
                    <PrimaryAction
                      label={
                        !isAuthReady
                          ? gt('Instanz wird geladen...')
                          : isSwitchingInstance
                            ? gt('Instanz wird geprüft...')
                            : isBusy
                              ? gt('Anmeldung läuft...')
                              : authMode === 'sign-in'
                                ? pendingInviteToken
                                  ? gt('Anmelden und Einladung öffnen')
                                  : gt('Anmelden')
                                : gt('Konto erstellen')
                      }
                      icon="log-in-outline"
                      disabled={isInteractionLocked}
                      busy={isBusy}
                      theme={theme}
                      onPress={() => {
                        void handlePasswordSubmit();
                      }}
                    />
                    <Pressable
                      disabled={isBusy}
                      onPress={() => {
                        setAuthMode(authMode === 'sign-in' ? 'sign-up' : 'sign-in');
                        setAuthError(null);
                      }}
                      style={styles.textLink}
                    >
                      <Text style={[styles.textLinkLabel, { color: theme.textSecondary }]}>
                        {authMode === 'sign-in' ? (
                          <T>
                            Noch kein Konto?{' '}
                            <Text style={{ color: theme.primary, fontWeight: '700' }}>
                              Registrieren
                            </Text>
                          </T>
                        ) : (
                          <T>
                            Schon ein Konto?{' '}
                            <Text style={{ color: theme.primary, fontWeight: '700' }}>
                              Anmelden
                            </Text>
                          </T>
                        )}
                      </Text>
                    </Pressable>
                  </View>
                ) : null}
              </Card>
            )}
          </Animated.View>

          <Animated.View entering={enterSection(2)} layout={settleLayout} style={styles.footerArea}>
            <AnimatedPressable
              onPress={() => {
                setIsInstanceEditorOpen((value) => !value);
                setInstanceSwitchError(null);
                setInstanceSwitchMessage(null);
              }}
              pressedScale={0.98}
              pressedOpacity={0.7}
              style={styles.instanceChip}
            >
              <View style={[styles.dot, { backgroundColor: theme.primary }]} />
              <Text style={[styles.instanceChipText, { color: theme.textSecondary }]} numberOfLines={1}>
                {pendingInviteToken
                  ? gt('Einladung liegt bereit · {name}', { name: instance.instance.name })
                  : gt('Verbunden mit {name}', { name: instance.instance.name })}
              </Text>
              <Ionicons
                name={isInstanceEditorOpen ? 'chevron-up-outline' : 'chevron-down-outline'}
                size={13}
                color={theme.textTertiary}
              />
            </AnimatedPressable>

            {isInstanceEditorOpen ? (
              <Card style={[styles.instanceEditor, { borderColor: theme.borderLight }]}>
                <View style={styles.instanceHeader}>
                  <Ionicons name="server-outline" size={18} color={theme.primary} />
                  <View style={styles.instanceHeaderCopy}>
                    <T>
                      <Text style={[styles.instanceTitle, { color: theme.text }]}>
                        Backend vor der Anmeldung
                      </Text>
                    </T>
                    <T>
                      <Text style={[styles.instanceSubtitle, { color: theme.textSecondary }]}>
                        Login läuft über die aktive Instanz.
                      </Text>
                    </T>
                  </View>
                </View>

                <TextInput
                  value={customInstanceUrl}
                  onChangeText={setCustomInstanceUrl}
                  accessibilityLabel={gt('Backend-Adresse der Instanz')}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  placeholder="https://deine-instanz.example.com"
                  placeholderTextColor={theme.textTertiary}
                  editable={!isSwitchingInstance}
                  style={inputStyle}
                />

                {instanceSwitchError ? (
                  <Text style={[styles.instanceError, { color: theme.danger }]}>
                    {instanceSwitchError}
                  </Text>
                ) : null}

                <View style={styles.instanceActions}>
                  <Button
                    label={gt('Prüfen')}
                    icon="checkmark-circle-outline"
                    variant="outline"
                    loading={isSwitchingInstance}
                    disabled={!isReady}
                    onPress={() => {
                      void handleSwitchInstance();
                    }}
                  />
                  {!isDefaultInstance ? (
                    <Button
                      label={gt('Cloud')}
                      icon="cloud-outline"
                      variant="ghost"
                      disabled={isSwitchingInstance || !isReady}
                      onPress={() => {
                        void handleResetInstance();
                      }}
                    />
                  ) : null}
                </View>
              </Card>
            ) : null}

            <T>
              <Text style={[styles.footer, { color: theme.textTertiary }]}>
                Deine Erinnerungen, dein Speicher
              </Text>
            </T>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function ErrorBanner({
  message,
  theme,
}: {
  message: string;
  theme: ReturnType<typeof useTheme>;
}) {
  const m = useMessages();

  return (
    <View style={[styles.errorBanner, { backgroundColor: theme.dangerMuted }]}>
      <Ionicons name="alert-circle-outline" size={15} color={theme.danger} />
      <Text style={[styles.errorText, { color: theme.danger }]}>{m(message)}</Text>
    </View>
  );
}

function PrimaryAction({
  label,
  icon,
  disabled,
  busy,
  theme,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  disabled: boolean;
  busy: boolean;
  theme: ReturnType<typeof useTheme>;
  onPress: () => void;
}) {
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      pressedScale={0.98}
      style={[styles.primaryAction, { backgroundColor: theme.primary, opacity: busy ? 0.85 : 1 }]}
    >
      <Ionicons name={icon} size={19} color={theme.primaryText} />
      <Text style={[styles.primaryActionLabel, { color: theme.primaryText }]}>{label}</Text>
    </AnimatedPressable>
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
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing['2xl'],
    gap: Spacing.xl,
  },
  hero: {
    alignItems: 'center',
    gap: Spacing.sm,
  },
  brand: {
    fontFamily: Fonts.display,
    fontSize: FontSize['3xl'],
    fontWeight: '700',
    letterSpacing: -0.8,
    marginTop: Spacing.xs,
  },
  tagline: {
    fontSize: FontSize.base,
    lineHeight: 22,
    textAlign: 'center',
    letterSpacing: -0.1,
  },
  authArea: {
    gap: Spacing.md,
  },
  authCard: {
    borderWidth: 1,
    gap: Spacing.lg,
  },
  ssoStack: {
    gap: Spacing.sm,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  dividerLabel: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    textTransform: 'lowercase',
  },
  form: {
    gap: Spacing.sm,
  },
  input: {
    borderWidth: 1,
    borderRadius: Radius.md,
    fontSize: FontSize.base,
    paddingHorizontal: Spacing.md,
    height: 48,
  },
  codeInput: {
    textAlign: 'center',
    fontSize: FontSize.lg,
    fontWeight: '700',
    letterSpacing: 4,
  },
  verifyHeader: {
    alignItems: 'center',
    gap: Spacing.xs,
  },
  verifyIcon: {
    width: 44,
    height: 44,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xs,
  },
  authTitle: {
    fontFamily: Fonts.display,
    fontSize: FontSize.lg,
    fontWeight: '700',
  },
  authSubtitle: {
    fontSize: FontSize.sm,
    lineHeight: 19,
    textAlign: 'center',
  },
  primaryAction: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    height: 48,
    borderRadius: Radius.lg,
    marginTop: Spacing.xs,
  },
  primaryActionLabel: {
    fontSize: FontSize.base,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  verifyLinks: {
    alignItems: 'center',
    gap: Spacing.xs,
  },
  textLink: {
    alignSelf: 'center',
    paddingVertical: Spacing.xs,
    minHeight: 32,
    justifyContent: 'center',
  },
  textLinkLabel: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    textAlign: 'center',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.md,
  },
  errorText: {
    flex: 1,
    fontSize: FontSize.sm,
    lineHeight: 20,
  },
  successBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.md,
  },
  successText: {
    flex: 1,
    fontSize: FontSize.sm,
    lineHeight: 20,
    fontWeight: '600',
  },
  footerArea: {
    gap: Spacing.md,
  },
  instanceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 7,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  instanceChipText: {
    fontSize: FontSize.sm,
    fontWeight: '600',
  },
  instanceEditor: {
    borderWidth: 1,
    gap: Spacing.md,
  },
  instanceHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  instanceHeaderCopy: {
    flex: 1,
    gap: 2,
  },
  instanceTitle: {
    fontSize: FontSize.base,
    fontWeight: '700',
  },
  instanceSubtitle: {
    fontSize: FontSize.sm,
    lineHeight: 18,
  },
  instanceError: {
    fontSize: FontSize.sm,
    lineHeight: 19,
  },
  instanceActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  footer: {
    textAlign: 'center',
    fontSize: FontSize.xs,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
});
