# FeatherBench: staged no-tools visual packing

This private Cloudflare Worker runs an eight-stage, all-or-nothing visual-packing benchmark. It replaces the former mixed 480-item active bank; that bank was archived before this project was changed.

## Protocol

- `POST /v1/start` requires a caller-supplied canonical lowercase UUID `conversation_code` only when `metadata.platform` or `metadata.harness` identifies Arena.ai. If absent on Arena.ai, the API tells the model to ask its user rather than inventing one. Other platforms may omit the code.
- Models are instructed to push as far through the stages as possible.
- Previously accepted stages remain scored if a later answer is wrong.
- Stages 1–3 have no minimum-time rule; a correct answer advances immediately.
- Starting with stage 4, a correct submission after at least 20 seconds advances and releases the next stage.
- Every stage allows one attempt. An incorrect answer permanently ends the run.
- Starting with stage 4, a completely correct answer received in under 20 seconds permanently blocks the run, sets `tool_use_flagged:true`, and instructs the participant to stop and self-report.
- Only complete geometrically valid ASCII tilings count. The verifier accepts rotations, reflections, decoy omission where applicable, and any semantically valid packing rather than comparing against one literal map.
- Stages 1–3 retain one decoy each. Stages 4–8 have no decoys, keeping the hard end focused on packing rather than subset search.
- Stage N is worth N correctness points. Performance is 90% weighted correctness plus 10% speed.

Each run's `conversation_code`, stage records, and latest score snapshot are persisted together in that run's SQLite-backed Cloudflare Durable Object storage. A shared SQLite-backed Durable Object also maintains an index of submitted runs for the public graph. No D1 database or additional Cloudflare binding is required.

The no-tools requirement is an attested closed-book track. The timing flag is only a heuristic: it cannot technically prove tool use, and a dishonest participant can wait. Conversely, a genuinely fast model can be falsely flagged. Report it as **suspected tool use**, never as proof.

## Private files

`src/bank.json` contains answer geometry and must remain private. Do not expose this repository or generator to evaluated models. Models receive only the deployed `/agent.md` and one staged task at a time.

The allowed “no tools” exception is transport-only HTTP needed to call the API. Scripts, code, image extraction, search, computer vision, SAT/exact-cover solvers, and external assistance for solving are prohibited.

## Build and test

```bash
npm install
npm run build:bank
npm run check
npx wrangler deploy --dry-run --outdir /tmp/featherbench-dry
```

Set the Worker secret before live deployment:

```bash
npx wrangler secret put BENCH_SECRET
npx wrangler deploy
```

Endpoints:

```text
GET  /health
GET  /agent.md
GET  /graph
GET  /graph.json
POST /v1/start
POST /v1/submit
```

Start body:

```json
{"conversation_code":"019f6bde-edae-7305-a9b2-6dec6ff62989","client_nonce":"random","attest_no_solving_tools":true,"metadata":{"platform":"arena.ai","harness":"arena.ai"}}
```

Submit body:

```json
{"run_token":"...","attest_no_solving_tools":true,"answer":"..AA..\n.BBA.."}
```

## Results graph and database

Open:

```text
https://featherbench.whoseyci.workers.dev/graph
```

The scatter plot uses total submitted-stage time on the x-axis and highest accepted stage on the y-axis. When present, the run's conversation code is used as its public model label; otherwise the label comes from `metadata.model`. Hovering a point shows that label, stage, time, and status. A table below the chart sorts runs by highest stage and then lowest time. `/graph.json` provides the same public fields as JSON. The harness label comes from optional `metadata.harness`; it is `unknown` when omitted.

The graph starts filling with submissions made after this version is deployed. Old per-run Durable Objects are not enumerable, so historical runs are not automatically backfilled.

## Maximum stage

Stage 8 is the supplied 8×10 target with pieces A–F. The former G and H decoys are omitted. Its private exact-cover validation still finds exactly one geometric solution.
