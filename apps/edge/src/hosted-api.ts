import { createBuildPackFiles } from '@graphslop/build-pack';
import { strToU8, zipSync } from 'fflate';

import {
  cleanupExpiredAuth,
  ensureBrowserSession,
  requireMutation,
  requireUser,
  type AuthenticatedUser,
} from './auth.js';
import type {
  HostedCommand,
  ProjectRole,
  ProjectView,
} from './project-workbench.js';

const MAX_JSON_BYTES = 256 * 1024;
const PROJECT_ID = /^project-[0-9a-f-]{36}$/;

type Membership = Readonly<{
  projectId: string;
  displayName: string;
  role: ProjectRole;
  createdAt: string;
  updatedAt: string;
}>;

function error(code: string, message: string, status: number): Response {
  return Response.json({ error: { code, message } }, {
    status,
    headers: { 'cache-control': 'no-store' },
  });
}

async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get('content-type')?.split(';', 1)[0]?.trim() !== 'application/json') {
    throw error('unsupported_media_type', 'Use application/json.', 415);
  }
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (!Number.isFinite(declared) || declared > MAX_JSON_BYTES) {
    throw error('body_too_large', 'Request body is too large.', 413);
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_JSON_BYTES) {
    throw error('body_too_large', 'Request body is too large.', 413);
  }
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw error('invalid_json', 'Request body must be one JSON object.', 400);
  }
}

function projectStub(env: Env, projectId: string) {
  return env.PROJECTS.getByName(projectId);
}

function parseView(value: string): ProjectView {
  return JSON.parse(value) as ProjectView;
}

async function membership(env: Env, userId: string, projectId: string): Promise<Membership | null> {
  const row = await env.DB.prepare(`
    SELECT p.id AS project_id, p.display_name, p.created_at, p.updated_at, m.role
    FROM projects p
    JOIN project_memberships m ON m.project_id = p.id
    WHERE p.id = ? AND m.user_id = ? AND p.archived_at IS NULL
  `).bind(projectId, userId).first<{
    project_id: string;
    display_name: string;
    role: ProjectRole;
    created_at: string;
    updated_at: string;
  }>();
  return row ? {
    projectId: row.project_id,
    displayName: row.display_name,
    role: row.role,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  } : null;
}

async function requireMembership(
  env: Env,
  user: AuthenticatedUser,
  projectId: string,
): Promise<Membership | Response> {
  if (!PROJECT_ID.test(projectId)) return error('project_not_found', 'Project was not found.', 404);
  return await membership(env, user.id, projectId)
    ?? error('project_not_found', 'Project was not found.', 404);
}

function projectResponse(view: ProjectView, member: Membership, user: AuthenticatedUser): Response {
  return Response.json({
    project: view.state,
    revision: view.revision,
    nextBindings: view.nextBindings,
    pendingJob: view.pendingJob,
    membership: { role: member.role },
    actor: {
      id: user.id,
      login: user.login,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
    },
  }, { headers: { 'cache-control': 'no-store' } });
}

function commandFromPath(pathname: string): { projectId: string; command: HostedCommand } | null {
  const match = pathname.match(/^\/api\/v1\/projects\/([^/]+)\/commands\/([^/]+)$/);
  if (!match) return null;
  const allowed = new Set<HostedCommand>([
    'submit-message',
    'edit-intent-graph',
    'resolve-question',
    'review-intent',
    'approve-intent',
    'propose-solution',
    'review-solution',
    'approve-solution',
    'compile-execution',
  ]);
  return allowed.has(match[2] as HostedCommand)
    ? { projectId: match[1]!, command: match[2] as HostedCommand }
    : null;
}

function constantSecret(left: string | null, right: string): boolean {
  if (typeof right !== 'string' || right.length < 32) return false;
  if (!left || left.length !== `Bearer ${right}`.length) return false;
  const expected = `Bearer ${right}`;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ left.charCodeAt(index);
  }
  return difference === 0;
}

