import { Hono, type Context } from 'hono';
import { randomUUID } from 'node:crypto';

import {
  csrfMatches,
  opaqueSecretMatches,
  ownerCookies,
  sessionFromCookie,
  SoleOwnerSessions,
} from '../auth/session.js';
import {
  isOwnerCommand,
  parseEnvelope,
  parseRunnerEvent,
  parseSafeEvent,
  type ControlAdapter,
} from '../services/control.js';
import { IdempotencyStore } from '../services/idempotency.js';

const MAX_BODY_BYTES = 256 * 1024;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

export type ControlPlaneOptions = Readonly<{
  sessions: SoleOwnerSessions;
  adapter: ControlAdapter;
  runnerToken: string;
  allowedHosts?: readonly string[];
  idempotency?: IdempotencyStore;
  modelInfo?: () => Promise<Readonly<{ connected: boolean; name: string }>>;
  buildPack?: () => Promise<Uint8Array>;
}>;

function error(code: string, message: string): { error: { code: string; message: string } } {
  return { error: { code, message } };
}

async function jsonBody(request: Request): Promise<unknown> {
  const type = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (type !== 'application/json') throw new Response(JSON.stringify(error('unsupported_media_type', 'Use application/json.')), { status: 415 });
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (!Number.isFinite(declared) || declared > MAX_BODY_BYTES) {
    throw new Response(JSON.stringify(error('body_too_large', 'Request body is too large.')), { status: 413 });
  }
  const text = await request.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) {
    throw new Response(JSON.stringify(error('body_too_large', 'Request body is too large.')), { status: 413 });
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Response(JSON.stringify(error('invalid_json', 'Request body is not valid JSON.')), { status: 400 });
  }
}

function effectiveProtocol(request: Request): 'http:' | 'https:' {
  const forwarded = request.headers.get('x-forwarded-proto')?.split(',', 1)[0]?.trim().toLowerCase();
  if (forwarded === 'https') return 'https:';
  if (forwarded === 'http') return 'http:';
  return new URL(request.url).protocol === 'https:' ? 'https:' : 'http:';
}

function requestHostname(request: Request): string {
  const candidate = request.headers.get('host')?.trim();
  if (!candidate) return new URL(request.url).hostname;
  try {
    return new URL(`http://${candidate}`).hostname;
  } catch {
    return '';
  }
}

function exactOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  const host = request.headers.get('host')?.trim();
  return Boolean(host && origin === `${effectiveProtocol(request)}//${host}`);
}

export function createControlPlane(options: ControlPlaneOptions): Hono {
  if (options.runnerToken.length < 24) throw new Error('Runner token is too short.');
  const app = new Hono();
  const idempotency = options.idempotency ?? new IdempotencyStore();
  const hosts = new Set(options.allowedHosts ?? ['127.0.0.1', 'localhost', '[::1]']);

  app.use('*', async (context, next) => {
    const url = new URL(context.req.url);
    const host = requestHostname(context.req.raw);
    if (!hosts.has(host) || !hosts.has(url.hostname)) {
      return context.json(error('loopback_only', 'This server accepts loopback requests only.'), 403);
    }
    if (!exactOrigin(context.req.raw)) return context.json(error('bad_origin', 'Origin does not match this server.'), 403);
    await next();
  });

  app.get('/health', (context) => context.json({
    status: 'ok',
    exposure: hosts.size > 3 ? 'loopback+tunnel' : 'loopback',
  }));
  app.get('/api/v1/model', async (context) => context.json(
    options.modelInfo ? await options.modelInfo() : { connected: false, name: 'Local model' },
  ));

  const openBrowserSession = (context: Context) => {
    const session = options.sessions.open();
    for (const cookie of ownerCookies(session, effectiveProtocol(context.req.raw) === 'https:')) {
      context.header('Set-Cookie', cookie, { append: true });
    }
    return context.json({ opened: true, csrfToken: session.csrf }, 201);
  };

  app.get('/api/v1/auth/session', openBrowserSession);
  app.post('/api/v1/auth/claim', openBrowserSession);

  app.use('/api/v1/owner/*', async (context, next) => {
    if (!options.sessions.authenticate(sessionFromCookie(context.req.header('cookie')))) {
      return context.json(error('owner_required', 'Owner session required.'), 401);
    }
    await next();
  });

  app.get('/api/v1/owner/project', async (context) => context.json({
    project: await options.adapter.readProject(),
    nextBindings: await options.adapter.readNextBindings?.() ?? [],
  }));
  app.get('/api/v1/owner/events', async (context) => {
    const events = await options.adapter.readEvents(context.req.query('after'));
    return context.json({ events: events.map(parseSafeEvent).filter((event) => event !== undefined).slice(-500) });
  });
  app.get('/api/v1/owner/build-pack', async (context) => {
    if (!options.buildPack) return context.json(error('pack_unavailable', 'Build pack export is unavailable.'), 404);
    try {
      const archive = await options.buildPack();
      const body = Uint8Array.from(archive);
      return new Response(body.buffer, {
        status: 200,
        headers: {
          'content-type': 'application/zip',
          'content-disposition': 'attachment; filename="graphslop-build-pack.zip"',
          'cache-control': 'no-store',
        },
      });
    } catch (cause) {
      return context.json(error('pack_not_ready', cause instanceof Error ? cause.message : 'Build pack is not ready.'), 409);
    }
  });

  app.post('/api/v1/owner/commands/:command', async (context) => {
    const command = context.req.param('command');
    if (!isOwnerCommand(command)) return context.json(error('unknown_command', 'Command is not approved.'), 404);
    if (!csrfMatches(context.req.header('cookie'), context.req.header('x-csrf-token'))) {
      return context.json(error('csrf_required', 'Matching CSRF token required.'), 403);
    }
    const key = context.req.header('idempotency-key');
    if (!key || !IDEMPOTENCY_KEY.test(key)) {
      return context.json(error('idempotency_required', 'A valid Idempotency-Key is required.'), 400);
    }
    const envelope = parseEnvelope(await jsonBody(context.req.raw), command);
    if (!envelope) return context.json(error('invalid_binding', 'Exact graph, baseline, projection, task, and lease bindings are required.'), 422);
    const requestHash = idempotency.requestHash({ command, envelope });
    const response = await idempotency.run('owner', key, requestHash, async () => {
      const result = await options.adapter.commandAtomic(command, envelope);
      return result.ok
        ? { status: 200, body: { result: result.result, nextBindings: result.nextBindings ?? [] } }
        : { status: 409, body: error('stale_binding', 'Bindings do not match current accepted authority.') };
    });
    if (response === 'conflict') return context.json(error('idempotency_conflict', 'This key was used for different input.'), 409);
    return context.json(response.body, response.status as 200 | 409);
  });

  app.use('/api/v1/runner/*', async (context, next) => {
    const candidate = context.req.header('authorization');
    if (!opaqueSecretMatches(candidate, `Bearer ${options.runnerToken}`)) {
      return context.json(error('runner_required', 'Runner identity required.'), 401);
    }
    await next();
  });

  app.post('/api/v1/runner/events', async (context) => {
    const key = context.req.header('idempotency-key');
    if (!key || !IDEMPOTENCY_KEY.test(key)) {
      return context.json(error('idempotency_required', 'A valid Idempotency-Key is required.'), 400);
    }
    const clientEvent = await jsonBody(context.req.raw);
    const validated = parseRunnerEvent(clientEvent, 'event-validation');
    if (!validated) return context.json(error('invalid_event', 'Event is invalid or too large.'), 422);
    const { eventId: _, ...validatedPayload } = validated;
    const requestHash = idempotency.requestHash(validatedPayload);
    const response = await idempotency.run('runner', key, requestHash, async () => ({
      status: 202,
      body: {
        accepted: true,
        result: await options.adapter.runnerEvent(parseRunnerEvent(clientEvent, `event-${randomUUID()}`)!),
      },
    }));
    if (response === 'conflict') return context.json(error('idempotency_conflict', 'This key was used for different input.'), 409);
    return context.json(response.body, 202);
  });

  app.notFound((context) => {
    const path = new URL(context.req.url).pathname;
    const known = path === '/health'
      || path === '/api/v1/auth/session'
      || path === '/api/v1/auth/claim'
      || path === '/api/v1/owner/project'
      || path === '/api/v1/owner/events'
      || path.startsWith('/api/v1/owner/commands/')
      || path === '/api/v1/runner/events';
    if (known) {
      context.header('Allow', path === '/health' || path.endsWith('/project') || path.endsWith('/events') && path.includes('/owner/')
        ? 'GET'
        : 'POST');
      return context.json(error('method_not_allowed', 'Method is not allowed for this route.'), 405);
    }
    return context.json(error('not_found', 'Route not found.'), 404);
  });
  app.onError((cause, context) => {
    if (cause instanceof Response) {
      return new Response(cause.body, { status: cause.status, headers: { 'content-type': 'application/json' } });
    }
    if (cause instanceof Error && cause.name === 'ProjectServiceError') {
      return context.json(error('project_update_failed', cause.message), 422);
    }
    return context.json(error('internal_error', 'The request could not be completed.'), 500);
  });
  return app;
}
