/**
 * The only supported storage provider. The legacy 'convex-files' code path has
 * been removed; remaining legacy rows are moved to S3 via
 * `convex/legacyStorage.ts` and only the schema unions still admit them.
 */
export type StorageProviderKind = 's3';

export type AssetKind = 'image' | 'video';
export type UploadStatus = 'draft' | 'processing' | 'uploading' | 'uploaded' | 'failed';
export type AuthProvider = 'clerk';
export type AuthMode = 'native';
export type AuthCapability = 'password' | 'email_otp' | 'social' | 'hosted_sso';
export type DeploymentKind = 'cloud' | 'self-hosted';
export type BillingProviderKind = 'revenuecat';
export type NotificationKind =
  | 'share.published'
  | 'comment.created'
  | 'reaction.set'
  | 'member.joined';
/** Languages push copy is rendered in; unknown device locales fall back to 'de'. */
export type NotificationLocale = 'de' | 'en';
export type NotificationDeliveryStatus = 'queued' | 'skipped' | 'delivered' | 'failed';
export type MediaLocationSource = 'embedded' | 'device-fallback';
export type PublicConfigValue = string | number | boolean | null;

export const INSTANCE_DISCOVERY_PATH = '/.well-known/beisammen-instance.json';

/**
 * Hard per-file ceilings for uploads. The client declares exact byte sizes when
 * requesting an upload target; the server validates them against these bounds
 * and signs the declared `content-length` into the presigned PUT so storage
 * enforces the exact size.
 */
export const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 ** 3;
/** Compressed preview JPEGs stay small; anything larger is rejected. */
export const MAX_PREVIEW_SIZE_BYTES = 5 * 1024 * 1024;
/** Avatar and circle images (single client-prepared images). */
export const MAX_IMAGE_UPLOAD_SIZE_BYTES = 25 * 1024 * 1024;
export const COMMENT_MAX_BODY_LENGTH = 1000;
/** Share captions are short by design; the composer and the edit flow share this bound. */
export const SHARE_CAPTION_MAX_LENGTH = 240;
export const REACTION_TOP_EMOJI_LIMIT = 3;
/**
 * Minimum password length for new accounts. Mirrors the Clerk Dashboard
 * password policy so the sign-up form can show progress before submitting;
 * Clerk stays the authority and still rejects shorter passwords server-side.
 */
export const PASSWORD_MIN_LENGTH = 15;

/**
 * Invite codes: 10 symbols from the Crockford base32 alphabet (no 0/O or
 * 1/I/L ambiguity), shown as `XXXXX-XXXXX`. The same string rides in the
 * invite link's `invite` parameter and inside the QR code, so link, code and
 * scan all resolve to one credential. 50 bits of entropy plus per-user rate
 * limits on lookup and accept keep guessing impractical.
 */
export const INVITE_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const INVITE_CODE_LENGTH = 10;

/**
 * Canonical form of a typed or scanned invite code: uppercase, without
 * separators, with the usual misreads folded (O→0, I/L→1). Returns null when
 * the input is not a short code, e.g. a legacy UUID token, so callers keep
 * those untouched.
 */
export function normalizeInviteCode(raw: string): string | null {
  const folded = raw
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');

  if (folded.length !== INVITE_CODE_LENGTH) {
    return null;
  }

  for (const symbol of folded) {
    if (!INVITE_CODE_ALPHABET.includes(symbol)) {
      return null;
    }
  }

  return folded;
}

/** Display form with a separator in the middle: `K7MF3-QX9WD`. */
export function formatInviteCode(code: string): string {
  const half = Math.ceil(code.length / 2);
  return `${code.slice(0, half)}-${code.slice(half)}`;
}

export const SUPPORTED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/heic',
  'image/heif',
  'image/webp',
] as const;

export const SUPPORTED_VIDEO_MIME_TYPES = [
  'video/mp4',
  'video/quicktime',
  'video/mov',
] as const;