async function internalModelApi(request: Request, env: Env, path: string): Promise<Response> {
  if (!constantSecret(request.headers.get('authorization'), env.MODEL_RUNNER_TOKEN)) {
    return error('runner_required', 'Model runner identity is required.', 401);
  }
  const match = path.match(/^\/api\/v1\/internal\/projects\/([^/]+)\/model-jobs\/([^/]+)(?:\/(complete|fail))?$/);
  if (!match || !PROJECT_ID.test(match[1]!)) return error('job_not_found', 'Model job was not found.', 404);
  const [, projectId, jobId, action] = match;
  const stub = projectStub(env, projectId!);
  if (request.method === 'GET' && !action) {
    const job = await stub.modelJob(jobId!);
    if (!job) return error('job_not_found', 'Model job was not found.', 404);
    await stub.markModelJobRunning(jobId!);
    return Response.json({ job }, { headers: { 'cache-control': 'no-store' } });
  }
  if (request.method === 'POST' && action === 'complete') {
    const body = await jsonBody(request);
    const revision = await stub.completeModelJob(jobId!, body.proposal);
    await env.DB.prepare('UPDATE projects SET updated_at = ? WHERE id = ?')
      .bind(new Date().toISOString(), projectId).run();
    return Response.json({ accepted: true, revision });
  }
  if (request.method === 'POST' && action === 'fail') {
    const body = await jsonBody(request);
    const job = await stub.failModelJob(jobId!, typeof body.error === 'string' ? body.error : 'Model job failed.');
    return Response.json({ accepted: true, job });
  }
  return error('method_not_allowed', 'Method is not allowed.', 405);
}

async function listProjects(env: Env, user: AuthenticatedUser): Promise<Response> {
  const result = await env.DB.prepare(`
    SELECT p.id, p.display_name, p.created_at, p.updated_at, m.role
    FROM projects p
    JOIN project_memberships m ON m.project_id = p.id
    WHERE m.user_id = ? AND p.archived_at IS NULL
    ORDER BY p.updated_at DESC
  `).bind(user.id).all<{
    id: string;
    display_name: string;
    created_at: string;
    updated_at: string;
    role: ProjectRole;
  }>();
  return Response.json({
    projects: result.results.map((row) => ({
      projectId: row.id,
      displayName: row.display_name,
      role: row.role,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  }, { headers: { 'cache-control': 'no-store' } });
}

async function createProject(request: Request, env: Env, user: AuthenticatedUser): Promise<Response> {
  const blocked = requireMutation(request, env, user);
  if (blocked) return blocked;
  const body = await jsonBody(request);
  const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
  if (!displayName || displayName.length > 80) return error('invalid_project', 'Project name must be 1–80 characters.', 422);
  const projectId = `project-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO projects (id, display_name, created_by, created_at, updated_at, archived_at)
      VALUES (?, ?, ?, ?, ?, NULL)
    `).bind(projectId, displayName, user.id, now, now),
    env.DB.prepare(`
      INSERT INTO project_memberships (project_id, user_id, role, created_at)
      VALUES (?, ?, 'owner', ?)
    `).bind(projectId, user.id, now),
  ]);
  try {
    const view = parseView(await projectStub(env, projectId).create({
      projectId,
      displayName,
      actorId: user.id,
      createdAt: now,
    }));
    return Response.json({
      projectId,
      project: view.state,
      revision: view.revision,
    }, { status: 201 });
  } catch (cause) {
    await env.DB.prepare('DELETE FROM projects WHERE id = ?').bind(projectId).run();
    throw cause;
  }
}

async function runCommand(
  request: Request,
  env: Env,
  user: AuthenticatedUser,
  projectId: string,
  command: HostedCommand,
): Promise<Response> {
  const blocked = requireMutation(request, env, user);
  if (blocked) return blocked;
  const member = await requireMembership(env, user, projectId);
  if (member instanceof Response) return member;
  const body = await jsonBody(request);
  const bindings = body.bindings && typeof body.bindings === 'object' && !Array.isArray(body.bindings)
    ? body.bindings as Record<string, unknown>
    : {};
  const expectedRevision = Number(bindings.revision);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1 || bindings.projectId !== projectId) {
    return error('stale_binding', 'A current project revision is required.', 409);
  }
  const commandInput = {
    actorId: user.id,
    role: member.role,
    expectedRevision,
    command,
    input: body.input,
  };
  const stub = projectStub(env, projectId);
  if (
    command === 'submit-message'
    || command === 'propose-solution'
    || (
      command === 'resolve-question'
      && body.input
      && typeof body.input === 'object'
      && (body.input as Record<string, unknown>).disposition === 'answered'
    )
  ) {
    const queued = await stub.createModelJob(commandInput);
    try {
      await env.MODEL_JOBS.send(queued.queueMessage, {
        contentType: 'json',
      });
    } catch (cause) {
      await stub.failModelJob(
        queued.job.jobId,
        cause instanceof Error ? cause.message : 'Could not queue the model job.',
      );
      throw cause;
    }
    const view = parseView(await stub.read());
    await env.DB.prepare('UPDATE projects SET updated_at = ? WHERE id = ?')
      .bind(new Date().toISOString(), projectId).run();
    return Response.json({
      result: { job: queued.job },
      nextBindings: view.nextBindings,
      pendingJob: view.pendingJob,
    }, { status: 202 });
  }
  const view = parseView(await stub.command(commandInput));
  await env.DB.prepare('UPDATE projects SET updated_at = ? WHERE id = ?')
    .bind(new Date().toISOString(), projectId).run();
  return Response.json({
    result: view.state,
    nextBindings: view.nextBindings,
    pendingJob: view.pendingJob,
  });
}

