# Security

Security fixes apply to the latest release on the default branch.

Report vulnerabilities through GitHub private vulnerability reporting. Include
the affected file, reproduction, impact, and suggested mitigation.

Graphslop does not make model or network calls. The surrounding harness owns
those boundaries. Treat model-proposed graph changes as untrusted until
`graphslop.py validate` succeeds, and review a build pack before executing its
jobs.
