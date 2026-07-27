# First-Release Threat Model

**Scope**: Single owner, local control plane, local runner, owner-trusted repository  
**Out of scope**: Multi-tenant hosting and safe execution of intentionally hostile repositories

## Assets

- approved graph snapshots and baselines
- owner decisions and conversation history
- repository source and Git history
- model and GitHub credentials
- task leases and repair authorizations
- verification evidence and drift reports

## Trust Boundaries

```text
browser ── owner session ── control plane ── signed loopback protocol ── runner
                                   │                                  │
                              graph store                         worktrees
                                                                      │
                                                                Codex process
                                                                      │
                                                                target tests
```

The control plane trusts neither model output nor runner results. The runner trusts neither lease
content without signature/hash validation nor repository code outside the owner-trusted limitation.

## Threats and Required Controls

| Threat | Required control | Failure disposition |
|---|---|---|
| Anonymous or second-owner access | loopback bind, one-time claim, HttpOnly session, CSRF, sole-owner invariant | deny without project disclosure |
| Reused or leaked claim token | fragment transport, one-time nonce, short expiry, immediate invalidation | deny and rotate |
| Runner impersonation | separate enrollment secret, HMAC messages, key ID and revocation | reject and disable execution |
| Lease replay or stale result | idempotency key, expiry, cancellation generation, exact graph/baseline/base hashes | reject and record security event |
| Model grants itself authority | strict proposal schemas plus deterministic IDs, transitions, approvals, and readiness | reject proposal |
| Model or command reads secrets | permission profile, environment allowlist, denied secret paths, no prompt credentials | fail attempt and quarantine output |
| Out-of-scope file change | realpath-aware allowed paths, full Git status/diff, symlink/submodule/.git rules | fail attempt; never integrate |
| Command injection | argv arrays, declared commands, no shell interpolation, timeout and output limits | reject task/check contract |
| Network exfiltration | model-command network default deny; explicit future decision for any destination | fail closed |
| Malicious target tests | trusted-repository limitation, disposable worktree, restricted environment, limits | stop process; project blocked |
| Raw provider stream leakage | temporary storage, size limit, secret scan, redaction, delete after evidence extraction | quarantine then delete |
| Corrupt or partial graph write | one writer, expected-head CAS, canonical hashes, atomic rename, head last | recover prior valid head |
| Projection misrepresents graph | deterministic projection hash tied to snapshot and template | block approval |
| Repair loops or widens scope | one-attempt default, explicit owner authorization, fresh accepted base, protected assertions | escalate |
| Draft PR causes release | separate remote/ref/body-hash authorization; draft only | no push without exact authority; never merge/deploy |

## Residual Risk

Codex permission profiles are beta and worktrees are not hostile-code sandboxes. The capability
probe must fail closed, but a defect in provider-level enforcement remains possible. Independent
path, command, evidence, and integration gates limit acceptance risk rather than claiming complete
containment. The first release must visibly label connected repositories as owner-trusted.

## Security Acceptance Ownership

- `packages/contracts`: schema and unknown-field rejection
- `packages/control-state`: sessions, approvals, lifecycle, protected assertions
- `apps/runner`: environment, process, worktree, path, command, evidence, and cancellation controls
- `packages/file-store`: atomicity, hashes, recovery, retention, and deletion
- `tests/security`: every threat row has at least one rejecting fixture and one allowed control case