export interface MediaLocation {
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
  label?: string;
  city?: string;
  region?: string;
  country?: string;
  source: MediaLocationSource;
}

export interface EngagementReactionSummary {
  emoji: string;
  count: number;
  reactedByViewer: boolean;
}

export interface EngagementSummary {
  commentCount: number;
  reactionCount: number;
  topReactions: EngagementReactionSummary[];
}

type GraphemeSegment = {
  segment: string;
};

type SegmenterLike = {
  segment(value: string): Iterable<GraphemeSegment>;
};

type SegmenterConstructor = new (
  locale: string | undefined,
  options: { granularity: 'grapheme' },
) => SegmenterLike;

function splitGraphemes(value: string): string[] {
  const segmenterConstructor = (Intl as unknown as { Segmenter?: SegmenterConstructor }).Segmenter;

  if (!segmenterConstructor) {
    return Array.from(value);
  }

  const segmenter = new segmenterConstructor(undefined, { granularity: 'grapheme' });
  return Array.from(segmenter.segment(value), (segment) => segment.segment);
}

function isEmojiGrapheme(value: string): boolean {
  return (
    /\p{Extended_Pictographic}/u.test(value) ||
    /^(?:\p{Regional_Indicator}){2}$/u.test(value) ||
    /^[0-9#*]\uFE0F?\u20E3$/u.test(value)
  );
}

export function normalizeCommentBody(body: string): string {
  const normalized = body.replace(/\r\n?/g, '\n').trim();

  if (normalized.length === 0) {
    throw new Error('Comment body is required.');
  }

  if (normalized.length > COMMENT_MAX_BODY_LENGTH) {
    throw new Error(`Comments must be ${COMMENT_MAX_BODY_LENGTH} characters or shorter.`);
  }

  return normalized;
}

/**
 * Trims a share caption and enforces the length bound. Returns `undefined`
 * for an empty caption so callers can clear the field instead of storing ''.
 */
export function normalizeShareCaption(caption: string | undefined): string | undefined {
  const normalized = (caption ?? '').replace(/\r\n?/g, '\n').trim();

  if (normalized.length === 0) {
    return undefined;
  }

  if (normalized.length > SHARE_CAPTION_MAX_LENGTH) {
    throw new Error(`Captions must be ${SHARE_CAPTION_MAX_LENGTH} characters or shorter.`);
  }

  return normalized;
}

export function normalizeReactionEmoji(value: string): string {
  const normalized = value.trim().normalize('NFC');
  const graphemes = splitGraphemes(normalized);

  if (graphemes.length !== 1) {
    throw new Error('Reaction must be a single emoji.');
  }

  const [emoji] = graphemes;

  if (!emoji || !isEmojiGrapheme(emoji)) {
    throw new Error('Reaction must be an emoji.');
  }

  return emoji;
}

export interface InstanceConfig {
  instance: {
    id: string;
    name: string;
    baseUrl: string;
  };
  backend: {
    convexUrl: string;
  };
  auth: {
    provider: AuthProvider;
    mode: AuthMode;
    capabilities: AuthCapability[];
    publicConfig: Record<string, PublicConfigValue>;
  };
  features: {
    storageProviders: StorageProviderKind[];
    selfHosted: boolean;
  };
  deployment: {
    kind: DeploymentKind;
  };
  billing:
    | {
        enabled: true;
        provider: BillingProviderKind;
        plans?: BillingPlanSummary[];
      }
    | {
        enabled: false;
        provider?: never;
        plans?: never;
      };
  client: {
    minimumAppVersion: string;
  };
}

export interface BillingPlanSummary {
  id: string;
  name: string;
  description?: string;
  monthlyPriceLabel?: string;
  yearlyPriceLabel?: string;
}

export interface BillingBalanceSummary {
  featureId: string;
  granted: number | null;
  remaining: number | null;
  usage: number | null;
  unlimited: boolean;
  overageAllowed: boolean;
  nextResetAt: number | null;
}

export interface BillingSubscriptionSummary {
  planId: string;
  status: string;
  currentPeriodEnd?: number | null;
}

export type BillingStatus =
  | {
      deployment: 'self-hosted';
      billing: {
        enabled: false;
        configured: false;
      };
      plans: [];
      activePlanIds: [];
      subscriptions: [];
      balances: [];
    }
  | {
      deployment: 'cloud';
      billing: {
        enabled: true;
        configured: boolean;
        provider: 'revenuecat';
        customerId?: string;
      };
      plans: BillingPlanSummary[];
      activePlanIds: string[];
      subscriptions: BillingSubscriptionSummary[];
      balances: BillingBalanceSummary[];
      managementUrl?: string | null;
    };

export interface CircleUploadReadiness {
  deployment: DeploymentKind;
  canUpload: boolean;
  viewerIsBillingOwner: boolean;
  billingRequired: boolean;
  reason:
    | 'self_hosted'
    | 'ready'
    | 'billing_not_configured'
    | 'plan_required'
    | 'quota_exceeded'
    | 'billing_check_failed';
  message: string;
}

export interface CircleCreationReadiness {
  deployment: DeploymentKind;
  canCreate: boolean;
  billingRequired: boolean;
  reason:
    | 'self_hosted'
    | 'ready'
    | 'billing_not_configured'
    | 'plan_required'
    | 'limit_reached'
    | 'billing_check_failed';
  message: string;
  usedCircles: number | null;
  maxCircles: number | null;
}

/** Result of `billing.syncPurchases`: on-demand RevenueCat → Convex reconciliation. */
export interface PurchaseSyncResult {
  status:
    | 'synced'
    | 'failed'
    | 'not_configured'
    | 'self_hosted'
    | 'billing_not_configured';
  activePlanId: string | null;
}

export interface NotificationDeviceRegistration {
  deviceId: string;
  instanceUrl: string;
  platform: 'ios' | 'android' | 'web' | 'unknown';
  provider: 'expo';
  registeredAt: number;
}

export interface NotificationPreference {
  kind: NotificationKind;
  enabled: boolean;
  updatedAt: number | null;
}

export interface AppSession {
  instanceUrl: string;
  provider: AuthProvider;
  subject: string;
  email?: string;
  displayName?: string;
  avatarUrl?: string;
  expiresAt?: number;
  capabilities: AuthCapability[];
}

const authProviders: AuthProvider[] = ['clerk'];
const authModes: AuthMode[] = ['native'];
const authCapabilities: AuthCapability[] = [
  'password',
  'email_otp',
  'social',
  'hosted_sso',
];
const storageProviders: StorageProviderKind[] = ['s3'];
const deploymentKinds: DeploymentKind[] = ['cloud', 'self-hosted'];
const billingProviders: BillingProviderKind[] = ['revenuecat'];

type ParsedAppVersion = {
  parts: [number, number, number];
  prerelease: string[] | null;
};

function normalizeVersionComparison(value: number): -1 | 0 | 1 {
  if (value < 0) {
    return -1;
  }

  if (value > 0) {
    return 1;
  }

  return 0;
}

function parseAppVersion(value: string, fieldName: string): ParsedAppVersion {
  const trimmed = value.trim();
  const withoutBuildMetadata = trimmed.split('+', 1)[0];
  const [core, prereleaseValue] = withoutBuildMetadata.split('-', 2);
  const identifiers = core.split('.');

  if (
    trimmed.length === 0 ||
    identifiers.length > 3 ||
    identifiers.some((identifier) => !/^\d+$/.test(identifier))
  ) {
    throw new Error(`${fieldName} must be a semantic app version.`);
  }

  return {
    parts: [
      Number(identifiers[0]),
      Number(identifiers[1] ?? 0),
      Number(identifiers[2] ?? 0),
    ],
    prerelease:
      prereleaseValue && prereleaseValue.trim().length > 0
        ? prereleaseValue.split('.')
        : null,
  };
}

function comparePrereleaseVersions(
  left: string[] | null,
  right: string[] | null,
): -1 | 0 | 1 {
  if (!left && !right) {
    return 0;
  }

  if (!left) {
    return 1;
  }

  if (!right) {
    return -1;
  }

  const maxLength = Math.max(left.length, right.length);

  for (let index = 0; index < maxLength; index += 1) {
    const leftValue = left[index];
    const rightValue = right[index];

    if (leftValue === undefined) {
      return -1;
    }

    if (rightValue === undefined) {
      return 1;
    }

    if (leftValue === rightValue) {
      continue;
    }

    const leftIsNumeric = /^\d+$/.test(leftValue);
    const rightIsNumeric = /^\d+$/.test(rightValue);

    if (leftIsNumeric && rightIsNumeric) {
      return normalizeVersionComparison(Number(leftValue) - Number(rightValue));
    }

    if (leftIsNumeric) {
      return -1;
    }

    if (rightIsNumeric) {
      return 1;
    }

    return normalizeVersionComparison(leftValue.localeCompare(rightValue));
  }

  return 0;
}

export function compareAppVersions(
  currentVersion: string,
  minimumVersion: string,
): -1 | 0 | 1 {
  const current = parseAppVersion(currentVersion, 'current app version');
  const minimum = parseAppVersion(minimumVersion, 'minimum app version');

  for (let index = 0; index < current.parts.length; index += 1) {
    const compared = normalizeVersionComparison(
      current.parts[index] - minimum.parts[index],
    );

    if (compared !== 0) {
      return compared;
    }
  }

  return comparePrereleaseVersions(current.prerelease, minimum.prerelease);
}

export function isAppVersionSupported(
  currentVersion: string,
  minimumVersion: string,
): boolean {
  return compareAppVersions(currentVersion, minimumVersion) >= 0;
}

export function assertAppVersionSupported(
  currentVersion: string,
  minimumVersion: string,
): void {
  if (isAppVersionSupported(currentVersion, minimumVersion)) {
    return;
  }

  throw new Error(
    `This instance requires app version ${minimumVersion} or newer. Current app version is ${currentVersion}.`,
  );
}

export type S3StorageReference = {
  provider: 's3';
  objectKey: string;
  bucket: string;
  region?: string;
  endpoint?: string;
  basePath?: string;
};

export type StorageReference = S3StorageReference;

export type UploadTarget = {
  provider: 's3';
  uploadUrl: string;
  method: 'PUT';
  objectKey: string;
  expiresAt: number;
  headers?: Record<string, string>;
};

export interface SignedReadUrl {
  url: string | null;
  expiresAt: number | null;
}

export interface ConnectionCheck {
  ok: boolean;
  message: string;
}

export interface InstanceStorageStatus {
  providerKind: StorageProviderKind;
  label: string;
  bucket?: string;
  region?: string;
  endpoint?: string;
  basePath?: string;
}

export interface StorageUsageStats {
  imageCount: number;
  videoCount: number;
  totalSizeBytes: number;
  circleCount: number;
  isTruncated: boolean;
}

export interface CircleUsageBreakdownItem {
  circleId: string;
  name: string;
  hasImage: boolean;
  imageKey?: string;
  isOwner: boolean;
  memberCount: number;
  imageCount: number;
  videoCount: number;
  totalSizeBytes: number;
}

export interface CircleUsageBreakdown {
  circles: CircleUsageBreakdownItem[];
  isTruncated: boolean;
}

export interface CreateUploadTargetInput {
  circleId: string;
  shareBatchId: string;
  mimeType: string;
  kind: AssetKind;
  fileName: string;
  /** Exact byte size of the original file; signed into the presigned PUT. */
  sizeBytes: number;
  /** Exact byte size of the compressed preview JPEG; signed into its PUT. */
  previewSizeBytes: number;
  /**
   * Exact byte size of a Live Photo's companion clip; signed into its own
   * PUT. Only valid together with `pairedVideoMimeType` on image uploads.
   */
  pairedVideoSizeBytes?: number;
  pairedVideoMimeType?: string;
}

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

export function isAuthProvider(value: unknown): value is AuthProvider {
  return typeof value === 'string' && authProviders.includes(value as AuthProvider);
}

export function isAuthMode(value: unknown): value is AuthMode {
  return typeof value === 'string' && authModes.includes(value as AuthMode);
}

export function isAuthCapability(value: unknown): value is AuthCapability {
  return typeof value === 'string' && authCapabilities.includes(value as AuthCapability);
}

export function isStorageProviderKind(value: unknown): value is StorageProviderKind {
  return typeof value === 'string' && storageProviders.includes(value as StorageProviderKind);
}

export function isDeploymentKind(value: unknown): value is DeploymentKind {
  return typeof value === 'string' && deploymentKinds.includes(value as DeploymentKind);
}

export function isBillingProviderKind(value: unknown): value is BillingProviderKind {
  return typeof value === 'string' && billingProviders.includes(value as BillingProviderKind);
}

export interface BuildClerkInstanceConfigInput {
  id: string;
  name: string;
  baseUrl: string;
  convexUrl: string;
  authPublishableKey: string;
  capabilities?: AuthCapability[];
  deploymentKind?: DeploymentKind;
  billingPlans?: BillingPlanSummary[];
  /** @deprecated use deploymentKind instead. */
  selfHosted?: boolean;
  minimumAppVersion: string;
}

function normalizePublicUrl(value: string, fieldName: string): string {
  const trimmed = normalizeBaseUrl(value);

  try {
    const url = new URL(trimmed);

    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error(`${fieldName} must use http or https.`);
    }

    return normalizeBaseUrl(url.toString());
  } catch (error) {
    if (error instanceof Error && error.message.includes('must use http or https')) {
      throw error;
    }

    throw new Error(`${fieldName} must be a valid absolute URL.`);
  }
}

