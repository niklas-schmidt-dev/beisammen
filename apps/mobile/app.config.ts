import type { ExpoConfig } from 'expo/config';

const publicEnv = {
  EXPO_PUBLIC_APP_ENV: process.env.EXPO_PUBLIC_APP_ENV ?? 'development',
  EXPO_PUBLIC_APP_SCHEME: process.env.EXPO_PUBLIC_APP_SCHEME ?? 'beisammen',
  EXPO_PUBLIC_DEFAULT_INSTANCE_ID: process.env.EXPO_PUBLIC_DEFAULT_INSTANCE_ID ?? '',
  EXPO_PUBLIC_DEFAULT_INSTANCE_NAME: process.env.EXPO_PUBLIC_DEFAULT_INSTANCE_NAME ?? '',
  EXPO_PUBLIC_DEFAULT_INSTANCE_URL: process.env.EXPO_PUBLIC_DEFAULT_INSTANCE_URL ?? '',
  EXPO_PUBLIC_DEFAULT_CONVEX_URL: process.env.EXPO_PUBLIC_DEFAULT_CONVEX_URL ?? '',
  EXPO_PUBLIC_DEFAULT_DEPLOYMENT_KIND:
    process.env.EXPO_PUBLIC_DEFAULT_DEPLOYMENT_KIND ?? '',
  EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY:
    process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '',
  EXPO_PUBLIC_REVENUECAT_TEST_API_KEY:
    process.env.EXPO_PUBLIC_REVENUECAT_TEST_API_KEY ?? '',
  EXPO_PUBLIC_REVENUECAT_IOS_API_KEY:
    process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY ?? '',
  EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY:
    process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY ?? '',
  EXPO_PUBLIC_EAS_PROJECT_ID:
    process.env.EXPO_PUBLIC_EAS_PROJECT_ID ?? process.env.EAS_BUILD_PROJECT_ID ?? '',
  EXPO_PUBLIC_LOG_LEVEL: process.env.EXPO_PUBLIC_LOG_LEVEL ?? '',
} as const;

// Development builds ship as a separate app ("beisammen dev", bundle id
// app.beisammen.app.dev, scheme <scheme>-dev) so they can be installed next
// to the App Store build on the same device, e.g. for on-device e2e runs.
// Clerk native SSO must allowlist `<scheme>-dev://sso-callback` for dev builds.
const isDevelopmentBuild = publicEnv.EXPO_PUBLIC_APP_ENV === 'development';
const baseScheme = publicEnv.EXPO_PUBLIC_APP_SCHEME;
const scheme = isDevelopmentBuild ? `${baseScheme}-dev` : baseScheme;
const appName = isDevelopmentBuild ? 'beisammen dev' : 'beisammen';
const iosBundleIdentifier = isDevelopmentBuild
  ? 'app.beisammen.app.dev'
  : 'app.beisammen.app';
// Invite links are https://beisammen.app/connect?… so chat apps render them as
// links. Both platforms claim that path (Universal Links / App Links) and hand
// it to the same `connect` route the custom scheme uses. The matching
// association files live in apps/website/public/.well-known/.
const universalLinkHost = 'beisammen.app';
const easProjectId = publicEnv.EXPO_PUBLIC_EAS_PROJECT_ID.trim();
const mapsPluginConfig = {
  ...(process.env.GOOGLE_MAPS_ANDROID_API_KEY
    ? { androidGoogleMapsApiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY }
    : {}),
  ...(process.env.GOOGLE_MAPS_IOS_API_KEY
    ? { iosGoogleMapsApiKey: process.env.GOOGLE_MAPS_IOS_API_KEY }
    : {}),
};

