import Ionicons from '@expo/vector-icons/Ionicons';
import * as Updates from 'expo-updates';
import { T, useGT } from 'gt-react-native';
import { Component, type PropsWithChildren, type ReactNode } from 'react';
import { Linking, Platform, StyleSheet, Text, View } from 'react-native';

import { useQuery } from 'convex/react';

import { isAppVersionSupported } from '@beisammen/contracts';

import { Button } from '@/components/ui';
import { Fonts, FontSize, Spacing } from '@/constants/theme';
import { api, type AppClientConfig } from '@/features/convex/api';
import { reloadWithBrandedScreen, useOtaUpdates } from '@/features/app-config/use-ota-updates';
import { useTheme } from '@/hooks/use-theme';
import { appEnv } from '@/lib/env';
import { createLogger } from '@/lib/logger';

const logger = createLogger('appConfig.gate');

const IOS_STORE_URL = 'https://apps.apple.com/app/id6762514050';
const ANDROID_STORE_URL =
  'https://play.google.com/store/apps/details?id=app.beisammen.app';

function openStore(): void {
  const url = Platform.OS === 'android' ? ANDROID_STORE_URL : IOS_STORE_URL;
  void Linking.openURL(url);
}

function isVersionBlocked(config: AppClientConfig): boolean {
  if (!config.minSupportedAppVersion) {
    return false;
  }

  try {
    return !isAppVersionSupported(appEnv.appVersion, config.minSupportedAppVersion);
  } catch (error) {
    // A malformed version string in the backend config must never lock out
    // every client — fail open.
    logger.warn('Ignoring unparseable minSupportedAppVersion', { error });
    return false;
  }
}

interface GateScreenProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: ReactNode;
  message: ReactNode;
  actions?: ReactNode;
}

function GateScreen({ icon, title, message, actions }: GateScreenProps) {
  const theme = useTheme();

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <View style={[styles.iconCircle, { backgroundColor: theme.primaryMuted }]}>
        <Ionicons name={icon} size={32} color={theme.primary} />
      </View>
      {title}
      {message}
      {actions ? <View style={styles.actions}>{actions}</View> : null}
    </View>
  );
}

function UpdateRequiredScreen({ config }: { config: AppClientConfig }) {
  const theme = useTheme();
  const gt = useGT();
  const { isUpdatePending } = Updates.useUpdates();

  return (
    <GateScreen
      icon="arrow-up-circle-outline"
      title={
        <T>
          <Text style={[styles.title, { color: theme.text }]}>Update erforderlich</Text>
        </T>
      }
      message={
        config.forceUpdateMessage ? (
          <Text style={[styles.message, { color: theme.textSecondary }]}>
            {config.forceUpdateMessage}
          </Text>
        ) : (
          <T>
            <Text style={[styles.message, { color: theme.textSecondary }]}>
              Diese Version von beisammen wird nicht mehr unterstützt. Installiere das
              aktuelle Update, um weiterzumachen.
            </Text>
          </T>
        )
      }
      actions={
        <>
          {isUpdatePending ? (
            <Button
              label={gt('Neu starten')}
              icon="refresh-outline"
              onPress={() => void reloadWithBrandedScreen()}
            />
          ) : null}
          <Button
            label={gt('Update laden')}
            icon="download-outline"
            variant={isUpdatePending ? 'outline' : 'primary'}
            onPress={openStore}
          />
        </>
      }
    />
  );
}

function MaintenanceScreen({ config }: { config: AppClientConfig }) {
  const theme = useTheme();

  return (
    <GateScreen
      icon="construct-outline"
      title={
        <T>
          <Text style={[styles.title, { color: theme.text }]}>Kurze Pause</Text>
        </T>
      }
      message={
        config.maintenanceMessage ? (
          <Text style={[styles.message, { color: theme.textSecondary }]}>
            {config.maintenanceMessage}
          </Text>
        ) : (
          <T>
            <Text style={[styles.message, { color: theme.textSecondary }]}>
              beisammen wird gerade gewartet und ist gleich wieder da. Danke für deine
              Geduld!
            </Text>
          </T>
        )
      }
    />
  );
}

function AppConfigGateInner({ children }: PropsWithChildren) {
  const config = useQuery(api.appConfig.get, {});

  // Loading (undefined) and unset config (null) both fail open — the gate
  // must never block the app on a slow or offline connection.
  if (config === undefined || config === null) {
    return <>{children}</>;
  }

  if (config.maintenanceMode) {
    return <MaintenanceScreen config={config} />;
  }

  if (isVersionBlocked(config)) {
    return <UpdateRequiredScreen config={config} />;
  }

  return <>{children}</>;
}

interface GateErrorBoundaryProps extends PropsWithChildren {
  fallback: ReactNode;
}

/**
 * Backends that predate `appConfig:get` (older self-hosted instances) make
 * the gate query throw. The gate is a safety net, never a hard dependency,
 * so any error renders the app as if no restrictions were configured.
 */
class GateErrorBoundary extends Component<GateErrorBoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    logger.warn('App-config gate unavailable, failing open', { error });
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/**
 * Reactive kill switch driven by the backend's `appConfig` document: blocks
 * the UI with a maintenance or force-update screen the moment the config
 * changes. Also keeps OTA updates flowing in the background.
 */
export function AppConfigGate({ children }: PropsWithChildren) {
  useOtaUpdates();

  return (
    <GateErrorBoundary fallback={children}>
      <AppConfigGateInner>{children}</AppConfigGateInner>
    </GateErrorBoundary>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing['2xl'],
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: FontSize.xl,
    fontWeight: '700',
    letterSpacing: -0.4,
    textAlign: 'center',
  },
  message: {
    fontSize: FontSize.base,
    lineHeight: 22,
    textAlign: 'center',
  },
  actions: {
    alignSelf: 'stretch',
    gap: Spacing.sm,
    marginTop: Spacing.lg,
  },
});
