import { hostedApi } from './hosted-api.js';
import { cleanupExpiredAuth } from './auth.js';

export { ProjectWorkbench } from './project-workbench.js';

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const apiResponse = await hostedApi(request, env, ctx);
    if (apiResponse) return apiResponse;

    const assetResponse = await env.ASSETS.fetch(request);
    if (assetResponse.headers.get('content-type')?.includes('text/html')) {
      const htmlResponse = new Response(assetResponse.body, assetResponse);
      htmlResponse.headers.set('cache-control', 'no-store');
      return htmlResponse;
    }
    return assetResponse;
  },
  async scheduled(_controller, env, ctx): Promise<void> {
    ctx.waitUntil(cleanupExpiredAuth(env));
  },
} satisfies ExportedHandler<Env>;
