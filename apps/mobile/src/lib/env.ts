import Constants from 'expo-constants';

import type { DeploymentKind } from '@beisammen/contracts';

function readExpoExtra(name: string): string | undefined {
  const maybePublicEnv = Constants.expoConfig?.extra?.publicEnv;

  if (!maybePublicEnv || typeof maybePublicEnv !== 'object' || Array.isArray(maybePublicEnv)) {
    return undefined;
  }

  const value = (maybePublicEnv as Record<string, unknown>)[name];
  return typeof value === 'string' ? value : undefined;
}

function readOptionalPublicEnv(name: string, fallback = ''): string {
  const processValue = process.env[name];

  if (typeof processValue === 'string' && processValue.length > 0) {
    return processValue;
  }

  const extraValue = readExpoExtra(name);
  return typeof extraValue === 'string' ? extraValue : fallback;
}

function requirePublicEnv(name: string): string {
  const value = readOptionalPublicEnv(name);

  if (value.trim().length > 0) {
    return value;
  }

  throw new Error(
    `Missing required Expo public env var ${name}. Configure it in your mobile env before starting the app.`,
  );
}

/**
 * The scheme registered natively is the source of truth (app.config.ts derives
 * a `-dev` variant for development builds); the env var is only a fallback.
 */
function readNativeScheme(): string {
  const configured = Constants.expoConfig?.scheme;
  const nativeScheme = Array.isArray(configured) ? configured[0] : configured;

  if (typeof nativeScheme === 'string' && nativeScheme.length > 0) {
    return nativeScheme;
  }

  return readOptionalPublicEnv('EXPO_PUBLIC_APP_SCHEME', 'beisammen');
}

function readDeploymentKind(): DeploymentKind {
  const deploymentKind = readOptionalPublicEnv('EXPO_PUBLIC_DEFAULT_DEPLOYMENT_KIND', 'cloud');

  if (deploymentKind === 'cloud' || deploymentKind === 'self-hosted') {
    return deploymentKind;
  }

  throw new Error(
    `Invalid EXPO_PUBLIC_DEFAULT_DEPLOYMENT_KIND "${deploymentKind}". Expected "cloud" or "self-hosted".`,
  );
}

const defaultInstanceUrl = requirePublicEnv('EXPO_PUBLIC_DEFAULT_INSTANCE_URL');
const defaultConvexUrl = requirePublicEnv('EXPO_PUBLIC_DEFAULT_CONVEX_URL');

export const appEnv = {
  appEnv: readOptionalPublicEnv('EXPO_PUBLIC_APP_ENV', 'development'),
  appVersion: Constants.expoConfig?.version ?? '0.1.0',
  appScheme: readNativeScheme(),
  defaultInstanceId: readOptionalPublicEnv('EXPO_PUBLIC_DEFAULT_INSTANCE_ID', 'default'),
  defaultInstanceName: readOptionalPublicEnv('EXPO_PUBLIC_DEFAULT_INSTANCE_NAME', 'beisammen'),
  defaultInstanceUrl,
  defaultConvexUrl,
  defaultAuthProvider: 'clerk' as const,
  defaultDeploymentKind: readDeploymentKind(),
  clerkPublishableKey: requirePublicEnv('EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY'),
  revenueCatTestApiKey: readOptionalPublicEnv('EXPO_PUBLIC_REVENUECAT_TEST_API_KEY'),
  revenueCatIosApiKey: readOptionalPublicEnv('EXPO_PUBLIC_REVENUECAT_IOS_API_KEY'),
  revenueCatAndroidApiKey: readOptionalPublicEnv('EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY'),
  logLevel: readOptionalPublicEnv('EXPO_PUBLIC_LOG_LEVEL'),
};
