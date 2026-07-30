import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  currentUser,
  ensureBrowserSession,
  requireMutation,
} from '../src/auth.js';

beforeAll(async () => {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      github_id TEXT NOT NULL UNIQUE,
      login TEXT NOT NULL,
      display_name TEXT NOT NULL,
      avatar_url TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      access_kind TEXT NOT NULL DEFAULT 'legacy'
    )
  `).run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      csrf_token TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `).run();
});

describe('anonymous browser sessions', () => {
  it('opens without a key, reuses its cookie, and isolates a fresh browser', async () => {
    const firstRequest = new Request('https://graphslop.com/api/v1/auth/session');
    const first = await ensureBrowserSession(firstRequest, env);
    expect(first.user.login).toMatch(/^guest-[0-9a-f]{8}$/);
    expect(first.setCookie).toContain('graphslop_session=');
    expect(first.setCookie).toContain('HttpOnly');
    expect(first.setCookie).toContain('Secure');

    const cookie = first.setCookie!.split(';', 1)[0]!;
    const returningRequest = new Request('https://graphslop.com/api/v1/auth/session', {
      headers: { cookie },
    });
    const returning = await ensureBrowserSession(returningRequest, env);
    expect(returning.user.id).toBe(first.user.id);
    expect(returning.setCookie).toBeUndefined();
    expect((await currentUser(returningRequest, env))?.id).toBe(first.user.id);

    const separate = await ensureBrowserSession(
      new Request('https://graphslop.com/api/v1/auth/session'),
      env,
    );
    expect(separate.user.id).not.toBe(first.user.id);
  });

  it('keeps origin and CSRF checks on anonymous mutations', async () => {
    const session = await ensureBrowserSession(
      new Request('https://graphslop.com/api/v1/auth/session'),
      env,
    );
    const allowed = new Request('https://graphslop.com/api/v1/projects', {
      method: 'POST',
      headers: {
        origin: 'https://graphslop.com',
        'x-graphslop-csrf': session.user.csrfToken,
      },
    });
    expect(requireMutation(allowed, env, session.user)).toBeNull();

    const forged = new Request('https://graphslop.com/api/v1/projects', {
      method: 'POST',
      headers: {
        origin: 'https://elsewhere.example',
        'x-graphslop-csrf': session.user.csrfToken,
      },
    });
    expect(requireMutation(forged, env, session.user)?.status).toBe(403);
  });
});
