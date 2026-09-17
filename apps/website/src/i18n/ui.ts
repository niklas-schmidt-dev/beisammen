export const locales = ['en', 'de'] as const;
export type Locale = (typeof locales)[number];

export const localeLabel: Record<Locale, string> = {
  en: 'EN',
  de: 'DE',
};

export const LANG_STORAGE_KEY = 'beisammen:lang';

export type MomentCircle = {
  key: 'partner' | 'family' | 'friends';
  label: string;
  members: string;
  initials: string[];
  photoAlt: string;
  caption: string;
  date: string;
  reply: { initial: string; name: string; text: string; time: string };
  facts: string[];
};

type Dictionary = {
  htmlLang: string;
  meta: { title: string; description: string };
  masthead: { availability: string };
  nav: {
    why: string;
    circles: string;
    promises: string;
    download: string;
    cta: string;
    menuLabel: string;
  };
  hero: {
    eyebrow: string;
    title: string;
    lede: string;
    primaryCta: string;
    secondaryCta: string;
    metaItems: string[];
    imageAlt: string;
  };
  manifesto: {
    eyebrow: string;
    title: string;
    body: string;
  };
  moments: {
    eyebrow: string;
    title: string;
    body: string;
    tablistLabel: string;
    hint: string;
    photoOpenLabel: string;
    photoCloseLabel: string;
    circles: MomentCircle[];
  };
  promises: {
    eyebrow: string;
    title: string;
    items: Array<{ title: string; body: string; linkLabel?: string }>;
  };
  download: {
    eyebrow: string;
    title: string;
    body: string;
    appStore: string;
    playStore: string;
    note: string;
  };
  footer: {
    tagline: string;
    source: string;
    license: string;
    privacy: string;
    year: string;
  };
  connect: {
    metaTitle: string;
    metaDescription: string;
    eyebrow: string;
    title: string;
    lede: string;
    invalidTitle: string;
    invalidLede: string;
    openApp: string;
    copyLink: string;
    copied: string;
    installTitle: string;
    installBody: string;
    afterInstall: string;
  };
};

