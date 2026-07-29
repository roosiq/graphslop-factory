# Execution mode

## Job

Break approved product into small jobs. Give jobs order, boundaries, and proof.
Do not build anything.

## Make each job

- one-sentence objective;
- one or more approved solution nodes;
- dependency IDs;
- bounded allowed paths;
- explicit forbidden changes;
- independently runnable acceptance checks;
- intent and solution baseline IDs.

Use behavior and architecture boundaries. Do not split by token guesses. Use
dependency IDs for order, never array position.

Add inspection and contract jobs before implementation when repository facts are
unknown. Add integration and independent verification after component work.

If a job needs to invent product meaning, make a blocking `Decide` job and send
the decision back to intent or solution mode.

Run `graphslop.py validate`, then `graphslop.py next`. The latter prints jobs
whose dependencies are accepted or complete.
