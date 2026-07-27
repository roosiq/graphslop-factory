# Implementation Plan: [FEATURE]

**Branch**: `[###-feature-name]` | **Date**: [DATE] | **Spec**: [link]

**Input**: Feature specification from `/specs/[###-feature-name]/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

[Extract from feature spec: primary requirement + technical approach from research]

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: [e.g., Python 3.11, Swift 5.9, Rust 1.75 or NEEDS CLARIFICATION]

**Primary Dependencies**: [e.g., FastAPI, UIKit, LLVM or NEEDS CLARIFICATION]

**Storage**: [if applicable, e.g., PostgreSQL, CoreData, files or N/A]

**Testing**: [e.g., pytest, XCTest, cargo test or NEEDS CLARIFICATION]

**Target Platform**: [e.g., Linux server, iOS 15+, WASM or NEEDS CLARIFICATION]

**Project Type**: [e.g., library/cli/web-service/mobile-app/compiler/desktop-app or NEEDS CLARIFICATION]

**Performance Goals**: [domain-specific, e.g., 1000 req/s, 10k lines/sec, 60 fps or NEEDS CLARIFICATION]

**Constraints**: [domain-specific, e.g., <200ms p95, <100MB memory, offline-capable or NEEDS CLARIFICATION]

**Scale/Scope**: [domain-specific, e.g., 10k users, 1M LOC, 50 screens or NEEDS CLARIFICATION]

## Constitution Check

*GATE: The pre-design gate MUST pass before Phase 0 research. The
pre-implementation gate MUST pass after Phase 1 design and before any application
code, implementation-file mutation, or implementation-worker dispatch.*

### Pre-Design Gate: Approved Intent

- **Intent Baseline**: [immutable baseline ID and version]
- **Approval Evidence**: [authorized human approval record tied to this version]
- **Intent State Integrity**: [PASS/FAIL — human-stated, inferred, proposed,
  contradictory, and unresolved intent remain distinguishable]
- **Contradiction Disposition**: [resolved or explicitly deferred items; blocking
  contradictions MUST fail]
- **MVP Boundary**: [PASS/FAIL — one repository, one active project, reviewable
  draft pull request as terminal artifact]
- **No Premature Implementation**: [PASS/FAIL — no implementation began before
  intent and solution approvals]

### Pre-Implementation Gate: Approved Solution and Bounded Execution

- **Solution Baseline**: [immutable baseline ID and version]
- **Approval Evidence**: [authorized human approval record tied to this version]
- **Traceability**: [PASS/FAIL — every product-facing solution node traces to
  approved intent; every planned task traces to solution]
- **Deterministic Controls**: [owners and checks for schemas, transitions,
  readiness, baseline versioning, protected assertions, allowed paths, retries,
  worktrees, and merge gates]
- **Task Bounds**: [PASS/FAIL — objective, prerequisites, allowed paths,
  exclusions, acceptance checks, evidence, and retry budget are explicit]
- **Independent Verification**: [implementer and verifier assignments are
  independent; verifier runs acceptance checks]
- **Drift and Escalation**: [structured report, bounded repair, retry exhaustion,
  and escalation behavior]
- **Security and Privacy**: [least-privilege permissions, secret handling, data
  minimization, declared persistence, and external-transfer boundaries]
- **User-Facing Release Gates**: [accessibility, responsive browsers,
  observability, rollback, and browser acceptance, or justified non-applicability]
- **Deployment Authority**: [PASS/FAIL — no production deployment or domain
  cutover is implied; separate verified authorization is required]

### Post-Design Re-check

[Record PASS/FAIL for every gate, identify the exact violating artifact or graph
node, and stop rather than justifying a failed non-negotiable gate.]

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)
<!--
  ACTION REQUIRED: Replace the placeholder tree below with the concrete layout
  for this feature. Delete unused options and expand the chosen structure with
  real paths (e.g., apps/admin, packages/something). The delivered plan must
  not include Option labels.
-->

```text
# [REMOVE IF UNUSED] Option 1: Single project (DEFAULT)
src/
├── models/
├── services/
├── cli/
└── lib/

tests/
├── contract/
├── integration/
└── unit/

# [REMOVE IF UNUSED] Option 2: Web application (when "frontend" + "backend" detected)
backend/
├── src/
│   ├── models/
│   ├── services/
│   └── api/
└── tests/

frontend/
├── src/
│   ├── components/
│   ├── pages/
│   └── services/
└── tests/

# [REMOVE IF UNUSED] Option 3: Mobile + API (when "iOS/Android" detected)
api/
└── [same as backend above]

ios/ or android/
└── [platform-specific structure: feature modules, UI flows, platform tests]
```

**Structure Decision**: [Document the selected structure and reference the real
directories captured above]

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |
