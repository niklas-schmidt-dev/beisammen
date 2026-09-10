# Beisammen

Beisammen is a **source-available** photo and video sharing app for private circles such as partners, families, and close friends. The repository is public, but the project is **not OSI open source**.

## License model

- Source available under **PolyForm Noncommercial 1.0.0**
- Private use and private/self-hosted deployments are allowed
- Commercial hosting, resale, managed hosting, and white-label resale are not allowed without a separate commercial license
- The Beisammen name, logo, and branding are not granted automatically

Read [docs/licensing.md](docs/licensing.md) and [NOTICE](NOTICE) before using or redistributing the project.

## Product scope

- Expo React Native app in `apps/mobile`
- Convex-first backend in `convex/`
- Clerk authentication for official and self-hosted deployments
- Cloud subscriptions through RevenueCat with Convex-enforced usage quotas
- Official `convex-revenuecat` component integration for entitlement sync
- BYO storage architecture with S3-compatible storage first
- Central app distribution with official and self-hosted instances
- Marketing website with German and English pages

## Repo structure

```text
apps/mobile            Expo app with Expo Router
apps/website           Marketing and policy website
packages/contracts     Shared API and storage contracts
packages/crypto        Shared encryption primitives
packages/upload-client Upload queue model and state helpers
convex/                Convex schema and backend scaffolding
docs/                  Architecture, auth, licensing, self-hosting docs
services/              Reserved for future Go services
```

## Local development

1. Copy `.env.example` to `.env.local` and fill in your own values.
2. Install dependencies with `pnpm install`.
3. Start Metro for the development build with `pnpm dev:mobile`.
4. Install or refresh the native dev build with `pnpm ios:mobile` or `pnpm android:mobile`.
5. Start Convex separately with `pnpm convex:dev`.

## Public repository boundaries

- This public repository intentionally excludes local developer tooling, EAS build configuration, and all real deployment credentials.
- Only placeholder values belong in `.env.example`.
- `apps/mobile/app.config.ts` is public app metadata and must stay free of secrets and account-specific linkage.
- If you need local Expo build configuration, create your own untracked `apps/mobile/eas.json`.

## Instance model

- the mobile app boots from `EXPO_PUBLIC_DEFAULT_INSTANCE_URL`
- the bundled default instance configuration is local app configuration and
  defaults to `cloud`
- custom/self-hosted instances are discovered at
  `/.well-known/beisammen-instance.json`
- discovered instance manifests provide the public Convex URL and Clerk
  publishable key plus deployment and billing mode
- discovered instance manifests include `client.minimumAppVersion`; custom
  instance links are rejected by older app builds before switching instances
- every deployment uses Clerk as the auth provider
- self-hosted deployments can point the same app binary at their own instance URL
- cloud deployments advertise paid RevenueCat plans only and use server-side
  quota gates before storage-generating uploads; self-hosted deployments set
  `billing.enabled=false` and do not enforce app-level media limits
- operators can check deployment compatibility with
  `pnpm smoke:beta -- <instance-url> --app-version=<current-mobile-version>`
- paired cloud/self-hosted release checks can be run with
  `pnpm release:beta -- --cloud-url=<cloud-site-url> --self-hosted-url=<self-hosted-site-url> --app-version=<current-mobile-version>`

## Secret handling rules

- Only `EXPO_PUBLIC_*` variables may be referenced from React Native code.
- `app.config.ts` is treated as public app metadata. Do not put secrets there.
- auth provider secrets, storage credentials, APNs/FCM keys, real EAS tokens, and local developer metadata must stay out of git.
- `apps/mobile/eas.json` is intentionally not tracked in the public repository.
- Expo account/project linkage should stay out of `apps/mobile/app.config.ts` in the public snapshot.

See [docs/architecture.md](docs/architecture.md) for the environment boundary.
See [docs/private-beta-qa.md](docs/private-beta-qa.md) for the current device QA checklist.
See [docs/push-notifications.md](docs/push-notifications.md) for push delivery, credentials, and payloads.
