import { useEffect } from 'react';

type PageMeta = {
  lang: string;
  title: string;
  description?: string;
  referrerPolicy?: string;
  /** Value for <meta name="robots">, e.g. "noindex, nofollow". Removed on unmount. */
  robots?: string;
};

function upsertMeta(attr: 'name' | 'property', key: string, content: string): HTMLMetaElement {
  let tag = document.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!tag) {
    tag = document.createElement('meta');
    tag.setAttribute(attr, key);
    document.head.append(tag);
  }
  tag.content = content;
  return tag;
}

export function usePageMeta({ lang, title, description, referrerPolicy, robots }: PageMeta) {
  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = title;
    upsertMeta('property', 'og:title', title);

    if (description) {
      upsertMeta('name', 'description', description);
      upsertMeta('property', 'og:description', description);
    }

    const transient: HTMLMetaElement[] = [];
    if (referrerPolicy) {
      transient.push(upsertMeta('name', 'referrer', referrerPolicy));
    }
    if (robots) {
      transient.push(upsertMeta('name', 'robots', robots));
    }
    return () => {
      for (const tag of transient) {
        tag.remove();
      }
    };
  }, [lang, title, description, referrerPolicy, robots]);
}
