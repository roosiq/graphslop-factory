# Contributing

Keep Graphslop small. It is a portable skill and graph guardrail, not a coding
platform.

Before opening a pull request:

```bash
python3 -m unittest discover -s tests -v
python3 -m py_compile skills/graphslop/scripts/graphslop.py
```

Preserve these rules:

- model output is a proposal;
- inferred intent is not approved intent;
- corrections preserve history;
- product solution nodes trace to intent;
- execution jobs trace to solution;
- dependency order is explicit;
- worker boundaries and acceptance checks are concrete;
- no runtime, model provider, or hosted service is required.

Open an issue before changing the graph or baseline format.