function requireRecord(value: unknown, fieldName: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${fieldName} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }

  return value.trim();
}

function requireBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${fieldName} must be a boolean.`);
  }

  return value;
}

function parseDeploymentKind(value: unknown, fallback: DeploymentKind): DeploymentKind {
  if (value === undefined) {
    return fallback;
  }

  if (!isDeploymentKind(value)) {
    throw new Error(`Unsupported deployment kind "${String(value)}".`);
  }

  return value;
}

function parseBillingPlans(value: unknown): BillingPlanSummary[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new Error('billing.plans must be an array.');
  }

  return value.map((plan, index) => {
    const record = requireRecord(plan, `billing.plans[${index}]`);

    return {
      id: requireString(record.id, `billing.plans[${index}].id`),
      name: requireString(record.name, `billing.plans[${index}].name`),
      ...(typeof record.description === 'string' && record.description.trim()
        ? { description: record.description.trim() }
        : {}),
      ...(typeof record.monthlyPriceLabel === 'string' && record.monthlyPriceLabel.trim()
        ? { monthlyPriceLabel: record.monthlyPriceLabel.trim() }
        : {}),
    };
  });
}

function buildBillingConfig(input: {
  deploymentKind: DeploymentKind;
  billing?: unknown;
  billingPlans?: BillingPlanSummary[];
}): InstanceConfig['billing'] {
  if (input.billing === undefined) {
    return input.deploymentKind === 'cloud'
      ? {
          enabled: true,
          provider: 'revenuecat',
          ...(input.billingPlans ? { plans: input.billingPlans } : {}),
        }
      : { enabled: false };
  }

  const billing = requireRecord(input.billing, 'billing');
  const enabled = requireBoolean(billing.enabled, 'billing.enabled');

  if (!enabled) {
    if (input.deploymentKind === 'cloud') {
      throw new Error('Cloud deployments must use RevenueCat billing.');
    }

    return { enabled: false };
  }

  if (!isBillingProviderKind(billing.provider)) {
    throw new Error('Cloud deployments must use RevenueCat billing.');
  }

  if (input.deploymentKind !== 'cloud') {
    throw new Error('Self-hosted deployments must not enable billing.');
  }

  const plans = parseBillingPlans(billing.plans);

  return {
    enabled: true,
    provider: billing.provider,
    ...(plans ? { plans } : {}),
  };
}

function isPublicConfigValue(value: unknown): value is PublicConfigValue {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

function parsePublicConfig(value: unknown): Record<string, PublicConfigValue> {
  const record = requireRecord(value, 'auth.publicConfig');
  const parsed: Record<string, PublicConfigValue> = {};

  for (const [key, configValue] of Object.entries(record)) {
    if (key.trim().length === 0) {
      throw new Error('auth.publicConfig keys must be non-empty strings.');
    }

    if (!isPublicConfigValue(configValue)) {
      throw new Error(`auth.publicConfig.${key} must be public JSON scalar value.`);
    }

    parsed[key] = configValue;
  }

  return parsed;
}

function requirePublicConfigString(
  publicConfig: Record<string, PublicConfigValue>,
  key: string,
  fieldName: string,
): string {
  return requireString(publicConfig[key], fieldName);
}

function validateConvexClientUrl(convexUrl: string): void {
  if (convexUrl.includes('.site')) {
    throw new Error('backend.convexUrl should be the Convex client URL, not the site URL.');
  }
}

function validateAuthPublicConfig(
  _mode: AuthMode,
  publicConfig: Record<string, PublicConfigValue>,
): void {
  const publishableKey = requirePublicConfigString(
    publicConfig,
    'publishableKey',
    'auth.publicConfig.publishableKey',
  );

  if (!publishableKey.startsWith('pk_')) {
    throw new Error('auth.publicConfig.publishableKey must be a Clerk publishable key.');
  }
}

function validateSelfHostedFlag(
  selfHosted: boolean,
  deploymentKind: DeploymentKind,
): void {
  if (selfHosted !== (deploymentKind === 'self-hosted')) {
    throw new Error('features.selfHosted must match deployment.kind.');
  }
}

function parseAuthCapabilities(value: unknown): AuthCapability[] {
  if (!Array.isArray(value)) {
    throw new Error('auth.capabilities must be an array.');
  }

  return value.map((capability) => {
    if (!isAuthCapability(capability)) {
      throw new Error(`Unsupported auth capability "${String(capability)}".`);
    }

    return capability;
  });
}

function parseStorageProviders(value: unknown): StorageProviderKind[] {
  if (!Array.isArray(value)) {
    throw new Error('features.storageProviders must be an array.');
  }

  return value.map((provider) => {
    if (!isStorageProviderKind(provider)) {
      throw new Error(`Unsupported storage provider "${String(provider)}".`);
    }

    return provider;
  });
}

export function buildInstanceDiscoveryUrl(baseUrl: string): string {
  return `${normalizePublicUrl(baseUrl, 'instance base URL')}${INSTANCE_DISCOVERY_PATH}`;
}

export function assertInstanceBaseUrlMatches(
  config: InstanceConfig,
  expectedBaseUrl: string,
): void {
  const expected = normalizePublicUrl(expectedBaseUrl, 'instance base URL');

  if (config.instance.baseUrl !== expected) {
    throw new Error(
      `instance.baseUrl ${config.instance.baseUrl} does not match requested instance URL ${expected}.`,
    );
  }
}

export function buildClerkInstanceConfig(
  input: BuildClerkInstanceConfigInput,
): InstanceConfig {
  const baseUrl = normalizePublicUrl(input.baseUrl, 'instance.baseUrl');
  const deploymentKind = input.deploymentKind ?? (input.selfHosted ? 'self-hosted' : 'cloud');
  const publishableKey = requireString(
    input.authPublishableKey,
    'auth.publicConfig.publishableKey',
  );

  if (!publishableKey.startsWith('pk_')) {
    throw new Error('auth.publicConfig.publishableKey must be a Clerk publishable key.');
  }

  return {
    instance: {
      id: requireString(input.id, 'instance.id'),
      name: requireString(input.name, 'instance.name'),
      baseUrl,
    },
    backend: {
      convexUrl: normalizePublicUrl(input.convexUrl, 'backend.convexUrl'),
    },
    auth: {
      provider: 'clerk',
      mode: 'native',
      capabilities: input.capabilities ?? [...authCapabilities],
      publicConfig: { publishableKey },
    },
    features: {
      storageProviders: ['s3'],
      selfHosted: deploymentKind === 'self-hosted',
    },
    deployment: {
      kind: deploymentKind,
    },
    billing: buildBillingConfig({
      deploymentKind,
      billingPlans: input.billingPlans,
    }),
    client: {
      minimumAppVersion: requireString(input.minimumAppVersion, 'client.minimumAppVersion'),
    },
  };
}

export function parseInstanceConfig(value: unknown): InstanceConfig {
  const root = requireRecord(value, 'instance config');
  const instance = requireRecord(root.instance, 'instance');
  const backend = requireRecord(root.backend, 'backend');
  const auth = requireRecord(root.auth, 'auth');
  const features = requireRecord(root.features, 'features');
  const fallbackDeploymentKind =
    features.selfHosted === true ? 'self-hosted' : 'cloud';
  const deployment =
    root.deployment === undefined
      ? { kind: fallbackDeploymentKind }
      : requireRecord(root.deployment, 'deployment');
  const deploymentKind = parseDeploymentKind(deployment.kind, fallbackDeploymentKind);
  const client = requireRecord(root.client, 'client');
  const provider = auth.provider;
  const mode = auth.mode;

  if (!isAuthProvider(provider)) {
    throw new Error(`Unsupported auth provider "${String(provider)}".`);
  }

  if (!isAuthMode(mode)) {
    throw new Error(`Unsupported auth mode "${String(mode)}".`);
  }

  const convexUrl = normalizePublicUrl(
    requireString(backend.convexUrl, 'backend.convexUrl'),
    'backend.convexUrl',
  );
  const publicConfig = parsePublicConfig(auth.publicConfig);
  const selfHosted =
    features.selfHosted === undefined
      ? deploymentKind === 'self-hosted'
      : requireBoolean(features.selfHosted, 'features.selfHosted');

  validateConvexClientUrl(convexUrl);
  validateAuthPublicConfig(mode, publicConfig);
  validateSelfHostedFlag(selfHosted, deploymentKind);

  return {
    instance: {
      id: requireString(instance.id, 'instance.id'),
      name: requireString(instance.name, 'instance.name'),
      baseUrl: normalizePublicUrl(
        requireString(instance.baseUrl, 'instance.baseUrl'),
        'instance.baseUrl',
      ),
    },
    backend: {
      convexUrl,
    },
    auth: {
      provider,
      mode,
      capabilities: parseAuthCapabilities(auth.capabilities),
      publicConfig,
    },
    features: {
      storageProviders: parseStorageProviders(features.storageProviders),
      selfHosted,
    },
    deployment: {
      kind: deploymentKind,
    },
    billing: buildBillingConfig({
      deploymentKind,
      billing: root.billing,
    }),
    client: {
      minimumAppVersion: requireString(client.minimumAppVersion, 'client.minimumAppVersion'),
    },
  };
}
