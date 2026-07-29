# Security

## Supported version

Security fixes are applied to the latest release on the default branch.

## Report a vulnerability

Use GitHub's private vulnerability reporting for this repository. Do not open a public issue for an unpatched vulnerability.

Include the affected component, reproduction steps, impact, and any suggested mitigation.

## Self-hosting safety

- Keep the control plane on loopback unless you have configured an authenticated HTTPS boundary.
- Keep `.env`, `.local/`, `.factory/`, tunnel credentials, and generated authority files out of Git.
- Use an exact `GRAPHSLOP_PUBLIC_HOST` when a tunnel is enabled.
- Do not expose the local model endpoint directly.
- Review a downloaded build pack before giving it to a coding harness.
- Treat model output and worker output as untrusted until deterministic validation succeeds.
