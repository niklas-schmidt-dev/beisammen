# Self-Hosting

Private and noncommercial self-hosting is allowed under the repository license.

## Intended use

- couples
- families
- friend groups
- hobby and personal archival use

## Expectations

- every self-hosted deployment uses Clerk for authentication
- you provide your own Clerk application (JWT template named `convex`, Native
  API enabled) and its publishable key
- you bring your own S3-compatible storage credentials; new uploads require S3
- you operate your own deployment and backups
- billing is disabled; no RevenueCat or payment plans are required for
  self-hosted instances
- support is best-effort only

## Supported self-hosted auth mode

### `self-hosted-clerk`

- required for all current self-hosted installs
- uses the same native in-app Clerk sign-in flow as the official app
- requires your own Clerk application; set `CLERK_JWT_ISSUER_DOMAIN` on the
  backend and serve the publishable key through the discovery manifest

## App connection model

- users can connect the central Beisammen mobile app to a self-hosted instance
- invite links can point the app to a self-hosted instance with
  `https://beisammen.app/connect?instance=https://your-host` (the website
  hands the parameters to the app via Universal Links / App Links; the legacy
  `beisammen://connect?instance=…` scheme keeps working)
- links without an `instance` parameter always target the built-in cloud
  instance, never the instance currently active on the device
- the instance must serve a public discovery manifest at
  `https://your-host/.well-known/beisammen-instance.json`
- the manifest tells the app which Convex client URL, Clerk publishable key,
  deployment kind, billing mode, and storage capabilities to use
- links with both `instance` and `invite` switch the active instance before
  storing the invite token locally

## Push notifications

Self-hosted instances can deliver push through the central app's Expo push
tokens; set `EXPO_PUSH_ENABLED=true` on the Convex deployment. See
[push-notifications.md](push-notifications.md) for the limits of that mode.

## Required deployment mode

Set these values on the backend and mobile build that should point at your
self-hosted default:

```bash
PUBLIC_DEPLOYMENT_KIND=self-hosted
EXPO_PUBLIC_DEFAULT_DEPLOYMENT_KIND=self-hosted
```

`PUBLIC_SELF_HOSTED=true` is still accepted for older deployments, but new
configuration should use `PUBLIC_DEPLOYMENT_KIND`.

## Not allowed without a commercial license

- paid hosting for third parties
- managed Beisammen instances as a service
- resale or white-label redistribution for money

## Branding

If you redistribute modified builds, replace Beisammen-specific branding unless
you have explicit permission to keep it.
