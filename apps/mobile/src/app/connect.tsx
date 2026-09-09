import { useLocalSearchParams, useRouter } from 'expo-router';
import { T, msg, useGT, useMessages } from 'gt-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { normalizeBaseUrl } from '@beisammen/contracts';

import { Button, Card } from '@/components/ui';
import { FontSize, Spacing } from '@/constants/theme';
import { useSession } from '@/features/auth/session-provider';
import { defaultInstanceConfig } from '@/features/instances/catalog';
import { resolveInstanceConfig } from '@/features/instances/discovery';
import { useMarkInteractive } from '@/features/observe/interactive';
import { useTheme } from '@/hooks/use-theme';

function firstParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

const statusMessages = {
  preparing: msg('Verbindung wird vorbereitet...'),
  checkingInstance: msg('Instanz wird geprüft...'),
  switchingInstance: msg('Instanz wird gewechselt...'),
};

const errorMessages = {
  missingParams: msg('Dieser Link enthält weder eine Instanz noch einen Invite-Token.'),
  unprocessable: msg('Dieser Link konnte nicht verarbeitet werden.'),
};

export default function ConnectScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { instance, isReady, session, setActiveInstance, setPendingInviteToken } = useSession();
  const params = useLocalSearchParams<{
    invite?: string | string[];
    instance?: string | string[];
  }>();
  const inviteToken = firstParam(params.invite)?.trim() ?? '';
  const explicitInstance = firstParam(params.instance)?.trim() ?? '';
  // A link without an explicit instance always means the built-in cloud
  // instance — never whatever (possibly self-hosted) instance happens to be
  // active on this device.
  const targetInstance = explicitInstance || defaultInstanceConfig.instance.baseUrl;
  const gt = useGT();
  const m = useMessages();
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(true);
  const [statusText, setStatusText] = useState<string>(statusMessages.preparing);

  // While the link is processed this screen only redirects; the target screen
  // reports interactivity. Mark here only when the error state is shown.
  useMarkInteractive(isReady && !isProcessing);

  useEffect(() => {
    if (!isReady) {
      return;
    }

    const controller = new AbortController();

    async function handleLink() {
      const hasInviteToken = inviteToken.length > 0;
      const hasExplicitInstance = explicitInstance.length > 0;

      setError(null);
      setIsProcessing(true);
      setStatusText(statusMessages.preparing);

      if (!hasInviteToken && !hasExplicitInstance) {
        setError(errorMessages.missingParams);
        setIsProcessing(false);
        return;
      }

      if (normalizeBaseUrl(targetInstance) !== normalizeBaseUrl(instance.instance.baseUrl)) {
        setStatusText(statusMessages.checkingInstance);
        // The built-in cloud config is trusted as shipped; only foreign
        // instances need their discovery manifest validated first.
        const nextInstance = hasExplicitInstance
          ? await resolveInstanceConfig(targetInstance, { signal: controller.signal })
          : defaultInstanceConfig;

        setStatusText(statusMessages.switchingInstance);
        await setActiveInstance(
          nextInstance,
          hasInviteToken ? { pendingInviteToken: inviteToken } : undefined,
        );

        if (!controller.signal.aborted) {
          router.replace('/');
        }

        return;
      }

      if (hasInviteToken) {
        await setPendingInviteToken(inviteToken);
      }

      if (!controller.signal.aborted) {
        router.replace(
          session ? (hasInviteToken ? '/invite' : '/home') : '/(auth)/sign-in',
        );
      }
    }

    void handleLink().catch((error: unknown) => {
      if (controller.signal.aborted) {
        return;
      }

      setError(
        error instanceof Error
          ? error.message
          : errorMessages.unprocessable,
      );
      setIsProcessing(false);
    });
    return () => {
      controller.abort();
    };
  }, [
    explicitInstance,
    instance.instance.baseUrl,
    inviteToken,
    isReady,
    router,
    session,
    setActiveInstance,
    setPendingInviteToken,
    targetInstance,
  ]);

  if (!isReady) {
    return null;
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <View style={styles.container}>
        {error ? (
          <Card>
            <T>
              <Text style={[styles.title, { color: theme.text }]}>
                Invite-Link konnte nicht geöffnet werden.
              </Text>
            </T>
            <Text style={[styles.body, { color: theme.textSecondary }]}>{m(error)}</Text>
            <Button
              label={session ? gt('Zur App') : gt('Zur Anmeldung')}
              icon={session ? 'arrow-forward-outline' : 'log-in-outline'}
              onPress={() => {
                router.replace(session ? '/home' : '/(auth)/sign-in');
              }}
            />
          </Card>
        ) : (
          <View style={styles.loading}>
            <ActivityIndicator color={theme.primary} />
            <Text style={[styles.body, { color: theme.textSecondary }]}>{m(statusText)}</Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
  },
  loading: {
    alignItems: 'center',
    gap: Spacing.md,
  },
  title: {
    fontSize: FontSize.xl,
    fontWeight: '700',
  },
  body: {
    fontSize: FontSize.base,
    lineHeight: 22,
  },
});
