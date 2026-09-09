# Private Beta QA Checklist

Run this checklist on a real iOS or Android development build against a Clerk
application and an S3-compatible bucket (AWS S3, R2, B2 S3, or MinIO).

## Environment

- `EXPO_PUBLIC_DEFAULT_INSTANCE_URL` points at the Convex site URL.
- `EXPO_PUBLIC_DEFAULT_CONVEX_URL` points at the matching Convex client URL.
- `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` carries the Clerk publishable key.
- `CLERK_JWT_ISSUER_DOMAIN`, `PUBLIC_AUTH_PUBLISHABLE_KEY`,
  `REVENUECAT_WEBHOOK_AUTH`, and `REVENUECAT_API_KEY` are configured on the
  Convex deployment.
- The Clerk instance allowlists `beisammen://sso-callback` (Native
  Applications) so Apple and Google sign-in complete instead of failing with
  "Redirect url mismatch".
- `@expo/dom-webview` is pinned in `apps/mobile/package.json` to the installed
  Expo SDK line. Expo declares it only as an optional peer (`*`), so pnpm
  otherwise keeps whatever stale version the lockfile has; a mismatched
  version is still autolinked and crashes Android at startup
  (`NoClassDefFoundError: expo.modules.kotlin.types.AnyTypeProvider`). After
  any Expo SDK bump, run `npx expo-doctor` and smoke-test a **release** build
  on Android before submitting to Google Play.
- `S3_BUCKET`, credentials, and optional `S3_REGION`, `S3_ENDPOINT`, and `S3_BASE_PATH` are configured.
- For Android release or development builds that render the Memories places
  map, enable Maps SDK for Android in Google Cloud and set
  `GOOGLE_MAPS_ANDROID_API_KEY` for the `react-native-maps` config plugin. Expo
  Go can be used for local map smoke tests without this binary config.
- In Settings, run the storage check and confirm the configured S3-compatible bucket reports success.
- For an existing deployment, run `internal.circleStats.backfillBatch` and confirm it finishes.
- For an existing deployment, run `internal.memories.backfillBatch` until
  `hasMore=false`, passing the returned `continueCursor` as `cursor` into the
  next run when `hasMore=true`, so published legacy media appears in Memories using
  publish dates as the fallback timeline date.
- Then run `internal.memories.backfillDiscoveryBatch` with `dryRun=true`; if the
  reported patch and summary counts look expected, run it without `dryRun`,
  passing each returned `continueCursor` as `cursor`, until `hasMore=false` so
  month filters and Places map summaries include legacy media.
- Run `internal.mediaCleanup.cleanupStale` once and confirm it returns a bounded
  result with no unexpected failures; the hourly cron uses the same action with
  scheduled continuation enabled for larger backlogs.
- Run `pnpm smoke:beta -- <instance-url> --app-version=<current-mobile-version>`
  before starting device QA, and confirm the command rejects deployments whose
  `client.minimumAppVersion` is newer than the app build under test.
- For a paired cloud/self-hosted release check, run
  `pnpm release:beta -- --cloud-url=<cloud-site-url> --self-hosted-url=<self-hosted-site-url> --app-version=<current-mobile-version>`.
- Start every manual pass from the JSON summary emitted by `pnpm release:beta`.
  Confirm `app-version`, `typecheck`, `tests`, cloud smoke, and self-hosted
  smoke checks are present and passing before device QA begins.
- Push delivery is intentionally skipped until `EXPO_PUSH_ACCESS_TOKEN` and the
  platform credentials are configured; skipped delivery rows should still be
  visible in Convex for inspection.

## Cloud Golden Path

- Sign in with Clerk, quit the app, reopen it, and confirm the session restores.
- With a fresh account that has no circles, confirm Home redirects to the
  guided onboarding screen.
- Create the first circle from onboarding and confirm it becomes the active circle.
- From onboarding, create a personal email-bound invite, confirm the native
  share sheet opens, and confirm the invite preview after sign-in only allows
  the matching email address to accept.
- From onboarding or circle management, create an open one-time invite, accept
  it from a second account, then open the same link from a third account and
  confirm it is shown as already used.
