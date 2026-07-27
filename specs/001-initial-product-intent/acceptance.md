# Acceptance Corpus and Measurement Contract

## Versioned Fixture Manifest

`tests/fixtures/manifest.json` is the release denominator for every “100%” automated success
criterion. Each entry contains fixture ID, category, protected requirement IDs, expected outcome,
schema version, and source regression if applicable.

Minimum first-release corpus:

| Category | Minimum |
|---|---:|
| Rough, minimal, contradictory, and correction conversations | 30 |
| Question ranking, tie, blocking, and readiness | 24 |
| Intent node, edge, status, confidence, and answer enums | one valid and one invalid fixture per enumerated value |
| Graph delta, snapshot, hash, baseline, transformation, and projection | 30 |
| Approval and stale-version failures | 16 |
| Solution orphan and implementation-support boundaries | 12 |
| Execution task schema, DAG, dependency, and trace failures | 24 |
| Lifecycle allowed and rejected transitions | one fixture per transition-table row |
| Lease, concurrency, replay, cancellation, and stale-result cases | 20 |
| Path, symlink, submodule, command, and secret boundaries | 20 |
| Independent verification and all eight drift types | 16 |
| Repair authorization, exhaustion, and escalation | 10 |
| Successor-baseline impact classifications | 12 |
| File-store crash and recovery boundaries | one fixture before and after each commit-protocol step |
| Owner session and second-identity boundaries | 12 |
| Draft-PR preview and authority boundaries | 8 |

“100%” means every applicable fixture in the committed manifest passes for the release candidate.
Every escaped defect adds a failing regression fixture before its fix. Removing or weakening a
fixture requires an approved requirement change.

## Performance Measurement

- Reference profile: Linux x86-64, four cores, 8 GiB RAM, local SSD, Node 24 LTS.
- Dataset: 500 Intent nodes, 250 Execution tasks, 2,000 total edges.
- Each operation runs 10 warmups and 100 measured iterations in one warm process.
- Report p50, p95, maximum, fixture hash, Node version, and commit.
- The 2 second UI measure begins when the owner command is accepted and ends when the browser
  presents the new authoritative graph version. Model inference duration is reported separately and
  is not hidden inside graph-refresh timing.

## Representative-Owner Usability Measurement

At least 10 adult participants must have personally specified repository work in the prior year:

- at least five primarily work solo or in teams of five or fewer;
- at least five have used an issue tracker;
- no more than two have professional graph-database or graph-visualization experience.

All participants receive the same starting project, scripted P1 journeys, time limits, completion
rubric, and five-point rating questions. Unassisted completion and rating denominators include every
started session except documented equipment failure.

## Manual Hosted-Release Gates

Safari current and previous major versions, production observability, live rollback, Cloudflare
Access, outbound runner enrollment, and graphslop.com behavior are not first local-release
acceptance. They become mandatory only under a successor hosted Solution Baseline.
