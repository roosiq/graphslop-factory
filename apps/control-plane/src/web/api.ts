export type OwnerCommand =
  | 'submit-message' | 'edit-intent-graph' | 'resolve-question' | 'review-intent' | 'approve-intent'
  | 'propose-solution' | 'review-solution' | 'approve-solution'
  | 'compile-execution' | 'dispatch-task' | 'authorize-repair' | 'preview-pull-request';

export type NextBinding = Readonly<{
  command: OwnerCommand;
  bindings: Readonly<Record<string, string>>;
  capability: string;
}>;

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function json(response: Response): Promise<any> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, body?.error?.message ?? `Request failed (${response.status}).`);
  return body;
}

export class OwnerApi {
  private csrf = sessionStorage.getItem('graphslop-csrf') ?? csrfCookie();

  hasOwnerHint(): boolean {
    return Boolean(this.csrf);
  }

  async claim(claimToken: string): Promise<void> {
    const body = await json(await fetch('/api/v1/auth/claim', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ claimToken }),
    }));
    this.csrf = String(body.csrfToken);
    sessionStorage.setItem('graphslop-csrf', this.csrf);
  }

  async project(): Promise<{ project: unknown; nextBindings: readonly NextBinding[] }> {
    return json(await fetch('/api/v1/owner/project', { credentials: 'same-origin' }));
  }

  async events(after?: string): Promise<readonly Record<string, unknown>[]> {
    const query = after ? `?after=${encodeURIComponent(after)}` : '';
    return (await json(await fetch(`/api/v1/owner/events${query}`, { credentials: 'same-origin' }))).events ?? [];
  }

  async modelInfo(): Promise<{ connected: boolean; name: string }> {
    return json(await fetch('/api/v1/model', { credentials: 'same-origin' }));
  }

  async downloadBuildPack(): Promise<void> {
    const response = await fetch('/api/v1/owner/build-pack', { credentials: 'same-origin' });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new ApiError(response.status, body?.error?.message ?? 'Build pack is not ready.');
    }
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'graphslop-build-pack.zip';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  async command(binding: NextBinding, input: unknown) {
    this.csrf ||= csrfCookie();
    if (!this.csrf) throw new ApiError(403, 'Claim this factory before changing it.');
    return json(await fetch(`/api/v1/owner/commands/${binding.command}`, {
      method: 'POST', credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': this.csrf,
        'idempotency-key': crypto.randomUUID(),
      },
      body: JSON.stringify({ bindings: binding.bindings, input, capability: binding.capability }),
    })) as Promise<{ result: unknown; nextBindings: readonly NextBinding[] }>;
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
