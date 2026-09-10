# Versioning and release safety

Convex deploys are instant and shared, while store builds reach users days or
weeks later. Every backend change must therefore assume that older app
versions keep calling it. This document is the playbook for shipping changes
safely.

## Ground rules for backend changes

Convex rejects calls whose arguments do not match the function's validators —
in both directions. That makes these rules non-negotiable:

- **Schema**: new fields start as `v.optional(...)`; type changes go through
  `v.union(oldType, newType)`. Only contract (make required, drop the old
  type) after the data is backfilled and old clients are gone.
- **Function args**: new args are always `v.optional(...)`. Never remove or
  rename an arg while any shipped client still sends it.
- **Return shapes**: only add fields. Removing or renaming a returned field
  breaks old clients exactly like a schema change.
- **Breaking changes**: add a new function (`listV2`) next to the old one and
  keep both until adoption allows removal.
- **Scheduler too**: pending `ctx.scheduler` jobs run *new* code with args
  serialized at scheduling time. The compatibility rules above apply to our
  own scheduled functions and crons, not just app clients.

## Release order

1. Deploy the backend change, 100% backwards compatible (`npx convex deploy`).
2. Ship the client that uses it — OTA via `eas update` for JS-only changes,
   a store build for native changes.
3. Watch adoption (see below), then clean up old functions/schema in a
   separate contract-only deploy.

Never ship a client that requires functions that are not deployed yet.

## OTA updates (EAS Update)

- `runtimeVersion` uses the `appVersion` policy: the runtime is the native
  `version` in `app.config.ts`. JS-only changes ship OTA; native changes (new
  modules, permissions, SDK upgrades) must bump `version` and ship as a store
  build, otherwise installed builds would receive an incompatible update.
- Channels map to build profiles: `production`, `preview` (also used by
  `store-sandbox` builds), `development`. Local `expo run:ios` builds have no
  channel and never receive OTA updates.
- Publish with `pnpm eas update --channel production --environment production`
  from `apps/mobile` (commit first: the bundle contains the working tree).
- The app checks for updates on launch and on foregrounding
  (`src/features/app-config/use-ota-updates.ts`); downloads apply on the next
  cold start. `eas update:rollback` reverts a bad update.

## Kill switch: the `appConfig` document

A singleton `appConfig` row in Convex drives a reactive client gate
(`src/features/app-config/AppConfigGate.tsx`). Because the gate subscribes via
a Convex query, changes take effect in running apps within seconds. An absent
row — every fresh or self-hosted instance — means no restrictions, and the
gate fails open on errors, old backends, and unparseable versions.

```sh
# Force-update everything below 1.1 (native app version):
npx convex run appConfig:set '{"minSupportedAppVersion":"1.1"}'

# Maintenance mode with a custom message:
npx convex run appConfig:set '{"maintenanceMode":true,"maintenanceMessage":"..."}'

# Lift all restrictions (set replaces the whole config):
npx convex run appConfig:set '{}'
```

The blocked-version screen links to the stores and offers an immediate
restart when a downloaded OTA update is pending.

## Measuring adoption

Registered notification devices record the app version. Before contracting
schema or deleting deprecated functions, check the distribution:

```sh
npx convex run appConfig:appVersionAdoption
```

Plan a deprecation window (roughly 4–8 weeks or until stragglers are
negligible), and use `minSupportedAppVersion` to force the tail forward when
a cleanup really needs it.

## Data migrations

For backfills, use `@convex-dev/migrations` (batched, resumable, online)
rather than ad-hoc scripts: expand the schema, deploy code that handles both
formats (prefer dual-write over dual-read — easier to roll back), run the
migration, then contract. Convex validates the schema against existing data
on deploy, which catches most accidental breaks before they ship.
