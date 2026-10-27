/* Self-hosted OpenPanel: public-page counts only; no identity, replay or click capture. */
/* global navigator, location, window, document, URL */
(function () {
  "use strict";
  var host = "beisammen.app";
  function optedOut() {
    return navigator.doNotTrack === "1" || navigator.globalPrivacyControl === true;
  }
  if (location.hostname !== host || optedOut() || window.__openPanelLoaded) return;
  window.__openPanelLoaded = true;
  window.op = window.op || function () {
    (window.op.q = window.op.q || []).push(arguments);
  };
  window.op("init", {
    clientId: "b6c0f8df-ef8e-4971-98de-b5b94918565e",
    apiUrl: "https://openpanel-web-production.up.railway.app/api",
    trackScreenViews: true,
    trackOutgoingLinks: false,
    trackAttributes: false,
    sessionReplay: { enabled: false },
    filter: function (event) {
      if (optedOut() || event.type !== "track") return false;
      var properties = event.payload.properties || {};
      try {
        var url = new URL(properties.__path || location.href, location.origin);
        // Account areas and links that consume credentials must never become analytics.
        var path = url.pathname.replace(/^\/(?:en|de)(?=\/|$)/, "");
        if (/^\/(?:app|dashboard|operator|auth|api|callback|connect|claim|verify-email-recipient|onboarding|invite|reset-password|julia|desktop|archive|u|status|share|join)(?:\/|$)/.test(path)) return false;
        var clean = new URL(url.pathname, url.origin);
        ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].forEach(function (key) {
          var value = url.searchParams.get(key);
          if (value) clean.searchParams.set(key, value.slice(0, 200));
        });
        properties.__path = clean.href;
        // Referrer queries and fragments can contain credentials or personal information.
        properties.__referrer = properties.__referrer ? new URL(properties.__referrer).origin : "";
        event.payload.properties = properties;
        return true;
      } catch {
        return false;
      }
    }
  });
  var script = document.createElement("script");
  script.src = "https://openpanel-web-production.up.railway.app/op1.js";
  script.async = true;
  script.referrerPolicy = "no-referrer";
  document.head.appendChild(script);
})();
