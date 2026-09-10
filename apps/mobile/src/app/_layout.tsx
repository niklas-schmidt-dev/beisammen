import 'expo-dev-client';

import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { ObserveRoot } from 'expo-observe';
import { Stack, usePathname, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import * as SystemUI from 'expo-system-ui';
import { StatusBar } from 'expo-status-bar';
import { GTProvider, initializeGT } from 'gt-react-native';
import { useEffect, useState } from 'react';
import { useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AnimatedSplash } from '@/components/splash/AnimatedSplash';
import { ScreenTransitionProvider } from '@/components/transition/screen-transition';
import { Colors } from '@/constants/theme';
import { SessionProvider } from '@/features/auth/session-provider';
import { ConvexAppProvider } from '@/features/convex/provider';
import { CryptoProvider } from '@/features/crypto/provider';
import { SplashDoneProvider } from '@/features/observe/interactive';
import { loadTranslations } from '@/i18n/load-translations';
import { createLogger } from '@/lib/logger';

import gtConfig from '../../gt.config.json';

export { AppErrorScreen as ErrorBoundary } from '@/features/observe/error-screen';

// Initialize General Translation once, at the module level, before rendering.
initializeGT({
  ...gtConfig,
  loadTranslations,
  projectId: process.env.EXPO_PUBLIC_GT_PROJECT_ID,
  devApiKey: process.env.EXPO_PUBLIC_GT_DEV_API_KEY,
});

// Keep the native splash up until the animated overlay has committed its
// first (color-matched) frame.
void SplashScreen.preventAutoHideAsync();
SplashScreen.setOptions({ fade: true, duration: 220 });

const logger = createLogger('navigation.root');

const lightNavTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: Colors.light.background,
    card: Colors.light.surface,
    text: Colors.light.text,
    border: Colors.light.border,
    primary: Colors.light.primary,
  },
};

const darkNavTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: Colors.dark.background,
    card: Colors.dark.surface,
    text: Colors.dark.text,
    border: Colors.dark.border,
    primary: Colors.dark.primary,
  },
};

function NavigationLogger() {
  const pathname = usePathname();
  const segments = useSegments();

  useEffect(() => {
    logger.debug('Route changed', {
      pathname,
      segments,
    });
  }, [pathname, segments]);

  return null;
}

function RootLayout() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const [isSplashDone, setIsSplashDone] = useState(false);

  useEffect(() => {
    logger.info('Root layout mounted', {
      colorScheme: scheme ?? 'unknown',
      isDark,
    });
  }, [isDark, scheme]);

  // Paint the native window behind the navigation stack. Without this, iOS
  // swipe-back overscroll reveals the default white UIWindow in dark mode.
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(
      isDark ? Colors.dark.background : Colors.light.background,
    );
  }, [isDark]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <GTProvider>
        <ThemeProvider value={isDark ? darkNavTheme : lightNavTheme}>
          <StatusBar style={isDark ? 'light' : 'dark'} />
          <SplashDoneProvider done={isSplashDone}>
            <ScreenTransitionProvider>
              <SessionProvider>
                <ConvexAppProvider>
                  <CryptoProvider>
                    <NavigationLogger />
                    <Stack screenOptions={{ headerShown: false }}>
                      <Stack.Screen name="index" />
                      <Stack.Screen name="(auth)" />
                      <Stack.Screen name="(app)" />
                    </Stack>
                  </CryptoProvider>
                </ConvexAppProvider>
              </SessionProvider>
            </ScreenTransitionProvider>
          </SplashDoneProvider>
          {!isSplashDone ? <AnimatedSplash onFinish={() => setIsSplashDone(true)} /> : null}
        </ThemeProvider>
      </GTProvider>
    </GestureHandlerRootView>
  );
}

export default ObserveRoot.wrap(RootLayout);
