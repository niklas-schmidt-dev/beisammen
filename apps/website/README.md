# @beisammen/website

Marketing site for Beisammen — React + Vite + Tailwind CSS v4, with EN / DE support.
UI primitives are vendored from [ReUI](https://reui.io) (Base UI + nova style) in
`src/components/ui`, and motion uses transitions.dev Pro recipes (`src/styles/transitions.css`).

## Scripts

```bash
pnpm --filter @beisammen/website dev       # local dev server
pnpm --filter @beisammen/website build     # production build → ./dist
pnpm --filter @beisammen/website preview   # preview the production build
```

## Deployment

The site is served by Cloudflare Workers (static assets) as the Worker
`beisammen-website`, with `beisammen.app` and `www.beisammen.app` attached as
custom domains (www 301s to the apex via `worker/index.ts`).

```bash
pnpm --filter @beisammen/website deploy   # build + wrangler deploy
```

Pushes to `main` that touch `apps/website/**` deploy automatically via
`.github/workflows/deploy-website.yml` (requires the `CLOUDFLARE_API_TOKEN`
repository secret, scoped to Edit Cloudflare Workers). Manual deploys use the
command above. SPA fallback and trailing-slash handling live in
`wrangler.jsonc` (`assets.not_found_handling` / `html_handling`).

## Environment

- `PUBLIC_INSTANCE_BASE_URL` must point at the backend base URL that serves Convex HTTP actions.
  The production value is committed in `.env.production` (it is public and baked into the bundle);
  Vite picks it up automatically during `pnpm build`.
- The waitlist form submits to `${PUBLIC_INSTANCE_BASE_URL}/waitlist/join` (the backend expects `source=landing`).

## Routing model

Single-page app (react-router); Cloudflare Workers serves `index.html` for
unknown paths (`not_found_handling: "single-page-application"`), while the
prerendered per-route heads in `dist/<route>/index.html` are served as real
assets.

| Path                 | What it serves |
| -------------------- | -------------- |
| `/`                  | German landing page. On first visit it honors `localStorage['beisammen:lang']`, then the browser language, and forwards English readers to `/en/`. |
| `/en/`               | English landing page |
| `/privacy/`, `/en/privacy/` | Privacy policy |
| `/delete-account/`, `/en/delete-account/` | Account deletion instructions |
| `/connect/`, `/en/connect/` | Invite / instance hand-off into the app. Universal Links (iOS) and App Links (Android) claim this path when the app is installed; the page itself is the fallback with an "open in app" button (custom scheme) and store badges. Not indexed. |
| `/.well-known/apple-app-site-association`, `/.well-known/assetlinks.json` | App association files (served as JSON by `worker/index.ts`). The Android entry uses the Play App Signing certificate, verified in Play Console on 2026-09-09. Update it if the signing key changes. |

Manual language switcher clicks write `beisammen:lang` to `localStorage`, so an
override is remembered on future visits to `/`.

## Adding ReUI components

`components.json` is configured for the `@reui` registry (`base-nova` style), which
requires a ReUI license key. Without one, vendor components from the MIT-licensed
[keenthemes/reui](https://github.com/keenthemes/reui) repo (`registry/bases/base/ui/*`)
into `src/components/ui` and fix the `@/registry/...` imports to `@/lib/utils` /
`@/components/ui`. `src/styles/reui-nova.css` contains only the button and sheet
styles used by the site. When adding a component, copy its required style rules
into that file as well.