export const dict: Record<Locale, Dictionary> = {
  en: {
    htmlLang: 'en',
    meta: {
      title: 'beisammen · a quieter place for your closest photos',
      description:
        'Private photo circles for partners, families, and close friends. End-to-end encrypted. No feed, no followers, no algorithm.',
    },
    masthead: {
      availability: 'Out now',
    },
    nav: {
      why: 'Why',
      circles: 'Circles',
      promises: 'Promises',
      download: 'Download',
      cta: 'Get the app',
      menuLabel: 'Open menu',
    },
    hero: {
      eyebrow: 'Private photo circles',
      title: 'Photos for your people, no one else.',
      lede:
        'No feed. No followers. No algorithm. Just the photos you take together, for the people who count.',
      primaryCta: 'Get the app',
      secondaryCta: 'How it works',
      metaItems: [
        'Invite-only circles',
        'End-to-end encrypted',
        'Your photos stay yours',
      ],
      imageAlt: 'Wide alpine meadow in soft morning light',
    },
    manifesto: {
      eyebrow: 'Why beisammen exists',
      title: 'Some moments don’t belong on the internet.',
      body:
        'They belong to the people who were there. beisammen is a small, private place for exactly those moments. No feed, no strangers, no stage.',
    },
    moments: {
      eyebrow: 'Circles',
      title: 'A circle is your place.',
      body:
        'Create a circle for the people who belong together. What you share there is seen by them and no one else.',
      tablistLabel: 'Choose a circle',
      hint: 'Tap the photo to open it',
      photoOpenLabel: 'Open photo',
      photoCloseLabel: 'Close photo',
      circles: [
        {
          key: 'partner',
          label: 'Partner',
          members: '2 people',
          initials: ['N', 'A'],
          photoAlt: 'Desert dunes in warm evening light',
          caption: 'Dunes, just before eight',
          date: 'Aug 12',
          reply: { initial: 'A', name: 'Alex', text: 'Send me the full-size one.', time: '21:42' },
          facts: [
            'Visible to exactly 2 people',
            'No likes, only replies',
            'Originals in full quality',
          ],
        },
        {
          key: 'family',
          label: 'Family',
          members: '5 people',
          initials: ['M', 'K', 'J', 'E', 'L'],
          photoAlt: 'Misty pine forest on a quiet morning',
          caption: 'Sunday in the woods',
          date: 'Mar 9',
          reply: { initial: 'K', name: 'Kim', text: 'I want to go back already.', time: '16:08' },
          facts: [
            'Visible to exactly 5 people',
            'Nothing fights for your attention',
            'Stays until you delete it',
          ],
        },
        {
          key: 'friends',
          label: 'Close friends',
          members: '4 people',
          initials: ['T', 'J', 'S', 'P'],
          photoAlt: 'Still lake at twilight with a forested shore',
          caption: 'Last day at the lake',
          date: 'Jun 24',
          reply: { initial: 'T', name: 'Toni', text: 'Same again next summer.', time: '23:17' },
          facts: [
            'Visible to exactly 4 people',
            'No explore tab, no trending',
            'Your shared archive',
          ],
        },
      ],
    },
    promises: {
      eyebrow: 'Promises',
      title: 'Four promises, kept by design.',
      items: [
        {
          title: 'Invite-only',
          body: 'Every circle starts empty. You decide who joins. Nobody else, ever.',
        },
        {
          title: 'No feed algorithm',
          body: 'Your photos appear in the order life happened. Nothing is optimized for engagement, nothing fights for your attention.',
        },
        {
          title: 'End-to-end encrypted',
          body: 'Your photos are encrypted on your phone before they are uploaded, and backed up automatically. Only your circle can open them. Not the cloud, not us.',
        },
        {
          title: 'Built in the open',
          body: 'The source code is public. Read how it treats your photos, or run beisammen entirely yourself.',
          linkLabel: 'View the source',
        },
      ],
    },
    download: {
      eyebrow: 'Download',
      title: 'Get beisammen.',
      body:
        'beisammen is now open to everyone. Download the app, create your first circle, and share tonight with your people.',
      appStore: 'Download on the App Store',
      playStore: 'Get it on Google Play',
      note: 'Free for iPhone and Android.',
    },
    footer: {
      tagline: 'For the ones who count.',
      source: 'Source',
      license: 'License',
      privacy: 'Privacy',
      year: 'MMXXVI · beisammen',
    },
    connect: {
      metaTitle: 'Open in beisammen',
      metaDescription: 'Opens an invitation or instance link in the beisammen app.',
      eyebrow: 'Invitation',
      title: 'Your invitation is ready.',
      lede: 'Open this link in the beisammen app to join the circle. If the app is installed, it opens automatically.',
      invalidTitle: 'This link is incomplete.',
      invalidLede: 'It contains neither an invitation nor an instance. Ask the person who invited you to share the link again.',
      openApp: 'Open in the app',
      copyLink: 'Copy link',
      copied: 'Copied',
      installTitle: 'Don’t have the app yet?',
      installBody: 'Install beisammen, then paste the invite link or code into “Join circle” — or come back and open this link again.',
      afterInstall: 'Invite links are single-use and only work in the app.',
    },
  },
  de: {
    htmlLang: 'de',
    meta: {
      title: 'beisammen · ein leiserer Ort für eure Fotos',
      description:
        'Private Fotokreise für Partner, Familie und enge Freunde. Ende-zu-Ende-verschlüsselt. Kein Feed, keine Follower, kein Algorithmus.',
    },
    masthead: {
      availability: 'Jetzt erhältlich',
    },
    nav: {
      why: 'Warum',
      circles: 'Kreise',
      promises: 'Versprechen',
      download: 'Download',
      cta: 'App laden',
      menuLabel: 'Menü öffnen',
    },
    hero: {
      eyebrow: 'Private Fotokreise',
      title: 'Fotos für deine Menschen, sonst niemand.',
      lede:
        'Kein Feed. Keine Follower. Kein Algorithmus. Nur die Fotos, die ihr zusammen macht. Für die Menschen, die zählen.',
      primaryCta: 'App laden',
      secondaryCta: 'So funktioniert es',
      metaItems: [
        'Nur auf Einladung',
        'Ende-zu-Ende-verschlüsselt',
        'Deine Fotos gehören dir',
      ],
      imageAlt: 'Weite Almwiese in weichem Morgenlicht',
    },
    manifesto: {
      eyebrow: 'Warum es beisammen gibt',
      title: 'Manche Momente gehören nicht ins Internet.',
      body:
        'Sie gehören den Menschen, die dabei waren. beisammen ist ein kleiner, privater Ort für genau diese Momente. Ohne Feed, ohne Fremde, ohne Bühne.',
    },
    moments: {
      eyebrow: 'Kreise',
      title: 'Ein Kreis ist euer Ort.',
      body:
        'Erstelle einen Kreis für die Menschen, die zusammengehören. Was ihr dort teilt, sehen nur sie. Sonst niemand.',
      tablistLabel: 'Kreis auswählen',
      hint: 'Foto antippen zum Öffnen',
      photoOpenLabel: 'Foto öffnen',
      photoCloseLabel: 'Foto schließen',
      circles: [
        {
          key: 'partner',
          label: 'Partner',
          members: '2 Personen',
          initials: ['N', 'A'],
          photoAlt: 'Dünen im warmen Abendlicht',
          caption: 'Dünen, kurz vor acht',
          date: '12. Aug',
          reply: { initial: 'A', name: 'Alex', text: 'Schick mir das in groß.', time: '21:42' },
          facts: [
            'Sichtbar für genau 2 Personen',
            'Keine Likes, nur Antworten',
            'Originale in voller Qualität',
          ],
        },
        {
          key: 'family',
          label: 'Familie',
          members: '5 Personen',
          initials: ['M', 'K', 'J', 'E', 'L'],
          photoAlt: 'Nebliger Nadelwald an einem ruhigen Morgen',
          caption: 'Sonntag im Wald',
          date: '9. März',
          reply: { initial: 'K', name: 'Kim', text: 'Da will ich gleich wieder hin.', time: '16:08' },
          facts: [
            'Sichtbar für genau 5 Personen',
            'Nichts kämpft um eure Aufmerksamkeit',
            'Bleibt, bis ihr es löscht',
          ],
        },
        {
          key: 'friends',
          label: 'Enge Freunde',
          members: '4 Personen',
          initials: ['T', 'J', 'S', 'P'],
          photoAlt: 'Stiller See in der Dämmerung mit bewaldetem Ufer',
          caption: 'Letzter Seetag',
          date: '24. Juni',
          reply: { initial: 'T', name: 'Toni', text: 'Nächsten Sommer wieder.', time: '23:17' },
          facts: [
            'Sichtbar für genau 4 Personen',
            'Kein Entdecken, kein Trending',
            'Euer gemeinsames Archiv',
          ],
        },
      ],
    },
    promises: {
      eyebrow: 'Versprechen',
      title: 'Vier Versprechen, fest eingebaut.',
      items: [
        {
          title: 'Nur auf Einladung',
          body: 'Jeder Kreis beginnt leer. Wer dazukommt, entscheidet ihr. Niemand sonst.',
        },
        {
          title: 'Kein Feed-Algorithmus',
          body: 'Eure Fotos erscheinen in der Reihenfolge, in der das Leben passiert ist. Nichts wird auf Engagement optimiert, nichts kämpft um eure Aufmerksamkeit.',
        },
        {
          title: 'Ende-zu-Ende-verschlüsselt',
          body: 'Deine Fotos werden schon auf dem Handy verschlüsselt und automatisch gesichert. Öffnen kann sie nur euer Kreis. Nicht die Cloud, nicht wir.',
        },
        {
          title: 'Offen gebaut',
          body: 'Der Quelltext ist öffentlich. Lies nach, wie beisammen mit euren Fotos umgeht, oder betreibe es komplett selbst.',
          linkLabel: 'Zum Quelltext',
        },
      ],
    },
    download: {
      eyebrow: 'Download',
      title: 'Hol dir beisammen.',
      body:
        'beisammen ist jetzt für alle da. Lade die App, erstelle deinen ersten Kreis und teile den heutigen Abend mit deinen Menschen.',
      appStore: 'Laden im App Store',
      playStore: 'Jetzt bei Google Play',
      note: 'Kostenlos für iPhone und Android.',
    },
    footer: {
      tagline: 'Für die, die zählen.',
      source: 'Quelltext',
      license: 'Lizenz',
      privacy: 'Datenschutz',
      year: 'MMXXVI · beisammen',
    },
    connect: {
      metaTitle: 'In beisammen öffnen',
      metaDescription: 'Öffnet einen Einladungs- oder Instanz-Link in der beisammen-App.',
      eyebrow: 'Einladung',
      title: 'Deine Einladung ist bereit.',
      lede: 'Öffne diesen Link in der beisammen-App, um dem Circle beizutreten. Ist die App installiert, öffnet sie sich automatisch.',
      invalidTitle: 'Dieser Link ist unvollständig.',
      invalidLede: 'Er enthält weder eine Einladung noch eine Instanz. Bitte die Person, die dich eingeladen hat, den Link erneut zu teilen.',
      openApp: 'In der App öffnen',
      copyLink: 'Link kopieren',
      copied: 'Kopiert',
      installTitle: 'Noch keine App?',
      installBody: 'Installiere beisammen und füge dann Link oder Code unter „Circle beitreten“ ein – oder komm hierher zurück und öffne den Link noch einmal.',
      afterInstall: 'Einladungslinks sind einmalig nutzbar und funktionieren nur in der App.',
    },
  },
};

export const repoUrl = 'https://github.com/cn0ss/beisammen';
export const appStoreUrl = 'https://apps.apple.com/app/id6762514050';
export const playStoreUrl = 'https://play.google.com/store/apps/details?id=app.beisammen.app';
export const licenseUrl = `${repoUrl}/blob/main/docs/licensing.md`;

export function localePath(
  locale: Locale,
  path: '' | 'privacy' | 'delete-account' | 'connect',
): string {
  const prefix = locale === 'en' ? '/en' : '';
  return path === '' ? `${prefix}/` : `${prefix}/${path}/`;
}
