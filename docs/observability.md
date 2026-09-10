# Mobile reliability with EAS Observe

Current scope (9 September 2026): use the existing EAS Observe integration for
performance and errors. The broader [analytics research](analytics-plan.md) is a
reference for later decisions; its Convex aggregates and additional analytics
services are not part of this implementation.

## What to use it for

| Signal | Coverage | Useful decision |
| --- | --- | --- |
| Startup and navigation readiness | Existing Observe root, route integration and interactive markers | Find slow releases and screens; compare similar devices and builds. |
| Unhandled JavaScript errors | Early entry-point adapter, including the fatal flag | Prioritize crashes introduced by a release. |
| Render failures | Root Expo Router error boundary, with a retry screen | Find screens/providers that cannot mount; let the person retry. |
| Uploads and recovery | Picker, upload, retry, recovery cache read/write and selected cleanup failures | Fix failures that prevent sharing or restoring an interrupted upload. |
| Media loading | Asset resolution, video loading/player errors and Live Photo loading | Find failures that prevent opening memories. |
| Encryption keys | Bootstrap, keychain reads, circle-key resolution and rotation | Investigate blocked access and upload readiness. |
| Account and service operations | Selected sign-out cleanup, purchase identification/sync, push registration and share mutations | Find broken service integration or cleanup. |

These are diagnostic samples, not complete business-event counts. Duplicate
suppression, cancellation filtering and dispatch eligibility affect totals.
Do not interpret error counts as a precise upload failure rate without a matching
success denominator. Wrong passwords, verification mistakes, routine warnings,
and unrelated log messages are not forwarded.

## Error payloads

App reports contain a fixed operation label (for example `media.upload`), an
allowlisted JavaScript error type, and up to 20 generated bundle stack frames.
The sanitizer preserves line/column positions for symbolication and removes
original messages, function names, hosts, URL parameters and filesystem paths.
Unknown stack formats are dropped. Native player errors without a JavaScript
stack retain the operation label only; no misleading reporter stack is invented.

Logger context is never forwarded. Reports exclude captions, filenames, media
contents, location, circle/asset/user identifiers, email, tokens, encryption keys,
recovery codes, and `Error.cause`. Existing console logging and the local
diagnostics buffer remain separate and have their own handling of data.

Handled errors are limited to 20 distinct reports per minute window, with one
report per operation/type/sanitized-stack combination in that window. Render
errors have a separate bounded reporter so a failing upload cannot exhaust
render-error coverage. Unhandled errors preserve fatal/nonfatal semantics and
always call React Native's original handler with the original exception.
Reporting failures do not interrupt the user action.

## Dispatch and instances

- Configuration runs in `apps/mobile/index.js` before the router entry point.
  Debug builds do not dispatch or record our custom errors. Release builds use
  the configured environment and a 100% installation sample.
- Dispatch starts disabled until the actual stored instance has been restored.
  It is enabled only for the built-in default cloud instance. A custom server
  claiming `deployment.kind = cloud` does not qualify by itself.
- Selecting another instance disables dispatch before that selection is saved.
  Monitoring stays disabled for the rest of that launch, even after switching
  back. A persisted marker causes the next eligible cloud launch to drop pending
  exports while dispatch is disabled before enabling monitoring again.
- Dropping exports uses `Observe.dispatchEvents()` with dispatch disabled.
  `AppMetrics.clearStoredEntries()` is a no-op on iOS in the installed SDK.
  This does not erase native diagnostic records from the device.
- Early render/unhandled errors may be recorded locally before the instance is
  known. Their export follows the same dispatch setting. If restoration or
  telemetry storage fails, monitoring remains disabled for that launch.

This is operational monitoring with the existing SDK, not anonymous analytics
or an implemented consent system. Observe still adds its own installation,
session, device/build and performance metadata. Native startup metrics can
include a network hostname; the error sanitizer does not filter that metadata.
Known sensitive route parameters are filtered, including invite and instance
parameters. Review the filter whenever adding route parameters. Disabling
dispatch cannot retract requests that are already in flight or records exported
by older versions. Native queue operations are best effort; verify their
behavior again on SDK upgrades.

## Build and dashboard setup

`apps/mobile/eas.json` enables `uploadSourceMaps: true` for `preview`,
`store-sandbox` and `production`. The existing EAS runner pins CLI 22.0.0.
Use the normal EAS cloud build workflow; then inspect its logs for successful
source-map upload and review **Observe → Errors** for that build/environment.
Local builds do not upload source maps through this setting. Source-map upload
failure is a build warning, so a successful build alone does not prove that
symbolication is available. [Expo error reporting documentation](https://docs.expo.dev/eas/observe/errors/)

For each release, check new errors and their affected sessions first, then
compare startup/readiness with the previous release. For a handled operation,
use the mapped source position and a local reproduction to recover the detailed
cause; private error messages are deliberately absent from the dashboard.

Observe currently lacks native crash reporting and source-map support for OTA
updates. An OTA error may therefore have an unsymbolicated stack. This setup
does not capture server-side Convex failures independently of their client-side
effects. [Expo's current limitations](https://docs.expo.dev/eas/observe/errors/#still-to-come)

## Maintaining the integration

- Prefer `reportAppError` with a fixed `ErrorOperation` for new error paths.
  Existing logger integrations use exact namespace/message matches in
  `log-errors.ts`; changing those messages requires updating the mapping.
- Keep cancellation and expected validation outcomes out of error reports.
  Do not add raw `Observe.reportError(error)` calls or the built-in Observe
  error boundary; both bypass this app's sanitizer.
- The global-handler adapter uses the SDK's exported `AppMetrics.reportError`
  API to retain `source: global` and `isFatal`. That API is marked private by
  Expo. Inspect it and the SDK's automatic handler on upgrades. The installed
  Observe 57.0.13 API does not contain the `errorHandlingEnabled` option shown
  in newer online documentation.
- Run `pnpm --filter @beisammen/mobile test` and
  `pnpm --filter @beisammen/mobile typecheck`. Tests cover redaction, stack
  coordinates, limits, cancellation, logger isolation, fatal-handler chaining,
  debug suppression, instance gating and a switch during a pending drop.
- For a staging release, verify one synthetic handled error and one render
  failure in the dashboard, including source-map resolution. Use synthetic data
  only. Device smoke checks and unit tests do not prove cloud ingestion.

## Validation on 9 September 2026

- All 194 mobile tests passed across 32 files, including 19 Observe tests.
  Mobile TypeScript checking and `git diff --check` passed.
- Production iOS export produced a Hermes bundle and source map. A generated
  coordinate retained by the sanitizer mapped back to its original source
  file and line using that map.
- A signed iOS Debug build completed successfully with Xcode.
- New-build device verification is incomplete: MobAI installation on the
  connected iPhone timed out with both its one-minute default and a five-minute
  retry. The previously installed app was observed, but that does not validate
  this change. Temporary synthetic failure code was removed.
- EAS dashboard ingestion and cloud symbolication were not exercised. Verify
  those with a staging EAS cloud build using the source-map setting above.
