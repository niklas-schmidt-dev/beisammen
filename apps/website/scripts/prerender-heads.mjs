// Post-build step: copy dist/index.html to each route with a localized
// <head>, so link-preview scrapers and crawlers that do not execute JS see
// the right lang/title/description/og:* per URL (parity with the old
// static Astro build). Static files win over the vercel.json SPA rewrite.
//
// Keep these strings in sync with src/i18n/ui.ts (landing meta) and the
// usePageMeta calls in src/pages/*.tsx.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

const ROUTES = [
  {
    path: 'en',
    lang: 'en',
    title: 'beisammen · a quieter place for your closest photos',
    description:
      'Private photo circles for partners, families, and close friends. End-to-end encrypted. No feed, no followers, no algorithm.',
  },
  {
    path: 'privacy',
    lang: 'de',
    title: 'Datenschutz · beisammen',
    description: 'Wie beisammen mit euren Fotos und Daten umgeht.',
  },
  {
    path: 'en/privacy',
    lang: 'en',
    title: 'Privacy policy · beisammen',
    description: 'How beisammen handles your photos and data.',
  },
  {
    path: 'delete-account',
    lang: 'de',
    title: 'Konto löschen · beisammen',
    description: 'So löschst du dein beisammen-Konto und die zugehörigen Daten dauerhaft.',
  },
  {
    path: 'en/delete-account',
    lang: 'en',
    title: 'Delete account · beisammen',
    description: 'How to permanently delete your beisammen account and its data.',
  },
  {
    path: 'connect',
    lang: 'de',
    title: 'In beisammen öffnen',
    description: 'Öffnet einen Einladungs- oder Instanz-Link in der beisammen-App.',
    robots: 'noindex, nofollow',
  },
  {
    path: 'en/connect',
    lang: 'en',
    title: 'Open in beisammen',
    description: 'Opens an invitation or instance link in the beisammen app.',
    robots: 'noindex, nofollow',
  },
];

const escapeAttr = (value) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;');

const base = await readFile(join(dist, 'index.html'), 'utf8');

for (const route of ROUTES) {
  const html = base
    .replace(/<html lang="[^"]*"/, `<html lang="${route.lang}"`)
    .replace(/<title>[^<]*<\/title>/, `<title>${route.title}</title>`)
    .replace(
      /(<meta\s+name="description"\s+content=")[^"]*(")/s,
      `$1${escapeAttr(route.description)}$2`,
    )
    .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${escapeAttr(route.title)}$2`)
    .replace(
      /(<meta\s+property="og:description"\s+content=")[^"]*(")/s,
      `$1${escapeAttr(route.description)}$2`,
    );
  const withRobots = route.robots
    ? html.replace('</head>', `<meta name="robots" content="${escapeAttr(route.robots)}" /></head>`)
    : html;
  const target = join(dist, route.path, 'index.html');
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, withRobots);
  console.log(`prerendered head: /${route.path}/`);
}
