import { describe, expect, test } from 'vitest';

import {
  COMMENT_MAX_BODY_LENGTH,
  INSTANCE_DISCOVERY_PATH,
  REACTION_TOP_EMOJI_LIMIT,
  assertInstanceBaseUrlMatches,
  assertAppVersionSupported,
  buildInstanceDiscoveryUrl,
  buildClerkInstanceConfig,
  compareAppVersions,
  formatInviteCode,
  isAppVersionSupported,
  normalizeCommentBody,
  normalizeInviteCode,
  normalizeReactionEmoji,
  parseInstanceConfig,
} from './index';

describe('instance discovery', () => {
  test('compares app versions using semantic numeric precedence', () => {
    expect(compareAppVersions('0.1.0', '0.1.0')).toBe(0);
    expect(compareAppVersions('0.2.0', '0.1.9')).toBe(1);
    expect(compareAppVersions('0.1.0', '0.1.1')).toBe(-1);
    expect(compareAppVersions('1.0.0+5', '1.0.0')).toBe(0);
    expect(compareAppVersions('1.0.0-beta.2', '1.0.0')).toBe(-1);
  });

  test('checks whether an app version satisfies a minimum app version', () => {
    expect(isAppVersionSupported('0.1.0', '0.1.0')).toBe(true);
    expect(isAppVersionSupported('0.1.1', '0.1.0')).toBe(true);
    expect(isAppVersionSupported('0.0.9', '0.1.0')).toBe(false);
  });

  test('throws a useful error when the app version is below the manifest minimum', () => {
    expect(() => assertAppVersionSupported('0.0.9', '0.1.0')).toThrow(
      /requires app version 0\.1\.0 or newer/i,
    );
  });

  test('builds the well-known discovery URL from a base URL', () => {
    expect(buildInstanceDiscoveryUrl('https://family.example.com/')).toBe(
      `https://family.example.com${INSTANCE_DISCOVERY_PATH}`,
    );
  });

  test('accepts manifests whose base URL matches the requested instance URL', () => {
    const config = buildClerkInstanceConfig({
      id: 'family',
      name: 'Family',
      baseUrl: 'https://family.example.com/',
      convexUrl: 'https://family.convex.cloud/',
      authPublishableKey: 'pk_test_123',
      minimumAppVersion: '0.1.0',
    });

    expect(() =>
      assertInstanceBaseUrlMatches(config, 'https://family.example.com/'),
    ).not.toThrow();
  });

  test('rejects manifests whose base URL does not match the requested instance URL', () => {
    const config = buildClerkInstanceConfig({
      id: 'family',
      name: 'Family',
      baseUrl: 'https://other.example.com/',
      convexUrl: 'https://family.convex.cloud/',
      authPublishableKey: 'pk_test_123',
      minimumAppVersion: '0.1.0',
    });

    expect(() =>
      assertInstanceBaseUrlMatches(config, 'https://family.example.com/'),
    ).toThrow(/instance\.baseUrl.*does not match/i);
  });

  test('builds a public Clerk instance config', () => {
    expect(
      buildClerkInstanceConfig({
        id: 'family',
        name: 'Family',
        baseUrl: 'https://family.example.com/',
        convexUrl: 'https://family.convex.cloud/',
        authPublishableKey: 'pk_test_123',
        minimumAppVersion: '0.1.0',
      }),
    ).toMatchObject({
      instance: {
        id: 'family',
        name: 'Family',
        baseUrl: 'https://family.example.com',
      },
      backend: {
        convexUrl: 'https://family.convex.cloud',
      },
      auth: {
        provider: 'clerk',
        mode: 'native',
        publicConfig: {
          publishableKey: 'pk_test_123',
        },
      },
      features: {
        storageProviders: ['s3'],
        selfHosted: false,
      },
      deployment: {
        kind: 'cloud',
      },
      billing: {
        enabled: true,
        provider: 'revenuecat',
      },
      client: {
        minimumAppVersion: '0.1.0',
      },
    });
  });

  test('rejects publishable keys that are not Clerk publishable keys', () => {
    expect(() =>
      buildClerkInstanceConfig({
        id: 'family',
        name: 'Family',
        baseUrl: 'https://family.example.com/',
        convexUrl: 'https://family.convex.cloud/',
        authPublishableKey: 'sk_test_123',
        minimumAppVersion: '0.1.0',
      }),
    ).toThrow(/publishableKey/i);
  });

  test('builds self-hosted public config with billing disabled', () => {
    expect(
      buildClerkInstanceConfig({
        id: 'family',
        name: 'Family',
        baseUrl: 'https://family.example.com/',
        convexUrl: 'https://family.convex.cloud/',
        authPublishableKey: 'pk_test_123',
        deploymentKind: 'self-hosted',
        minimumAppVersion: '0.1.0',
      }),
    ).toMatchObject({
      features: {
        selfHosted: true,
      },
      deployment: {
        kind: 'self-hosted',
      },
      billing: {
        enabled: false,
      },
    });
  });

  test('parses valid public instance config and rejects invalid values', () => {
    const parsed = parseInstanceConfig({
      instance: {
        id: 'family',
        name: 'Family',
        baseUrl: 'https://family.example.com/',
      },
      backend: {
        convexUrl: 'https://family.convex.cloud/',
      },
      auth: {
        provider: 'clerk',
        mode: 'native',
        capabilities: ['password', 'email_otp'],
        publicConfig: {
          publishableKey: 'pk_test_123',
        },
      },
      features: {
        storageProviders: ['s3'],
        selfHosted: true,
      },
      deployment: {
        kind: 'self-hosted',
      },
      billing: {
        enabled: false,
      },
      client: {
        minimumAppVersion: '0.1.0',
      },
    });

    expect(parsed.instance.baseUrl).toBe('https://family.example.com');
    expect(parsed.backend.convexUrl).toBe('https://family.convex.cloud');

    expect(() =>
      parseInstanceConfig({
        ...parsed,
        features: {
          storageProviders: ['convex-files'],
          selfHosted: true,
        },
      }),
    ).toThrow(/storage provider/i);
  });

  test('rejects cloud config without RevenueCat billing', () => {
    expect(() =>
      parseInstanceConfig({
        instance: {
          id: 'cloud',
          name: 'Cloud',
          baseUrl: 'https://cloud.example.com',
        },
        backend: {
          convexUrl: 'https://cloud.convex.cloud',
        },
        auth: {
          provider: 'clerk',
          mode: 'native',
          capabilities: ['password'],
          publicConfig: {
            publishableKey: 'pk_test_123',
          },
        },
        features: {
          storageProviders: ['s3'],
          selfHosted: false,
        },
        deployment: {
          kind: 'cloud',
        },
        billing: {
          enabled: true,
          provider: 'stripe',
        },
        client: {
          minimumAppVersion: '0.1.0',
        },
      }),
    ).toThrow(/RevenueCat billing/i);
  });

  test('rejects manifests whose self-hosted flag does not match deployment kind', () => {
    expect(() =>
      parseInstanceConfig({
        instance: {
          id: 'cloud',
          name: 'Cloud',
          baseUrl: 'https://cloud.example.com',
        },
        backend: {
          convexUrl: 'https://cloud.convex.cloud',
        },
        auth: {
          provider: 'clerk',
          mode: 'native',
          capabilities: ['password'],
          publicConfig: {
            publishableKey: 'pk_test_123',
          },
        },
        features: {
          storageProviders: ['s3'],
          selfHosted: true,
        },
        deployment: {
          kind: 'cloud',
        },
        billing: {
          enabled: true,
          provider: 'revenuecat',
        },
        client: {
          minimumAppVersion: '0.1.0',
        },
      }),
    ).toThrow(/selfHosted.*deployment/i);
  });

  test('rejects manifests missing the Clerk publishable key', () => {
    expect(() =>
      parseInstanceConfig({
        instance: {
          id: 'cloud',
          name: 'Cloud',
          baseUrl: 'https://cloud.example.com',
        },
        backend: {
          convexUrl: 'https://cloud.convex.cloud',
        },
        auth: {
          provider: 'clerk',
          mode: 'native',
          capabilities: ['password'],
          publicConfig: {},
        },
        features: {
          storageProviders: ['s3'],
          selfHosted: false,
        },
        deployment: {
          kind: 'cloud',
        },
        billing: {
          enabled: true,
          provider: 'revenuecat',
        },
        client: {
          minimumAppVersion: '0.1.0',
        },
      }),
    ).toThrow(/publishableKey/i);
  });

  test('rejects manifests that use a Convex site URL as the client URL', () => {
    expect(() =>
      parseInstanceConfig({
        instance: {
          id: 'cloud',
          name: 'Cloud',
          baseUrl: 'https://cloud.example.com',
        },
        backend: {
          convexUrl: 'https://cloud.convex.site',
        },
        auth: {
          provider: 'clerk',
          mode: 'native',
          capabilities: ['password'],
          publicConfig: {
            publishableKey: 'pk_test_123',
          },
        },
        features: {
          storageProviders: ['s3'],
          selfHosted: false,
        },
        deployment: {
          kind: 'cloud',
        },
        billing: {
          enabled: true,
          provider: 'revenuecat',
        },
        client: {
          minimumAppVersion: '0.1.0',
        },
      }),
    ).toThrow(/Convex client URL/i);
  });
});

