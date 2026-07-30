import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const SESSION_COOKIE = 'graphslop_owner';
const CSRF_COOKIE = 'graphslop_csrf';

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function sameSecret(left: string, right: string): boolean {
  return timingSafeEqual(digest(left), digest(right));
}

export function opaqueSecretMatches(left: string | undefined, right: string): boolean {
  return Boolean(left && sameSecret(left, right));
}

function opaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

export type OwnerSession = Readonly<{ session: string; csrf: string }>;

export class SoleOwnerSessions {
  #sessionHash?: Buffer;

  open(): OwnerSession {
    const session = opaqueToken();
    this.#sessionHash = digest(session);
    return { session, csrf: opaqueToken() };
  }

  authenticate(candidate: string | undefined): boolean {
    if (!candidate || !this.#sessionHash) return false;
    return timingSafeEqual(digest(candidate), this.#sessionHash);
  }
}

export function parseCookies(header: string | undefined): Readonly<Record<string, string>> {
  const cookies: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name && !Object.hasOwn(cookies, name)) cookies[name] = value;
  }
  return cookies;
}

export function sessionFromCookie(header: string | undefined): string | undefined {
  return parseCookies(header)[SESSION_COOKIE];
}

export function csrfMatches(cookieHeader: string | undefined, headerToken: string | undefined): boolean {
  const cookieToken = parseCookies(cookieHeader)[CSRF_COOKIE];
  return Boolean(cookieToken && headerToken && sameSecret(cookieToken, headerToken));
}

export function ownerCookies(session: OwnerSession, secure: boolean): readonly string[] {
  const suffix = `Path=/; SameSite=Strict${secure ? '; Secure' : ''}`;
  return [
    `${SESSION_COOKIE}=${session.session}; HttpOnly; ${suffix}`,
    `${CSRF_COOKIE}=${session.csrf}; ${suffix}`,
  ];
}
