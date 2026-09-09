import { useEffect, useMemo } from "react";
import { useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/Eyebrow";
import { SiteHeader } from "@/components/SiteHeader";
import {
  appStoreUrl,
  dict,
  LANG_STORAGE_KEY,
  playStoreUrl,
  type Locale,
} from "@/i18n/ui";
import { usePageMeta } from "@/lib/meta";

const APP_SCHEME = "beisammen";

function detectLocale(routeLocale: Locale | null): Locale {
  if (routeLocale) {
    return routeLocale;
  }
  try {
    const stored = localStorage.getItem(LANG_STORAGE_KEY);
    if (stored === "en" || stored === "de") {
      return stored;
    }
  } catch {
    // Private mode — fall through to the browser language.
  }
  const preferred = (navigator.languages ?? [navigator.language]).find(
    (lang) =>
      lang?.toLowerCase().startsWith("de") ||
      lang?.toLowerCase().startsWith("en"),
  );
  return preferred?.toLowerCase().startsWith("en") ? "en" : "de";
}

function isAndroid(): boolean {
  return /android/i.test(navigator.userAgent);
}

/**
 * Hand-off page for invite / connect links. On iOS and Android the app claims
 * https://beisammen.app/connect?… directly (Universal Links / App Links), so
 * this page is only reached when the app is not installed or the link was
 * opened in a way that bypasses the OS association. It offers the custom
 * scheme as a manual fallback plus the store badges.
 */
export function ConnectPage({
  locale: routeLocale = null,
}: {
  locale?: Locale | null;
}) {
  // /en/connect is explicit; /connect follows the remembered or browser language.
  const locale = detectLocale(routeLocale);
  const [searchParams] = useSearchParams();
  const t = dict[locale].connect;

  const inviteToken = searchParams.get("invite")?.trim() ?? "";
  const instanceUrl = searchParams.get("instance")?.trim() ?? "";
  const hasParams = inviteToken.length > 0 || instanceUrl.length > 0;

  const appUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (instanceUrl) {
      params.set("instance", instanceUrl);
    }
    if (inviteToken) {
      params.set("invite", inviteToken);
    }
    const query = params.toString();
    return `${APP_SCHEME}://connect${query ? `?${query}` : ""}`;
  }, [instanceUrl, inviteToken]);

  usePageMeta({
    lang: locale,
    title: t.metaTitle,
    description: t.metaDescription,
    // Invite tokens are single-use secrets: never let a crawler index them.
    robots: "noindex, nofollow",
    referrerPolicy: "no-referrer",
  });

  // Android Chrome silently ignores an unknown custom scheme, so trying the
  // app once automatically is safe there. iOS Safari shows a blocking
  // "cannot open page" alert when the app is missing — leave it to the button.
  useEffect(() => {
    if (!hasParams || !isAndroid()) {
      return;
    }
    const timer = window.setTimeout(() => {
      window.location.href = appUrl;
    }, 250);
    return () => window.clearTimeout(timer);
  }, [appUrl, hasParams]);

  return (
    <div className="isolate">
      <SiteHeader locale={locale} page="connect" showNav={false} />
      <main className="px-4 pt-12 pb-24 sm:px-6 sm:pt-16 lg:px-8">
        <div className="mx-auto max-w-3xl">
          <header className="flex flex-col gap-4">
            <Eyebrow>{t.eyebrow}</Eyebrow>
            <h1 className="max-w-[20ch] text-5xl font-semibold tracking-tight text-balance sm:text-6xl">
              {hasParams ? t.title : t.invalidTitle}
            </h1>
            <p className="max-w-[48ch] text-lg/8 text-pretty text-ink/70">
              {hasParams ? t.lede : t.invalidLede}
            </p>
          </header>

          {hasParams && (
            <div className="mt-10 flex flex-wrap items-center gap-3">
              <Button
                size="lg"
                className="h-13 rounded-full px-7 text-base"
                nativeButton={false}
                render={<a href={appUrl} />}
              >
                {t.openApp}
                <span aria-hidden="true">→</span>
              </Button>
            </div>
          )}

          <section className="mt-14">
            <h2 className="text-2xl font-semibold tracking-tight">
              {t.installTitle}
            </h2>
            <p className="mt-3 max-w-[56ch] text-base/7 text-ink/70">
              {t.installBody}
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-4">
              <a
                href={appStoreUrl}
                rel="noopener noreferrer"
                className="transition-transform duration-250 ease-(--ease-quiet) hover:-translate-y-0.5"
              >
                <img
                  src={`/badges/app-store-${locale}.svg`}
                  alt={dict[locale].download.appStore}
                  width={120}
                  height={40}
                  className="h-13 w-auto sm:h-14"
                />
              </a>
              <a
                href={playStoreUrl}
                rel="noopener noreferrer"
                className="transition-transform duration-250 ease-(--ease-quiet) hover:-translate-y-0.5"
              >
                <img
                  src={`/badges/google-play-${locale}.svg`}
                  alt={dict[locale].download.playStore}
                  width={135}
                  height={40}
                  className="h-13 w-auto sm:h-14"
                />
              </a>
            </div>
            {hasParams && (
              <p className="mt-6 max-w-[56ch] font-mono text-xs/5 tracking-wide text-ink/45">
                {t.afterInstall}
              </p>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
