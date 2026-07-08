# Deploy

Redline has two deploy paths, and they are deliberately independent. The public demo of
the web app goes to Vercel on the fixture target, so it runs with zero cloud
credentials and cannot fail on a flaky backend. The full product (the rigor engine, the
backend, and the UI) runs containerized on AWS, with the heavy jobs dispatched to GCP.
This doc covers both, the env vars, and how to point the app at the real Python engine.

## The bulletproof demo: Vercel + the fixture target

`apps/web` deploys to Vercel. On the default compute target (`fixture`), every number
in the golden path is locked and deterministic, and nothing calls out to a cloud. That
is the whole point: the deployed demo needs no AWS account, no GCP project, and no live
Python engine, so the three WOW catches cannot break on a network hiccup.

```bash
# from the repo root
pnpm install
pnpm build            # builds @redline/contracts and @redline/ui today; the app and
                      # the other packages as they land
```

On Vercel, set the project root to `apps/web` (or let the monorepo config target it),
build with the workspace's build command, and set the environment as below. The only
value that must be present for the demo is the compute target, and it defaults to
`fixture` even if unset.

### The reasoning layer degrades cleanly

The web app renders the reasoning prose from `@redline/reasoning`. With AWS Bedrock
credentials set, that prose comes from Claude. Without them, it falls back to curated
deterministic copy that is kept in exact agreement with the fixture numbers, so the
Vercel demo reads correctly whether or not Bedrock is wired. You never need cloud
credentials to show the demo.

## Environment variables

Copy `.env.example` to `.env.local` and set only what you need. Nothing is hardcoded,
and every value has a safe default.

```bash
# Reasoning runs on AWS Bedrock. Never the direct Anthropic API.
# Unset credentials fall back to curated deterministic copy, so the demo still runs.
AWS_REGION=us-east-1
REDLINE_BEDROCK_MODEL_ID=us.anthropic.claude-opus-4-5-20251101-v1:0

# Where the heavy statistics run: fixture (default) | local | cloudrun | endpoint
REDLINE_COMPUTE_TARGET=fixture

# Reference dataset: open S3, no credentials required, MIT licensed.
REDLINE_S3_BUCKET=genome-scale-tcell-perturb-seq
REDLINE_S3_PREFIX=marson2025_data/
```

AWS credentials follow the standard AWS credential chain (env vars, shared config, or
the container's task role on Fargate). There are no secrets baked into the code.

## Pointing at the real Python engine

The compute target is one env var. The UI never changes when it changes; only the
destination of the statistics moves. Every target returns the same `ComputeResult`
shape, so the app cannot tell them apart except by the numbers.

| `REDLINE_COMPUTE_TARGET` | What runs the statistics | What to wire |
|--------------------------|--------------------------|--------------|
| `fixture` (default)      | The locked deterministic demo | Nothing. Always available. |
| `local`                  | The Python engine on this machine | A local Python env with scanpy, decoupler, PyDESeq2, numpy, and the `.h5ad` reachable. |
| `cloudrun`               | A GCP Cloud Run job | The GCP project and the job image configured; the AWS engine dispatches to it. |
| `endpoint`              | A runner the scientist controls | A user-provided SSH-reachable cluster or their own cloud runner. |

If a target's environment is not wired, its `ComputeTarget.available` is `false`, the
app stays on `fixture`, and that target's control renders disabled and clearly labeled.
This is a hard rule, covered in `honesty-rules.md` rule 6: never present a dead control
as live. "Configurable, currently pointed at our compute" is the honest message.

### `local`

Set `REDLINE_COMPUTE_TARGET=local` and make sure the Python engine in
`services/rigor` can run and can read the target `.h5ad`. The engine shells out to the
Python process and reads back a `ComputeResult` as JSON. Use this to run the real
scanpy and PyDESeq2 statistics on your own machine while building.

### `cloudrun`

Set `REDLINE_COMPUTE_TARGET=cloudrun` and configure the GCP project and the Cloud Run
job image. The AWS engine hands the job to GCP, GCP runs the heavy statistics
(pseudobulk re-analysis, count-split reclustering, resolution sweep) in isolation, and
returns the numbers. Separating the app from the number-crunching means a runaway
analysis cannot take the app down. This is the default real target.

### `endpoint`

Set `REDLINE_COMPUTE_TARGET=endpoint` and provide a runner the scientist controls, so
the heavy jobs run on infrastructure they own while their data stays on their side. The
job payload and the return contract are identical to `cloudrun`; only the destination
changes. If this path is not fully wired, keep it disabled and labeled, per the honesty
rule. Do not ship a dead endpoint button as if it worked.

## The full product on AWS

For the complete stack (the rigor engine, the app backend, and the UI together), the
target is AWS.

- **Bedrock** serves every Claude reasoning call, region from `AWS_REGION`, model id
  from `REDLINE_BEDROCK_MODEL_ID`, standard credential chain. Never the direct Anthropic
  API.
- **The rigor engine, the backend, and the UI** run containerized on **Fargate**, so the
  product lives in one account with one deploy.
- **The heavy jobs** dispatch to **GCP Cloud Run jobs** through the `cloudrun` compute
  target. GPU is not needed for v1.

This gives two honest deploy stories at once: a bulletproof fixture demo on Vercel that
anyone can open, and a real cross-cloud product on AWS plus GCP that runs the actual
statistics. Pick the path that fits the moment. The demo path is the safe default.

## Portability check

The engine also packages as a Claude Skill (`services/skill`), so the same core loads
into Claude Science with no surface-specific paths and no hardcoded secrets. If a deploy
change adds a hardcoded path or a baked-in credential, it breaks portability and the
open-source constraint. Keep everything configurable through the env vars above.
