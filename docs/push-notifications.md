# Push notifications

Beisammen sends push notifications through the [Expo Push Service](https://docs.expo.dev/push-notifications/overview/).
The app obtains an `ExponentPushToken` per device and registers it with the
active instance; the instance's Convex backend queues delivery attempts and a
cron hands them to Expo, which relays them to APNs and FCM. Self-hosted
instances use the same app binary and therefore the same tokens, so they can
send push without owning Apple or Firebase credentials.

## What is sent

| Kind | Recipients | Push copy (de) | Tap opens |
| --- | --- | --- | --- |
| `share.published` | all circle members except the author | "{Name} hat etwas geteilt" | share detail |
| `comment.created` | all circle members except the commenter | "{Name} hat kommentiert" | share detail, focused on the medium when the comment targets one |
| `reaction.set` | only the share author | "{Name} hat mit {emoji} reagiert" | share detail, focused on the medium |
| `member.joined` | existing circle members | "{Name} ist beigetreten" | circle screen |

Every kind can be switched off per user under Settings → Benachrichtigungen;
disabled kinds still appear in the activity tab. The copy is rendered in the
language the device registered with (`de` or `en`); unknown locales fall back
to German.

Delivery details:

- **Badge (iOS)**: each push carries the recipient's unread activity count.
  The app mirrors the same count from `activity.summaryForViewer` so reading
  items in-app or on another device clears the badge.
- **Channels (Android)**: `shares`, `engagement`, `circle`. The app creates
  them at first registration (`features/notifications/channels.ts`); the
  server picks one per kind (`convex/lib/notifications.ts`). Users can mute
  channels individually in Android's system settings.
- **Collapsing**: reactions collapse per target (`reaction:<share>:<asset>`),
  joins per circle, so bursts replace the previous notification instead of
  stacking. `threadId` groups everything from one circle on iOS.
- **Suppression**: an attempt is dropped without sending when the inbox item
  was already read, the activity event was deleted, or the attempt is older
  than two days (protects against a flood when credentials are configured
  after a long gap). Pushes have a 24 h TTL at the provider.
- **Payload** (`data`): `instanceUrl`, `kind`, `circleId`, `activityEventId`,
  `inboxItemId`, and `shareBatchId` / `assetId` when applicable. The app
  refuses to navigate when `instanceUrl` differs from the active instance and
  opens the activity tab instead.

## Backend configuration

Attempts are recorded either way; they stay `skipped` with
`provider_not_configured` until one of these Convex env vars is set:

| Variable | Use |
| --- | --- |
| `EXPO_PUSH_ACCESS_TOKEN` | Expo access token of the account that owns the EAS project. Required once "enhanced push security" is enabled for the project. Use this for the cloud instance. |
| `EXPO_PUSH_ENABLED=true` | Send without a token. Only works while enhanced push security is off for the central app's EAS project. Intended for self-hosted instances. |

```sh
npx convex env set EXPO_PUSH_ACCESS_TOKEN=<token> --prod
```

Crons (`convex/crons.ts`): `notifications.dispatchQueued` every minute (batches
of 100, retries transient HTTP 429/5xx, network errors and
`MessageRateExceeded` tickets), `notifications.checkReceipts` every 15 minutes
(marks `delivered`/`failed`; `DeviceNotRegistered` disables the device).

Inspect state in the dashboard or via CLI:

```sh
npx convex data notificationDeliveryAttempts --prod --limit 50
npx convex run appConfig:appVersionAdoption --prod   # active devices by app version
```

## Platform credentials (managed outside git)

- **iOS**: an APNs key on the EAS project for `app.beisammen.app`. EAS
  usually creates it during the first store build; verify with
  `pnpm --filter @beisammen/mobile eas credentials -p ios`.
- **Android**: an FCM V1 service-account key from the Firebase project that
  owns `apps/mobile/google-services.json`, uploaded under Android credentials
  → FCM V1 in the EAS dashboard. This is never created automatically; without
  it every Android send fails with `InvalidCredentials`.
- `EXPO_PUBLIC_EAS_PROJECT_ID` must be set at build time; without it the app
  skips registration (`missing_project_id` diagnostic).

## Client behaviour

- Registration runs in the signed-in layout (`usePushNotifications`) after the
  permission prompt, on physical devices only. It repeats when the instance,
  account or UI language changes and unregisters on sign-out and instance
  switch.
- Foreground arrivals show a banner without sound; the icon badge is updated
  either way.
- Taps are handled both while running and from a cold start via
  `getLastNotificationResponseAsync`.
