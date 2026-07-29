# Self-hosting Graphslop

## Local-only installation

Install Git, Node.js 24, npm 11, and an OpenAI-compatible model server.

```bash
git clone https://github.com/roosiq/graphslop-factory.git
cd graphslop
npm ci
npm run self-host -- --repo /absolute/path/to/your/project
```

The target must already be a Git repository. Graphslop reads its current commit so generated tasks can be bound to an exact starting point.

### Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `GRAPHSLOP_REPOSITORY` | current directory | Target Git repository |
| `GRAPHSLOP_PROJECT_STATE` | `.local/state` | Private durable state |
| `GRAPHSLOP_QWEN_URL` | `http://127.0.0.1:8001/v1` | Local model API |
| `GRAPHSLOP_QWEN_MODEL` | first model returned by `/models` | Model identifier |
| `GRAPHSLOP_CLAIM_TOKEN` | generated | One-time owner key |
| `GRAPHSLOP_PUBLIC_HOST` | unset | Exact tunnel hostname |
| `PORT` | `4173` | Local web port |

CLI flags override environment variables. Run `npm run self-host:fast -- --help` for the flag list.

### Updating

Stop Graphslop, pull the new version, install the locked dependencies, and rebuild:

```bash
git pull --ff-only
npm ci
npm run self-host -- --repo /absolute/path/to/your/project
```

Keep the same state directory. Authority keys and project graphs are durable there.

## Optional Cloudflare deployment

Cloudflare is only the public asset and API edge. The model, authority, project state, and repository remain on your machine.

1. Start Graphslop with an exact public hostname:

   ```bash
   npm run self-host -- \
     --repo /absolute/path/to/your/project \
     --public-host factory-origin.example.com
   ```

2. Expose `http://127.0.0.1:4173` at that HTTPS hostname with Cloudflare Tunnel or another authenticated reverse proxy.

3. Authenticate Wrangler and deploy the edge Worker:

   ```bash
   npx wrangler login
   npm run build --workspace @graphslop/control-plane
   npm run deploy --workspace @graphslop/edge -- \
     --var CONTROL_ORIGIN:https://factory-origin.example.com
   ```

4. Open the emitted `workers.dev` URL and claim the workspace with the owner key printed by the local server.

The Worker rejects cross-origin API requests. The local server also validates the forwarded hostname against the exact public host you supplied.

## Backups

Back up the configured state directory while Graphslop is stopped. It contains:

- project graph state;
- approved baselines;
- runner and drift records;
- local authority keys.

Do not publish the backup.

## Removing an installation

The application code and project state are separate. Removing the Graphslop checkout does not delete the target repository. Deleting the configured state directory permanently removes the Graphslop project record and authority keys.
