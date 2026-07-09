# @redline/verify — the self-verification harness

Proves the Redline app is actually wired, not faked. It runs the independent
Python oracle over the four foils, drives every case through the live app, and
grades each check against the oracle plus a set of probes. The result is written
to the store the `/verifications` page reads.

See `docs/build/VERIFICATION.md` for the full contract (the four cases, the
verdict vocabulary, the probes, and the pass bar).

## Run it

One self-contained command. It boots a local+Bedrock app instance, drives it,
tears it down, and writes the run:

```bash
pnpm --filter @redline/verify run verify
```

Requirements: the Python venv at `services/rigor/.venv` (base stats stack), the
foils built (`python -m data.build_foils`), and AWS credentials that can reach
the Bedrock model in `REDLINE_BEDROCK_MODEL_ID` (region `us-east-1`, profile
`default` by default).

To drive an app you already have running instead of booting one:

```bash
REDLINE_VERIFY_BASE_URL=http://localhost:3009 pnpm --filter @redline/verify run verify
```

Then open `/verifications` in the app to read the run: a READY / NOT READY
banner, a per-case per-check verdict table (displayed vs oracle), the AI-wiring
panel, and the dead-controls list. The page also has a re-run button.

## Verdicts

- **WIRED** — matches the oracle within tolerance and responds to its probes.
- **STATIC** — renders a value but does not recompute when a live knob moves.
- **BROKEN** — recomputes but does not match the oracle.
- **TEMPLATED** — the model prose does not adapt or does not carry the data.
- **MISSING** — the screen or state is not built.

Only WIRED passes.

## Knobs

- `REDLINE_VERIFY_BASE_URL` — drive an existing app instead of booting one.
- `REDLINE_VERIFY_PORT` — the port to boot on (default 3011).
- `REDLINE_VERIFY_PACE_MS` — spacing between Bedrock calls (default 1200) so the
  model does not throttle across a full run.
