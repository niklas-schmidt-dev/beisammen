import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { ConnectPage } from '@/pages/ConnectPage';
import { DeleteAccountPage } from '@/pages/DeleteAccountPage';
import { LandingPage } from '@/pages/LandingPage';
import { PrivacyPage } from '@/pages/PrivacyPage';

/** Scrolls to the hash target after SPA navigations, or back to the top. */
function ScrollManager() {
  const location = useLocation();

  useEffect(() => {
    if (location.hash) {
      const target = document.getElementById(location.hash.slice(1));
      if (target) {
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
        return;
      }
    }
    // 'instant' bypasses the CSS scroll-behavior so route changes don't
    // animate a scroll from the previous page's position.
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [location.pathname, location.hash, location.key]);

  return null;
}

/** Redirect that keeps the current search and hash (e.g. /de/#download → /#download). */
function LegacyRedirect({ to }: { to: string }) {
  const location = useLocation();
  return (
    <Navigate to={{ pathname: to, search: location.search, hash: location.hash }} replace />
  );
}

export default function App() {
  return (
    <>
      <ScrollManager />
      <Routes>
        <Route path="/" element={<LandingPage locale="de" />} />
        <Route path="/en" element={<LandingPage locale="en" />} />
        <Route path="/privacy" element={<PrivacyPage locale="de" />} />
        <Route path="/en/privacy" element={<PrivacyPage locale="en" />} />
        <Route path="/delete-account" element={<DeleteAccountPage locale="de" />} />
        <Route path="/en/delete-account" element={<DeleteAccountPage locale="en" />} />
        {/* Invite / instance hand-off into the app (Universal Link / App Link target). */}
        <Route path="/connect" element={<ConnectPage />} />
        <Route path="/en/connect" element={<ConnectPage locale="en" />} />
        {/* The old Astro site advertised /de/ in hreflang links — keep it working. */}
        <Route path="/de" element={<LegacyRedirect to="/" />} />
        <Route path="/de/privacy" element={<LegacyRedirect to="/privacy" />} />
        <Route path="/de/delete-account" element={<LegacyRedirect to="/delete-account" />} />
        <Route path="*" element={<LegacyRedirect to="/" />} />
      </Routes>
    </>
  );
}