describe('engagement contracts', () => {
  test('normalizes comment bodies with the shared beta limit', () => {
    expect(COMMENT_MAX_BODY_LENGTH).toBe(1000);
    expect(normalizeCommentBody('  Hallo\r\nzusammen.  ')).toBe('Hallo\nzusammen.');
    expect(normalizeCommentBody('x'.repeat(COMMENT_MAX_BODY_LENGTH))).toBe(
      'x'.repeat(COMMENT_MAX_BODY_LENGTH),
    );
    expect(() => normalizeCommentBody('   \n  ')).toThrow(/comment body/i);
    expect(() => normalizeCommentBody('x'.repeat(COMMENT_MAX_BODY_LENGTH + 1))).toThrow(/1000/i);
  });

  test('normalizes one emoji grapheme for reactions and caps top reaction summaries', () => {
    expect(REACTION_TOP_EMOJI_LIMIT).toBe(3);
    expect(normalizeReactionEmoji('  👍🏽  ')).toBe('👍🏽');
    expect(normalizeReactionEmoji('❤️')).toBe('❤️');
    expect(normalizeReactionEmoji('7️⃣')).toBe('7️⃣');
    expect(() => normalizeReactionEmoji('ok')).toThrow(/emoji/i);
    expect(() => normalizeReactionEmoji('👍👍')).toThrow(/single emoji/i);
  });
});

describe('invite codes', () => {
  test('normalizes typed codes and folds common misreads', () => {
    expect(normalizeInviteCode(' k7mf3-qx9wd ')).toBe('K7MF3QX9WD');
    expect(normalizeInviteCode('K7MF3 QX9WD')).toBe('K7MF3QX9WD');
    expect(normalizeInviteCode('k7mf3-qxOwd')).toBe('K7MF3QX0WD');
    expect(normalizeInviteCode('k7mf3-qxIwl')).toBe('K7MF3QX1W1');
  });

  test('rejects anything that is not a short code', () => {
    expect(normalizeInviteCode('b02067d6-1c1a-4b7e-9a1c-6d2f1a3c9e10')).toBeNull();
    expect(normalizeInviteCode('K7MF3QX9W')).toBeNull();
    expect(normalizeInviteCode('K7MF3QX9WU')).toBeNull();
    expect(normalizeInviteCode('')).toBeNull();
  });

  test('formats codes with a separator in the middle', () => {
    expect(formatInviteCode('K7MF3QX9WD')).toBe('K7MF3-QX9WD');
  });
});
