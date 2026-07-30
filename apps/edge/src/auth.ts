const SESSION_COOKIE = 'graphslop_session';
const SESSION_DAYS = 30;

export type AuthenticatedUser = Readonly<{
  id: string;
  login: string;
  displayName: string;
  avatarUrl: string | null;
  csrfToken: string;
}>;

export type BrowserSession = Readonly<{
  user: AuthenticatedUser;
  setCookie?: string;
}>;

function cookies(request: Request): Readonly<Record<string, string>> {
  const output: Record<string, string> = {};
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name && !Object.hasOwn(output, name)) output[name] = decodeURIComponent(value);
  }
  return output;
}

function randomToken(bytes = 32): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

function base64Url(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

async function sha256(value: string): Promise<string> {
  return base64Url(new Uint8Array(await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  )));
}

function secureSessionCookie(value: string): string {
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(value)}`,
    'Path=/',
    `Max-Age=${SESSION_DAYS * 24 * 60 * 60}`,
    'Secure',
    'HttpOnly',
    'SameSite=Lax',
  ].join('; ');
}

function appOrigin(request: Request, env: Env): string {
  return env.APP_ORIGIN || new URL(request.url).origin;
}

export async function currentUser(request: Request, env: Env): Promise<AuthenticatedUser | null> {
  const token = cookies(request)[SESSION_COOKIE];
  if (!token) return null;
  const row = await env.DB.prepare(`
    SELECT u.id, u.login, u.display_name, u.avatar_url, s.csrf_token
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `).bind(await sha256(token), new Date().toISOString()).first<{
    id: string;
    login: string;
    display_name: string;
    avatar_url: string | null;
    csrf_token: string;
  }>();
  return row ? {
    id: row.id,
    login: row.login,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    csrfToken: row.csrf_token,
  } : null;
}

export async function ensureBrowserSession(request: Request, env: Env): Promise<BrowserSession> {
  const existing = await currentUser(request, env);
  if (existing) return { user: existing };

  const anonymousId = crypto.randomUUID();
  const userId = `user-${crypto.randomUUID()}`;
  const login = `guest-${anonymousId.slice(0, 8)}`;
  const sessionToken = randomToken();
  const csrfToken = randomToken();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60_000).toISOString();

  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO users (
        id, github_id, login, display_name, avatar_url, created_at, updated_at, access_kind
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      userId,
      `anonymous:${anonymousId}`,
      login,
      'Guest workspace',
      null,
      now,
      now,
      'anonymous',
    ),
    env.DB.prepare(`
      INSERT INTO sessions (token_hash, user_id, csrf_token, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(await sha256(sessionToken), userId, csrfToken, expiresAt, now),
  ]);

  return {
    user: {
      id: userId,
      login,
      displayName: 'Guest workspace',
      avatarUrl: null,
      csrfToken,
    },
    setCookie: secureSessionCookie(sessionToken),
  };
}

export async function requireUser(request: Request, env: Env): Promise<AuthenticatedUser | Response> {
  const user = await currentUser(request, env);
  return user ?? Response.json({
    error: { code: 'session_required', message: 'open workspace in browser first.' },
  }, { status: 401, headers: { 'cache-control': 'no-store' } });
}

export function requireMutation(request: Request, env: Env, user: AuthenticatedUser): Response | null {
  const origin = request.headers.get('origin');
  if (origin && origin !== appOrigin(request, env) && origin !== new URL(request.url).origin) {
    return Response.json({
      error: { code: 'bad_origin', message: 'request come from wrong place.' },
    }, { status: 403 });
  }
  if (request.headers.get('x-graphslop-csrf') !== user.csrfToken) {
    return Response.json({
      error: { code: 'csrf_required', message: 'current workspace token missing.' },
    }, { status: 403 });
  }
  return null;
}

export async function cleanupExpiredAuth(env: Env): Promise<void> {
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?')
    .bind(new Date().toISOString()).run();
}
