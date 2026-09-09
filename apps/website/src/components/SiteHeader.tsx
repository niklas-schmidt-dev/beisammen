import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import { MenuIcon } from "lucide-react";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetClose,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { dict, LANG_STORAGE_KEY, localePath, type Locale } from "@/i18n/ui";
import { cn } from "@/lib/utils";

type PagePath = "" | "privacy" | "delete-account" | "connect";

type SiteHeaderProps = {
  locale: Locale;
  page?: PagePath;
  showNav?: boolean;
};

function storeLocale(locale: Locale) {
  try {
    localStorage.setItem(LANG_STORAGE_KEY, locale);
  } catch {
    // Private mode — the preference just won't persist.
  }
}

export function SiteHeader({
  locale,
  page = "",
  showNav = true,
}: SiteHeaderProps) {
  const t = dict[locale];
  const altLocale: Locale = locale === "en" ? "de" : "en";
  const location = useLocation();
  const homeHref = localePath(locale, "");
  // The connect page carries the invite in its query string — keep it when
  // switching languages so the hand-off still works afterwards.
  const altHref =
    page === "connect"
      ? { pathname: localePath(altLocale, page), search: location.search }
      : localePath(altLocale, page);
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const navItems = [
    { id: "why", label: t.nav.why },
    { id: "circles", label: t.nav.circles },
    { id: "promises", label: t.nav.promises },
    { id: "download", label: t.nav.download },
  ];

  const langSwitch = (
    <span className="flex items-center gap-1 font-mono text-xs tracking-wide">
      {locale === "de" ? (
        <>
          <span className="font-medium text-ink">DE</span>
          <span className="text-ink/40">/</span>
          <Link
            to={altHref}
            onClick={() => storeLocale("en")}
            className="text-ink/40 hover:text-ink"
          >
            EN
          </Link>
        </>
      ) : (
        <>
          <Link
            to={altHref}
            onClick={() => storeLocale("de")}
            className="text-ink/40 hover:text-ink"
          >
            DE
          </Link>
          <span className="text-ink/40">/</span>
          <span className="font-medium text-ink">EN</span>
        </>
      )}
    </span>
  );

  return (
    <header
      className={cn(
        "sticky top-0 z-60 border-b border-transparent px-4 py-3 backdrop-blur-xl backdrop-saturate-150 transition-colors duration-200 sm:px-6 lg:px-8",
        scrolled ? "border-ink/10 bg-paper/90" : "bg-paper/70",
      )}
    >
      <div className="mx-auto flex max-w-7xl items-center">
        <div className="flex flex-1 items-center">
          <Link
            to={homeHref}
            aria-label="Homepage"
            onClick={() => storeLocale(locale)}
          >
            <Logo size={24} />
          </Link>
        </div>

        {showNav && (
          <nav aria-label="Primary" className="max-lg:hidden">
            <ul
              role="list"
              className="flex items-center gap-8 text-sm font-medium text-ink/70"
            >
              {navItems.map((item) => (
                <li key={item.id}>
                  <Link
                    to={`${homeHref}#${item.id}`}
                    className="group relative py-1 hover:text-ink"
                  >
                    {item.label}
                    <span
                      aria-hidden="true"
                      className="absolute inset-x-0 -bottom-0.5 h-px origin-left scale-x-0 bg-ember transition-transform duration-250 ease-(--ease-quiet) group-hover:scale-x-100"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}

        <div className="flex flex-1 items-center justify-end gap-4">
          <span className="inline-flex items-center gap-2 rounded-full border border-ink/10 bg-cream py-1.5 pr-3 pl-2.5 max-xl:hidden">
            <span
              aria-hidden="true"
              className="size-1.5 animate-pulse rounded-full bg-ember shadow-[0_0_0_3px_rgb(196_101_74/0.18)]"
            />
            <span className="font-mono text-[0.65rem] tracking-wide text-ink/60">
              {t.masthead.availability}
            </span>
          </span>
          {langSwitch}
          {showNav && (
            <>
              <Button
                size="sm"
                className="rounded-full max-sm:hidden"
                nativeButton={false}
                render={<Link to={`${homeHref}#download`} />}
              >
                {t.nav.cta}
              </Button>
              <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
                <SheetTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      className="relative lg:hidden"
                      aria-label={t.nav.menuLabel}
                    />
                  }
                >
                  <MenuIcon />
                  <span
                    aria-hidden="true"
                    className="absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
                  />
                </SheetTrigger>
                <SheetContent side="right" className="bg-paper">
                  <SheetHeader>
                    <SheetTitle>
                      <Logo size={22} />
                    </SheetTitle>
                  </SheetHeader>
                  <nav aria-label="Mobile" className="px-4">
                    <ul role="list" className="flex flex-col gap-1">
                      {navItems.map((item) => (
                        <li key={item.id}>
                          <SheetClose
                            nativeButton={false}
                            render={
                              <Link
                                to={`${homeHref}#${item.id}`}
                                className="block rounded-xl px-3 py-3 text-lg font-medium text-ink hover:bg-ink/5"
                              />
                            }
                          >
                            {item.label}
                          </SheetClose>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-6 border-t border-ink/10 px-3 pt-6">
                      <SheetClose
                        nativeButton={false}
                        render={
                          <Button
                            size="lg"
                            className="w-full rounded-full"
                            nativeButton={false}
                            render={<Link to={`${homeHref}#download`} />}
                          />
                        }
                      >
                        {t.nav.cta}
                      </SheetClose>
                    </div>
                  </nav>
                </SheetContent>
              </Sheet>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
