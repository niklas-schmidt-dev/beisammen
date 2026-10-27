# Website analytics

`public/openpanel.js` loads the self-hosted OpenPanel browser SDK only on `beisammen.app`. Its client ID (`b6c0f8df-ef8e-4971-98de-b5b94918565e`) is public, and no client secret belongs in this file.

The collector is `https://openpanel-web-production.up.railway.app/api`. OpenPanel writes to the shared ClickHouse instance's `openpanel` database; Grafana reads that database through PDC.

The SDK tracks initial page views and browser history navigation. Initialization is guarded against duplicate loads. It does not identify visitors, record sessions, capture clicks, or read forms. DNT and Global Privacy Control disable collection. Account areas, invite/connection links and other sensitive routes are excluded. URLs retain only the five UTM campaign parameters; hashes and other queries are removed, and referrers retain only their origin. Local and preview hosts send nothing. Existing analytics integrations remain independently configured.

Verify a production visit with a unique `utm_campaign` marker, then check this website's OpenPanel project and the matching project filter in Grafana's OpenPanel overview. Browser blockers can prevent delivery; analytics failure must not affect page rendering.
