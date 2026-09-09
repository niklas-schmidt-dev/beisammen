interface Env {
  ASSETS: Fetcher;
}

// Routes that have a markdown representation under /_agent/ (written by
// scripts/generate-agent-md.mts at build time). Paths that look like real
// files (contain an extension) are never negotiated.
function markdownAssetPath(pathname: string): string | null {
  if (/\.[a-z0-9]+$/i.test(pathname)) {
    return null;
  }
  const clean = pathname.replace(/\/+$/, '');
  return `/_agent${clean}/index.md`;
}

function withVaryAccept(response: Response): Response {
  const varied = new Response(response.body, response);
  varied.headers.append('vary', 'Accept');
  return varied;
}

// App association files for Universal Links (iOS) and App Links (Android).
// The AASA file has no extension, so the asset layer would guess its type
// and the SPA fallback would answer a missing file with index.html — both
// break verification. Serve them explicitly as JSON or as a real 404.
const APP_ASSOCIATION_PATHS = new Set([
  '/.well-known/apple-app-site-association',
  '/.well-known/assetlinks.json',
]);

async function serveAppAssociation(request: Request, env: Env): Promise<Response> {
  const response = await env.ASSETS.fetch(request);
  const type = response.headers.get('content-type') ?? '';
  if (!response.ok || type.includes('text/html')) {
    return new Response('Not found', { status: 404 });
  }
  return new Response(response.body, {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'public, max-age=3600',
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname === 'www.beisammen.app') {
      url.hostname = 'beisammen.app';
      return Response.redirect(url.toString(), 301);
    }

    if (APP_ASSOCIATION_PATHS.has(url.pathname)) {
      return serveAppAssociation(request, env);
    }

    // Markdown for agents: requests that ask for text/markdown get the
    // pre-rendered markdown representation of the page; browsers keep
    // getting HTML. See https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/
    const accept = request.headers.get('accept') ?? '';
    const negotiable =
      (request.method === 'GET' || request.method === 'HEAD') &&
      accept.toLowerCase().includes('text/markdown');
    const mdPath = negotiable ? markdownAssetPath(url.pathname) : null;

    if (mdPath) {
      const mdResponse = await env.ASSETS.fetch(new URL(mdPath, url).toString());
      const mdType = mdResponse.headers.get('content-type') ?? '';
      // The SPA fallback answers unknown paths with index.html — only a
      // non-HTML hit is a real markdown asset.
      if (mdResponse.ok && !mdType.includes('text/html')) {
        const body = await mdResponse.text();
        return new Response(request.method === 'HEAD' ? null : body, {
          headers: {
            'content-type': 'text/markdown; charset=utf-8',
            vary: 'Accept',
            'x-markdown-tokens': String(Math.ceil(body.length / 4)),
            'cache-control': 'public, max-age=300',
          },
        });
      }
    }

    const response = await env.ASSETS.fetch(request);
    // Negotiated paths vary by Accept either way, so caches never mix the
    // two representations.
    return markdownAssetPath(url.pathname) ? withVaryAccept(response) : response;
  },
} satisfies ExportedHandler<Env>;