const config: ExpoConfig = {
  name: appName,
  slug: 'beisammen-mobile',
  version: '1.1.0',
  // Keep production OTA updates scoped to the native app version. Expo
  // recommends this stable policy for EAS Update; fingerprint runtimes are
  // still experimental and can differ between local and clean EAS installs.
  runtimeVersion: { policy: 'appVersion' },
  ...(easProjectId
    ? { updates: { url: `https://u.expo.dev/${easProjectId}` } }
    : {}),
  scheme,
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  // Native window color behind all React views (e.g. visible during stack
  // swipe-back overscroll). Static light default; the root layout re-paints
  // it per color scheme at runtime via expo-system-ui.
  backgroundColor: '#F7F5F0',
  icon: './assets/images/icon.png',
  ios: {
    supportsTablet: false,
    bundleIdentifier: iosBundleIdentifier,
    // Local `expo run:ios --device` builds must sign with the paid team;
    // personal teams cannot sign Associated Domains / Sign in with Apple / Push.
    appleTeamId: '9537RR5SZS',
    associatedDomains: [`applinks:${universalLinkHost}`],
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      CFBundleDevelopmentRegion: 'de',
      CFBundleLocalizations: ['de', 'en'],
    },
  },
  locales: {
    de: './locales/de.json',
    en: './locales/en.json',
  },
  android: {
    package: 'app.beisammen.app',
    googleServicesFile: './google-services.json',
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: true,
        data: [
          { scheme: 'https', host: universalLinkHost, pathPrefix: '/connect' },
          { scheme: 'https', host: universalLinkHost, pathPrefix: '/en/connect' },
        ],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
    adaptiveIcon: {
      backgroundColor: '#F7F4EE',
      foregroundImage: './assets/images/android-icon-foreground.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
  },
  web: {
    output: 'static',
    favicon: './assets/images/favicon.png',
  },
  plugins: [
    '@clerk/expo',
    'expo-dev-client',
    'expo-image',
    [
      // Native splash: brand background only. The mark is drawn in by the
      // animated JS splash (components/splash/AnimatedSplash) for a seamless
      // color-matched handoff — iOS launch screens cannot animate natively.
      'expo-splash-screen',
      {
        backgroundColor: '#F7F5F0',
        android: {
          // Android 12+ requires an animated-icon drawable even when the
          // native splash intentionally shows only the background color.
          drawable: {
            icon: './assets/brand/android-splash-transparent.xml',
          },
        },
        dark: {
          backgroundColor: '#0C0C0E',
        },
      },
    ],
    [
      // Android status-bar icon must be a white-on-transparent glyph (the
      // system tints it); `color` is the accent used for the icon background
      // and channel light. iOS ignores both.
      'expo-notifications',
      {
        icon: './assets/images/notification-icon.png',
        color: '#1B6B45',
        defaultChannel: 'shares',
      },
    ],
    'expo-router',
    'expo-secure-store',
    'expo-sharing',
    'expo-status-bar',
    'expo-video',
    'expo-web-browser',
    'react-native-libsodium',
    // Narrow Android cleartext exemption for the loopback video proxy
    // (release builds); iOS already allows localhost via
    // NSAllowsLocalNetworking. react-native-tcp-socket itself autolinks and
    // needs no plugin.
    './plugins/with-localhost-cleartext.js',
    // Dev-only: lets Release-configured local device builds (on-device e2e)
    // run with the RevenueCat Test Store key instead of crashing at launch.
    './plugins/with-revenuecat-test-store-release.js',
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'beisammen kann optional deinen aktuellen Standort nutzen, um Medien ohne eingebettete GPS-Daten mit einem Ort zu ergänzen.',
      },
    ],
    Object.keys(mapsPluginConfig).length > 0
      ? [
          'react-native-maps',
          mapsPluginConfig,
        ]
      : 'react-native-maps',
    'react-native-compressor',
    [
      'expo-image-picker',
      {
        photosPermission:
          'beisammen benötigt Zugriff auf deine Fotos, um sie mit deinem Circle zu teilen.',
        cameraPermission:
          'beisammen benötigt Zugriff auf deine Kamera, um Fotos aufzunehmen.',
        microphonePermission:
          'beisammen benötigt Zugriff auf dein Mikrofon, um Videos aufzunehmen.',
      },
    ],
    [
      'expo-media-library',
      {
        isAccessMediaLocationEnabled: true,
        photosPermission:
          'beisammen benötigt Zugriff auf deine Mediathek, um gespeicherte Fotos und Videos zu laden.',
        savePhotosPermission:
          'beisammen benötigt Zugriff, um Fotos und Videos auf deinem Gerät zu speichern.',
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    // Expose the effective scheme so runtime code (Clerk SSO redirect) matches
    // the native registration even for the `-dev` variant.
    publicEnv: { ...publicEnv, EXPO_PUBLIC_APP_SCHEME: scheme },
    ...(easProjectId ? { eas: { projectId: easProjectId } } : {}),
  },
};

export default config;
