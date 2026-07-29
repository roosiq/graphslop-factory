# Verification mode

## Job

Check links. Check order. Check closure. Report gaps. Do not approve your own
implementation.

## Check

1. Every product solution node links to confirmed intent in the active baseline.
2. Every execution job links to solution in the active baseline.
3. Every success criterion reaches at least one test or verify job.
4. Every exclusion and protected constraint appears in relevant forbidden
   changes or acceptance checks.
5. Dependency IDs exist and contain no cycles.
6. No job can become ready before its dependencies.
7. No blocking unresolved intent is hidden by a later graph.

Use `graphslop.py validate` for structural checks. Then inspect semantic meaning:
the script cannot decide whether two sentences mean the same thing.

Write drift findings to `drift/<drift-id>.json`. Include severity, type, expected
meaning and source node, observed meaning and files or job, and a bounded repair.
Create repair jobs only for blocking or important gaps. Do not make busywork.