async function buildPack(env: Env, user: AuthenticatedUser, projectId: string): Promise<Response> {
  const member = await requireMembership(env, user, projectId);
  if (member instanceof Response) return member;
  const view = parseView(await projectStub(env, projectId).read());
  const { manifest, files, harnessFiles } = createBuildPackFiles(view.state);
  const key = `${projectId}/${manifest.schemaVersion}/${manifest.executionHash}.zip`;
  let object = await env.BUILD_PACKS.get(key);
  if (!object) {
    const input = Object.fromEntries([
      ...Object.entries(files).map(([path, content]) => [
        `.factory/${path}`,
        strToU8(content),
      ] as const),
      ...Object.entries(harnessFiles).map(([path, content]) => [
        path,
        strToU8(content),
      ] as const),
    ]);
    const archive = zipSync(input, { level: 6 });
    await env.BUILD_PACKS.put(key, archive, {
      httpMetadata: { contentType: 'application/zip' },
      customMetadata: {
        projectId,
        executionHash: manifest.executionHash,
      },
    });
    object = await env.BUILD_PACKS.get(key);
  }
  if (!object) return error('pack_unavailable', 'Build pack could not be stored.', 500);
  return new Response(object.body, {
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="graphslop-${projectId}.zip"`,
      etag: object.httpEtag,
      'cache-control': 'private, no-store',
    },
  });
}

export async function hostedApi(request: Request, env: Env, ctx: ExecutionContext): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith('/api/')) return null;

  try {
    if (path.startsWith('/api/v1/internal/')) return internalModelApi(request, env, path);
    if (request.method === 'GET' && path === '/api/v1/platform') {
      return Response.json({ mode: 'hosted', auth: 'anonymous-browser', projects: true, asyncModel: true });
    }
    if (request.method === 'GET' && path === '/api/v1/auth/session') {
      const session = await ensureBrowserSession(request, env);
      const headers = new Headers({ 'cache-control': 'no-store' });
      if (session.setCookie) headers.set('set-cookie', session.setCookie);
      return Response.json({ user: {
        id: session.user.id,
        login: session.user.login,
        displayName: session.user.displayName,
        avatarUrl: session.user.avatarUrl,
      }, csrfToken: session.user.csrfToken }, { headers });
    }
    if (request.method === 'GET' && path === '/api/v1/model') {
      return Response.json({ connected: true, name: 'Qwen job queue' });
    }

    const userOrResponse = await requireUser(request, env);
    if (userOrResponse instanceof Response) return userOrResponse;
    const user = userOrResponse;

    if (path === '/api/v1/projects' && request.method === 'GET') return listProjects(env, user);
    if (path === '/api/v1/projects' && request.method === 'POST') return createProject(request, env, user);

    const projectMatch = path.match(/^\/api\/v1\/projects\/([^/]+)$/);
    if (projectMatch && request.method === 'GET') {
      const member = await requireMembership(env, user, projectMatch[1]!);
      if (member instanceof Response) return member;
      return projectResponse(parseView(await projectStub(env, member.projectId).read()), member, user);
    }

    const packMatch = path.match(/^\/api\/v1\/projects\/([^/]+)\/build-pack$/);
    if (packMatch && request.method === 'GET') return buildPack(env, user, packMatch[1]!);

    const parsedCommand = commandFromPath(path);
    if (parsedCommand && request.method === 'POST') {
      return runCommand(request, env, user, parsedCommand.projectId, parsedCommand.command);
    }

    ctx.waitUntil(cleanupExpiredAuth(env));
    return error('not_found', 'API route was not found.', 404);
  } catch (cause) {
    if (cause instanceof Response) return cause;
    const message = cause instanceof Error ? cause.message : 'The request could not be completed.';
    const conflict = /changed|stale|revision|already has a model job/i.test(message);
    console.error(JSON.stringify({
      event: 'hosted_api_error',
      path,
      method: request.method,
      name: cause instanceof Error ? cause.name : 'UnknownError',
      message,
    }));
    return error(conflict ? 'stale_binding' : 'request_failed', message, conflict ? 409 : 422);
  }
}
