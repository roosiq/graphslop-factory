export type OwnerCommand =
  | 'submit-message' | 'edit-intent-graph' | 'resolve-question' | 'review-intent' | 'approve-intent'
  | 'propose-solution' | 'review-solution' | 'approve-solution'
  | 'compile-execution' | 'dispatch-task' | 'authorize-repair' | 'preview-pull-request';

export type NextBinding = Readonly<{
  command: OwnerCommand;
  bindings: Readonly<Record<string, string>>;
  capability: string;
}>;

export type PlatformMode = 'local' | 'hosted';

export type SessionUser = Readonly<{
  id: string;
  login: string;
  displayName: string;
  avatarUrl: string | null;
}>;

export type ProjectSummary = Readonly<{
  projectId: string;
  displayName: string;
  role: 'owner' | 'editor' | 'viewer';
  createdAt: string;
  updatedAt: string;
}>;

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function json(response: Response): Promise<any> {
  const body: any = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, body?.error?.message ?? `Request failed (${response.status}).`);
  return body;
}

export class OwnerApi {
  private csrf = sessionStorage.getItem('graphslop-csrf') ?? csrfCookie();
  private platformMode: PlatformMode = 'local';
  private initialized = false;

  mode(): PlatformMode {
    return this.platformMode;
  }

  async initialize(): Promise<PlatformMode> {
    if (this.initialized) return this.platformMode;
    try {
      const response = await fetch('/api/v1/platform', { credentials: 'same-origin' });
      const body: any = response.ok ? await response.json() : null;
      this.platformMode = body?.mode === 'hosted' ? 'hosted' : 'local';
    } catch {
      this.platformMode = 'local';
    }
    this.initialized = true;
    return this.platformMode;
  }

  async session(): Promise<SessionUser | null> {
    const body = await json(await fetch('/api/v1/auth/session', { credentials: 'same-origin' }));
    this.csrf = String(body.csrfToken);
    sessionStorage.setItem('graphslop-csrf', this.csrf);
    return this.platformMode === 'hosted' ? body.user as SessionUser : null;
  }

  async projects(): Promise<readonly ProjectSummary[]> {
    if (this.platformMode === 'local') return [];
    const body = await json(await fetch('/api/v1/projects', { credentials: 'same-origin' }));
    return body.projects ?? [];
  }

  async createProject(displayName: string): Promise<{ projectId: string }> {
    return json(await fetch('/api/v1/projects', {
      method: 'POST',
      credentials: 'same-origin',
      headers: this.mutationHeaders(),
      body: JSON.stringify({ displayName }),
    }));
  }

  async project(projectId?: string): Promise<{
    project: unknown;
    nextBindings: readonly NextBinding[];
    pendingJob?: { jobId: string; status: string } | null;
    actor?: SessionUser;
    membership?: { role: ProjectSummary['role'] };
  }> {
    const path = this.platformMode === 'hosted'
      ? `/api/v1/projects/${encodeURIComponent(projectId ?? '')}`
      : '/api/v1/owner/project';
    return json(await fetch(path, { credentials: 'same-origin' }));
  }

  async events(after?: string): Promise<readonly Record<string, unknown>[]> {
    if (this.platformMode === 'hosted') return [];
    const query = after ? `?after=${encodeURIComponent(after)}` : '';
    return (await json(await fetch(`/api/v1/owner/events${query}`, { credentials: 'same-origin' }))).events ?? [];
  }

  async modelInfo(): Promise<{ connected: boolean; name: string }> {
    return json(await fetch('/api/v1/model', { credentials: 'same-origin' }));
  }

  async downloadBuildPack(projectId?: string): Promise<void> {
    const path = this.platformMode === 'hosted'
      ? `/api/v1/projects/${encodeURIComponent(projectId ?? '')}/build-pack`
      : '/api/v1/owner/build-pack';
    const response = await fetch(path, { credentials: 'same-origin' });
    if (!response.ok) {
      const body: any = await response.json().catch(() => ({}));
      throw new ApiError(response.status, body?.error?.message ?? 'build pack not ready.');
    }
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1]
      ?? 'graphslop-build-pack.zip';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  async command(binding: NextBinding, input: unknown) {
    this.csrf ||= csrfCookie();
    if (!this.csrf) throw new ApiError(403, 'open workspace before change project.');
    const projectId = binding.bindings.projectId;
    const path = this.platformMode === 'hosted'
      ? `/api/v1/projects/${encodeURIComponent(projectId ?? '')}/commands/${binding.command}`
      : `/api/v1/owner/commands/${binding.command}`;
    return json(await fetch(path, {
      method: 'POST', credentials: 'same-origin',
      headers: {
        ...this.mutationHeaders(),
        'idempotency-key': crypto.randomUUID(),
      },
      body: JSON.stringify({ bindings: binding.bindings, input, capability: binding.capability }),
    })) as Promise<{
      result: unknown;
      nextBindings: readonly NextBinding[];
      pendingJob?: { jobId: string; status: string } | null;
    }>;
  }

  private mutationHeaders(): Record<string, string> {
    return {
      'content-type': 'application/json',
      ...(this.platformMode === 'hosted'
        ? { 'x-graphslop-csrf': this.csrf }
        : { 'x-csrf-token': this.csrf }),
    };
  }
}

function csrfCookie(): string {
  if (typeof document === 'undefined') return '';
  const match = document.cookie.split(';').map((item) => item.trim())
    .find((item) => item.startsWith('graphslop_csrf='));
  return match ? decodeURIComponent(match.slice('graphslop_csrf='.length)) : '';
}

export function bindingFor(bindings: readonly NextBinding[], command: OwnerCommand) {
  return bindings.find((item) => item.command === command);
}
