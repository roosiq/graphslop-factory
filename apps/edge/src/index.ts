interface Env {
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
  CONTROL_ORIGIN: string;
}

function controlRequest(request: Request, origin: URL): Request {
  const incoming = new URL(request.url);
  const target = new URL(`${incoming.pathname}${incoming.search}`, origin);
  const headers = new Headers(request.headers);

  headers.set('x-forwarded-proto', origin.protocol.slice(0, -1));
  headers.delete('origin');
  return new Request(target, {
    method: request.method,
    headers,
    body: request.body,
    redirect: 'manual',
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health' || url.pathname.startsWith('/api/')) {
      const requestOrigin = request.headers.get('origin');
      if (requestOrigin && requestOrigin !== url.origin) {
        return Response.json({
          error: { code: 'bad_origin', message: 'Origin does not match this application.' },
        }, { status: 403 });
      }
      const origin = new URL(env.CONTROL_ORIGIN);
      return fetch(controlRequest(request, origin));
    }
    const assetResponse = await env.ASSETS.fetch(request);
    if (assetResponse.headers.get('content-type')?.includes('text/html')) {
      const htmlResponse = new Response(assetResponse.body, assetResponse);
      htmlResponse.headers.set('cache-control', 'no-store');
      return htmlResponse;
    }
    return assetResponse;
  },
};
