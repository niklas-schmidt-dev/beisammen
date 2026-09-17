# Architecture

## Stack

- `apps/mobile`: Expo Router + React Native
- `convex/`: Convex schema and backend surface
- `apps/website`: React marketing and policy website
- `packages/*`: shared contracts, encryption primitives, and upload queue helpers

## System boundaries

- Convex stores app state and media metadata
- original media files stay in user-managed storage
- auth is standardized on Clerk across official and self-hosted deployments
- mobile only receives public configuration through local app config
- official cloud deployments use RevenueCat (via the `convex-revenuecat`
  component) for subscription entitlements; usage quotas are enforced by Convex
- self-hosted deployments disable billing and app-enforced media limits

## Instance contract

- the app starts with `EXPO_PUBLIC_DEFAULT_INSTANCE_URL` and defaults to a
  `cloud` deployment unless `EXPO_PUBLIC_DEFAULT_DEPLOYMENT_KIND` says
  `self-hosted`
- the app resolves the bundled default instance locally for first launch
- custom/self-hosted instances expose `/.well-known/beisammen-instance.json`
- the discovery manifest contains only public client config: instance identity,
  Convex client URL, Clerk publishable key,
  storage provider capabilities, deployment kind, billing provider/plan
  summaries, and minimum app version
- `https://beisammen.app/connect?instance=https://your-host` (or the legacy
  `beisammen://connect?…` scheme) switches the active instance locally after
  validating the manifest; without `instance` the built-in cloud instance is
  used
- invite links can include both `instance` and `invite`; invite tokens are
  stored under the selected instance URL
- the `invite` value is a 10-symbol Crockford base32 code (shown as
  `XXXXX-XXXXX`); the same code can be typed by hand or scanned from a QR
  code that encodes the https link, and lookups/accepts are rate-limited per
  user (`convex/rateLimit.ts`)

## Public vs secret configuration

Expo treats client-side runtime values as public. In practice that means:

- `EXPO_PUBLIC_*` values are bundled into the JS app
- `app.config.ts` is public app metadata and must not contain secrets
- `apps/mobile/eas.json` is local build metadata for this public snapshot

Repository policy:

- commit only public client configuration
- keep API keys, provider credentials, push credentials, and EAS tokens out of
  git
- keep Expo account ownership details and EAS project IDs out of the public
  snapshot

## Data model

- `users`
- `circles`
- `circleMembers`
- `invites`
- `publicCircleLinks`
- `shareBatches`
- `assets`
- `uploads`
- `memoryItems`
- `memoryMonths`
- `memoryPlaces`
- `activityEvents`
- `circleStats`

`circleStats` stores denormalized member and storage counters per circle. New
mutations maintain it directly. If a stats row is missing, mutation paths seed
one from the current bounded delta instead of recomputing the full circle
snapshot. Existing deployments should run `internal.circleStats.backfillBatch`
once after deploying the table so older circles have accurate stored counters
before operators rely on the values.

Interrupted uploads can leave `uploads` or `imageUploads` rows with pending S3
objects. `convex/crons.ts` runs `internal.mediaCleanup.cleanupStale` hourly with
scheduled continuation enabled, so routine cleanup drains stale rows in bounded
50-row batches. Operators can still run the same internal action manually after
crash recovery or during QA; it defaults to rows older than 24 hours, deletes
pending storage references first, and then removes stale `uploading` or `failed`
rows that have no completed asset.

`memoryItems` is the published-media timeline index used by the mobile Memories
tab. New uploads can store `assets.capturedAt` from device media metadata; older
published media should be backfilled with `internal.memories.backfillBatch`,
which uses `shareBatches.publishedAt` as the timeline fallback.
`memoryMonths` and `memoryPlaces` are lightweight discovery summaries for month
filters and the Places map. New published media maintains them directly. Existing
deployments with legacy memory rows should run
`internal.memories.backfillDiscoveryBatch` after `internal.memories.backfillBatch`;
use `dryRun=true` first to verify the bounded patch and summary counts.

`publicCircleLinks` is currently dormant: the public share-link feature (link
creation and revocation, the `/share` web viewer, and the `/public/share/preview`
HTTP endpoint) has been removed and will be rebuilt in an E2EE-compatible form.
The table definition stays in the schema so existing rows remain readable;
account deletion and admin purge paths still clean up its rows.

## Billing model

- `cloud`: `PUBLIC_DEPLOYMENT_KIND=cloud`; discovery advertises
  `billing.enabled=true` with provider `revenuecat`; the default public plan
  list is paid-only. RevenueCat `app_user_id` is the Convex user id
  (`Purchases.logIn(viewerId)` on mobile). Media usage for a circle is charged
  to that circle's `billingOwnerId` only. Invited members consume the owner's
  plan when they upload into that owner's circle; their own plan is not used for
  circles they do not own. Limits stay pooled across all circles owned by the
  paying user.
- Usage quotas are Convex-owned: RevenueCat only syncs subscription
  entitlements (`cloud_plus`, `cloud_max` — entitlement ids equal plan
  ids) through the `/webhooks/revenuecat` endpoint into component tables. Hard
  caps per tier live in `convex/lib/billing/plans.ts`; monthly upload counters
  (UTC calendar month, lazy `YYYY-MM` period rows in `billingUsage`) and a
  lifetime storage gauge (`billingStorage`) are checked and adjusted by
  `convex/lib/billing/quota.ts`. No overages.
- `self-hosted`: `PUBLIC_DEPLOYMENT_KIND=self-hosted`; discovery advertises
  `billing.enabled=false`; upload count and video duration beta limits are not
  enforced, while file type validation still applies.
- Plan labels shown in the mobile app come from `PUBLIC_BILLING_PLANS`, falling
  back to the repository paid plan defaults. Products, entitlements, and the
  `default` offering are configured in the RevenueCat dashboard; purchases run
  through native in-app purchases (`react-native-purchases`), and subscription
  management uses the RevenueCat Customer Center.
- Convex setup requires `app.use(revenuecat)` in `convex/convex.config.ts`,
  the shared client in `convex/revenuecat.ts`, and `REVENUECAT_WEBHOOK_AUTH`
  set in the Convex environment (matching the webhook Authorization header).
- `REVENUECAT_API_KEY` (a RevenueCat v1 API key; a secret key is preferred,
  a public SDK key also works for the subscriber endpoint) enables
  `billing.syncPurchases`: the app calls it right after a purchase or restore,
  and when the store reports an active entitlement the backend does not know
  yet, so plan-gated features unlock without depending on webhook delivery.
  Without the key the action is a no-op and webhooks remain the only path.

## Future services

`services/` is reserved for a Go storage gateway once provider sync, NAS
mounting, instance discovery helpers, or media processing justifies a separate
service.
