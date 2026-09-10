# On-device e2e flow (MobAI)

`full-flow.mob` drives the **beisammen dev** build (`app.beisammen.app.dev`)
on a real, USB-attached iPhone through every user-facing feature: sign-in /
registration (Clerk e-mail OTP), recovery-code gate, onboarding, plan paywall
(RevenueCat Test Store), circle creation, invites (open + e-mail-bound, share
sheet), photo picking and publishing, share detail (reactions incl. custom
emoji, share- and asset-level comments, comment deletion, save to library,
fullscreen), Aktivität, Erinnerungen (month filter, viewer, Gespräch, Karte),
all Settings screens incl. the hidden Speicher & Diagnose route, circle
management (edit, statistics, invite list, withdraw, member roles, remove
member), joining as a second account, moderation, post deletion and finally
**deleting the test circle**. Each run creates its own circle (`E2E <timestamp>`)
and removes it at the end; a leftover circle from an aborted run is deleted at
the start.

## Prerequisites

- MobAI desktop app (≥ 2.8) running with the iPhone bridge started
  (`mobai bridge start -d <udid>`). The bridge dies when the phone locks, so
  keep the device unlocked (Einstellungen › Anzeige & Helligkeit › Automatische
  Sperre › Nie) for the duration of the run (~20 min).
- A development build installed next to the App Store app:

  ```sh
  cd apps/mobile
  npx expo prebuild --platform ios --clean
  EXPO_USE_PRECOMPILED_MODULES=0 npx expo run:ios --device <udid> --configuration Release --no-bundler
  ```

  `EXPO_PUBLIC_APP_ENV=development` (the default in `.env.local`) switches
  `app.config.ts` to the separate bundle id, display name "beisammen dev" and
  URL scheme `beisammen-dev`, so it does not replace the production app.
  `EXPO_USE_PRECOMPILED_MODULES=0` is required because the prebuilt React
  Native core for RN 0.86.2 is not published on Maven Central; with it enabled
  the Expo xcframeworks link against a `React.framework` that never gets
  embedded and the app aborts at launch (`dyld: Library not loaded`).
  Release-configured dev builds also need
  `plugins/with-revenuecat-test-store-release.js` (applied automatically in
  prebuild) so the RevenueCat SDK accepts the Test Store key instead of
  crashing.
- The dev build points at the dev Convex deployment and the Clerk
  **development** instance. The owner is a regular account; the member uses a
  `+clerk_test` address, so Clerk accepts the fixed code `424242` for e-mail
  verification and new-device confirmation and never sends mail. New Clerk
  passwords must be ≥ 15 characters. Credentials are `# Param:` defaults in
  `full-flow.mob`; override them when running.
- The photo library must contain at least two plain photos (the picker picks
  the two newest non-Live, non-video items). Photo access is granted on first
  use via the system prompt (`# Alerts: accept`).
- Device language German (the app copy is matched by German text).

## Running

Via the MobAI MCP tool `test_run` with `project_dir` set to this folder and
`case_path: full-flow.mob`, from the MobAI desktop UI, or with the helper that
posts to the desktop app's HTTP API:

```sh
apps/mobile/e2e/run.sh <udid>                               # full flow
apps/mobile/e2e/run.sh <udid> flows/sign-in.mob '{"email":"…","password":"…"}'
```

The standalone `mobai` CLI (2.7.x) ships an older script parser without
`repeat` / `if_exists` / `wait_stable`; use the API or MCP path instead.

Reusable pieces live in `flows/` and are inlined with `run "./flows/…"`.

## Conventions that matter for this UI

- Buttons with an icon are announced as `<glyph>, Label`; match them with a
  regex on the label suffix (`/", Anmelden$"/`). `Button` components and the
  circle management mini actions carry an explicit `accessibilityLabel`, so
  their plain label works.
- Section headers render uppercase; match them with `~"partial"`
  (case-insensitive).
- The keyboard has no Done button; tap static copy (e.g. `"oder"`,
  `"WILLKOMMEN"`, `"Circle-Details"`) to dismiss it. Return inserts a newline
  in multiline fields.
- `wait_for` and `tap` only see on-screen elements; scroll to below-the-fold
  targets first (`scroll down to "…"`).
- The share sheet is a popover without a close button; `flows/dismiss-share-sheet.mob`
  taps the dimmed area above it.
- Circle detail and share detail hide the tab bar; go `Zurück` before
  switching tabs or signing out.