- Open an invite as an account that is already in the circle and confirm the
  invite is not consumed and the app shows the already-member state.
- Open Settings, confirm the billing card shows cloud billing with quota
  meters, and verify a sandbox in-app purchase and the RevenueCat Customer
  Center open for the owner account.
- Invite another account from circle management, open the invite link, sign in
  as that account, and accept it.
- Upload from the invited member into the owner's circle and confirm the owner
  plan is the one charged/limited.
- With no active owner plan, attempt media selection as the owner and confirm
  the draft sheet asks the owner to choose a plan before the picker opens.
- With no active owner plan, attempt media selection as an invited member and
  confirm the app says the Circle owner needs to activate billing without
  showing balances or customer details.
- Upload a large image and a large video; confirm each item shows upload
  progress and the app remains responsive during video upload.
- Interrupt one upload, reopen the app, retry the cached item, and confirm the
  draft remains recoverable while failed uploads can still be discarded.
- Publish the draft and confirm the feed shows previews, pagination works, and video cards do not try to render the original video as an image.
- Open share detail, play the video, save media to the device library, and use native sharing.
- On share detail, add a share-level comment, switch focus to the active
  medium, add an asset-level comment, and confirm each list only shows comments
  for the selected focus.
- Add a reaction, replace it with a different emoji, remove it, and confirm the
  feed summary plus share detail counts update after each step.
- As the comment author, delete your own comment; as the share author or a
  circle admin, delete another member's comment; confirm a regular member
  cannot delete another member's comment.
- Return to Home and confirm the activity section includes the publish,
  comment, and reaction events for the member's circles only.
- Open the Activity tab as the recipient, confirm unread badge count is shown,
  confirm visible rows become read, and confirm tapping share-level and
  asset-level rows opens the correct share and active medium.
- Open Memories, switch between "Zeitleiste" and "Orte", filter by a month and
  by a map marker/place chip, then open the full-screen viewer. Swipe vertically
  through several items, confirm videos pause when swiped away, and confirm
  "Gespräch öffnen" navigates to the focused share/medium.
- Register push notifications on a real device, publish/share/comment/react
  from another account, and confirm notification attempts are created. If
  provider credentials are missing, confirm attempts are skipped with
  `provider_not_configured`; once credentials are present, confirm notification
  taps open share detail and preserve `assetId` focus when present.
- Delete a draft asset, delete a published share, remove a member, and confirm counts update.
- After deleting a published share, confirm its comments, reactions, and
  activity and inbox rows no longer appear.

## Self-Hosted Golden Path

- Connect the central app with
  `https://beisammen.app/connect?instance=<self-host-url>` (tapped from a chat
  app, so the Universal Link / App Link path is exercised) and with the legacy
  `beisammen://connect?instance=<self-host-url>` scheme.
- Confirm the discovered manifest switches the active instance before sign-in.
- Raise `PUBLIC_MINIMUM_APP_VERSION` above the installed app version in a test
  deployment and confirm the connect link shows an update-required error instead
  of switching instances.
- Sign in with the self-hosted Clerk application.
- Open Settings and confirm billing is disabled.
- Upload more than the cloud beta media count or a video over the cloud duration
  cap, and confirm self-hosted app-level limits do not block it.
- Verify S3-compatible upload, preview read, original read, and delete.

## Recovery Path

- Start an upload, interrupt the app or network before completion, then reopen
  the app and confirm cached items can retry while server-only incomplete rows
  can still be discarded.
- Create or simulate stale `uploading`/`failed` rows older than 24 hours, run
  `internal.mediaCleanup.cleanupStale`, and confirm only stale incomplete rows
  and their pending storage references are removed. For more than 50 stale rows,
  confirm scheduled continuation drains follow-up batches.
- Confirm completed uploads with assets remain visible after cleanup.
- Open Settings, tap "Diagnose anzeigen", and confirm upload, auth refresh,
  instance switching, and notification registration failures are only exposed
  through that explicit action.

## Storage Targets

- AWS S3: upload, preview read, original read, delete.
- Cloudflare R2 or Backblaze B2 S3: upload, preview read, original read, delete.
- MinIO: upload, preview read, original read, delete.
